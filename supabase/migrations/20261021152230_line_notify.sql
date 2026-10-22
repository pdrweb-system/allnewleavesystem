-- แจ้งเตือน LINE: ทุกครั้งที่ยื่นใบลาหรือสถานะเปลี่ยน trigger บันทึกคิวแล้วเรียก Edge Function
-- notify-line ผ่าน pg_net (ส่งหลัง commit แบบ async — ส่งไม่สำเร็จก็ไม่ทำให้การอนุมัติล้ม)
-- ฟังก์ชันอ่านเนื้อหาจากตารางคิวเอง โดยตรวจ token ของแถว จึงไม่ต้องเก็บ secret ไว้ในฐานข้อมูล
-- เนื้อหาไม่มีเหตุผลการลาและเหตุผลไม่อนุมัติ (ข้อมูลสุขภาพ/ส่วนบุคคล ห้ามส่งเข้ากลุ่ม)

create extension if not exists pg_net with schema extensions;

-- ค่าตั้งค่าภายในที่หน้าเว็บอ่านไม่ได้ เช่น notify_line_url
create table private.config (
  key text primary key,
  value text not null
);

create table public.line_notifications (
  id bigint generated always as identity primary key,
  leave_id bigint not null references public.leaves (id),
  event text not null
    constraint line_notifications_event check (event in ('submitted', 'progress', 'approved', 'rejected')),
  payload jsonb not null,
  token uuid not null default gen_random_uuid(),
  request_id bigint,
  status text not null default 'queued'
    constraint line_notifications_status check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  result text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index line_notifications_leave_id_idx on public.line_notifications (leave_id);

alter table public.line_notifications enable row level security;
revoke all on public.line_notifications from anon, authenticated;
create policy line_notifications_select on public.line_notifications for select to authenticated
  using ((select private.is_admin()));
grant select (id, leave_id, event, payload, status, result, created_at, sent_at)
  on public.line_notifications to authenticated;

create function private.dispatch_line_notification(p_id bigint) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_url text;
  v_token uuid;
  v_request bigint;
begin
  select c.value into v_url from private.config c where c.key = 'notify_line_url';
  if v_url is null then
    update public.line_notifications
      set status = 'skipped', result = 'ยังไม่ได้ตั้งค่า notify_line_url'
      where id = p_id;
    return;
  end if;
  select n.token into v_token from public.line_notifications n where n.id = p_id;
  begin
    select net.http_post(
        url := v_url,
        body := jsonb_build_object('id', p_id, 'token', v_token),
        headers := jsonb_build_object('Content-Type', 'application/json'),
        timeout_milliseconds := 10000)
      into v_request;
    update public.line_notifications set request_id = v_request where id = p_id;
  exception when others then
    update public.line_notifications
      set status = 'failed', result = left('pg_net: ' || sqlerrm, 500)
      where id = p_id;
  end;
end $$;

create function private.queue_line_notification() returns trigger
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event text;
  v_actor public.app_role;
  v_id bigint;
begin
  if new.legacy_row_no is not null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    v_event := 'submitted';
  elsif new.status is not distinct from old.status then
    return null;
  elsif new.status = 'approved' then
    v_event := 'approved';
  elsif new.status = 'rejected' then
    v_event := 'rejected';
  elsif new.status in ('pending_hr', 'pending_deputy', 'pending_director') then
    v_event := 'progress';
  else
    return null;  -- ยกเลิกเอง ไม่แจ้งกลุ่ม
  end if;

  select a.step into v_actor
  from public.approvals a
  where a.leave_id = new.id
  order by a.decided_at desc, a.id desc
  limit 1;

  insert into public.line_notifications (leave_id, event, payload)
  values (new.id, v_event, jsonb_build_object(
    'leave_id', new.id,
    'name', new.snap_name,
    'leave_type', new.leave_type,
    'type_label', (select t.label from public.leave_types t where t.code = new.leave_type),
    'from_date', new.from_date,
    'to_date', new.to_date,
    'total_days', new.total_days,
    'half_day', new.half_day,
    'status', new.status,
    'actor_step', case when tg_op = 'INSERT' then null else v_actor end))
  returning id into v_id;

  perform private.dispatch_line_notification(v_id);
  return null;
end $$;

create trigger leaves_line_notify
  after insert or update of status on public.leaves
  for each row execute function private.queue_line_notification();

-- แอดมินสั่งส่งซ้ำรายการที่ล้มเหลว
create function public.resend_line_notification(p_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me public.profiles := private.require_ready();
begin
  if not me.is_admin then
    raise exception 'คุณไม่มีสิทธิ์ส่งแจ้งเตือนซ้ำ' using errcode = '42501';
  end if;
  update public.line_notifications
    set status = 'queued', result = null, token = gen_random_uuid()
    where id = p_id and status in ('failed', 'skipped');
  if not found then
    raise exception 'ส่งซ้ำได้เฉพาะรายการที่ล้มเหลวหรือถูกข้าม';
  end if;
  perform private.dispatch_line_notification(p_id);
  return jsonb_build_object('id', p_id);
end $$;

revoke all on function private.dispatch_line_notification(bigint), private.queue_line_notification()
  from public;
revoke all on function public.resend_line_notification(bigint) from public, anon, authenticated;
grant execute on function public.resend_line_notification(bigint) to authenticated;
