-- ตรรกะหลักทั้งหมดอยู่ฝั่งเซิร์ฟเวอร์: นับวันลา ตรวจวันซ้อน/โควตา ลำดับอนุมัติ และสถิติ
-- RPC ใน public เป็น security definer ที่ผู้ล็อกอินเรียกได้ ทุกตัวตรวจผู้เรียกก่อนทำงาน

-- วันนี้ตามเวลาประเทศไทย (ฐานข้อมูลใช้ UTC)
create function private.today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Bangkok')::date
$$;

-- วันที่แบบไทยสั้นสำหรับข้อความแจ้งเตือน เช่น 3 พ.ย. 2569
create function private.th_date(d date) returns text
language sql immutable set search_path = '' as $$
  select extract(day from d)::int || ' '
    || (array['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
              'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'])[extract(month from d)::int]
    || ' ' || (extract(year from d)::int + 543)
$$;

create function private.fmt_days(n numeric) returns text
language sql immutable set search_path = '' as $$
  select case when n = trunc(n) then trunc(n)::text else n::text end
$$;

-- ผู้เรียกต้องล็อกอิน บัญชีเปิดอยู่ และเปลี่ยนรหัสผ่านชั่วคราวแล้ว
create function private.require_ready() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = (select auth.uid());
  if me.id is null then
    raise exception 'กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;
  if not me.active then
    raise exception 'บัญชีนี้ถูกปิดใช้งาน' using errcode = '42501';
  end if;
  if me.must_change_password then
    raise exception 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน' using errcode = '42501';
  end if;
  return me;
end $$;

-- วันที่ต้องนับของใบลา: ตัดเสาร์-อาทิตย์และวันหยุด (ยกเว้นประเภทที่นับทุกวัน)
create function private.leave_day_rows(p_type text, p_from date, p_to date, p_half boolean)
returns table (day date, portion numeric)
language sql stable security definer set search_path = '' as $$
  select g.d::date, case when p_half then 0.5 else 1.0 end
  from public.leave_types t
  cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as g (d)
  where t.code = p_type
    and (t.count_calendar_days
         or (extract(isodow from g.d) < 6
             and not exists (select 1 from public.holidays h where h.day = g.d::date)))
  order by 1
$$;

-- ตรวจคำขอลาโดยไม่บันทึก: คืน { ok, errors[], warnings[], days[], total_days, requires_cert }
create function private.check_leave(p_user uuid, p_type text, p_from date, p_to date, p_half boolean)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.leave_types;
  v_half boolean := coalesce(p_half, false);
  v_errors text[] := '{}';
  v_warnings text[] := '{}';
  v_days jsonb := '[]';
  v_total numeric := 0;
  v_msg text;
  r record;
begin
  select * into t from public.leave_types where code = p_type;
  if t.code is null then
    v_errors := array_append(v_errors, 'กรุณาเลือกประเภทการลา');
  end if;
  if p_from is null or p_to is null then
    v_errors := array_append(v_errors, 'กรุณาเลือกวันที่ลา');
  elsif p_to < p_from then
    v_errors := array_append(v_errors, 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มลา');
  elsif p_to - p_from > 180 then
    v_errors := array_append(v_errors, 'ช่วงวันลายาวเกิน 181 วัน กรุณาแยกยื่นเป็นหลายใบ');
  elsif v_half and p_from <> p_to then
    v_errors := array_append(v_errors, 'ลาครึ่งวันได้เฉพาะการลา 1 วัน');
  end if;

  if cardinality(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'errors', to_jsonb(v_errors), 'warnings', '[]'::jsonb,
      'days', '[]'::jsonb, 'total_days', 0, 'requires_cert', coalesce(t.requires_cert, false));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'portion', d.portion) order by d.day), '[]'),
         coalesce(sum(d.portion), 0)
    into v_days, v_total
  from private.leave_day_rows(p_type, p_from, p_to, v_half) d;

  if v_total = 0 then
    v_errors := array_append(v_errors, 'วันที่เลือกเป็นวันหยุดทั้งหมด ไม่มีวันลาที่ต้องนับ');
  end if;

  -- วันเริ่มลาและทุกวันที่นับต้องอยู่ในรอบการลาที่ตั้งไว้ (สถิติแยกตามรอบ)
  if not exists (select 1 from public.leave_rounds lr where p_from between lr.start_date and lr.end_date)
     or exists (select 1 from jsonb_array_elements(v_days) e
                where not exists (select 1 from public.leave_rounds lr
                                  where (e ->> 'day')::date between lr.start_date and lr.end_date)) then
    v_errors := array_append(v_errors, 'ยังไม่มีรอบการลาที่ครอบคลุมวันที่เลือก กรุณาแจ้งแอดมิน');
  end if;

  -- วันซ้อนกับใบลาเดิมของคนเดียวกันที่ยังไม่ถูกยกเลิก/ไม่อนุมัติ
  select l.from_date, l.to_date, lt.label into r
  from public.leaves l
  join public.leave_types lt on lt.code = l.leave_type
  where l.user_id = p_user
    and l.status not in ('rejected', 'cancelled')
    and exists (select 1 from public.leave_days ld
                join jsonb_array_elements(v_days) e on (e ->> 'day')::date = ld.day
                where ld.leave_id = l.id)
  order by l.from_date
  limit 1;
  if found then
    v_errors := array_append(v_errors, format('วันที่ลาซ้อนกับใบ%s ที่ยื่นไว้แล้ว (%s)', r.label,
      case when r.from_date = r.to_date then private.th_date(r.from_date)
           else private.th_date(r.from_date) || ' – ' || private.th_date(r.to_date) end));
  end if;

  -- โควตาต่อรอบ: นับใบที่อนุมัติแล้วและที่รออนุมัติ
  if t.quota_mode <> 'none' and v_total > 0 then
    for r in
      select lr.label,
             sum((e ->> 'portion')::numeric) as this_days,
             (select coalesce(sum(ld.portion), 0)
              from public.leave_days ld
              join public.leaves l on l.id = ld.leave_id
              where l.user_id = p_user and l.leave_type = p_type
                and l.status not in ('rejected', 'cancelled')
                and ld.day between lr.start_date and lr.end_date) as used_days
      from jsonb_array_elements(v_days) e
      join public.leave_rounds lr on (e ->> 'day')::date between lr.start_date and lr.end_date
      group by lr.id, lr.label, lr.start_date, lr.end_date
      order by lr.start_date
    loop
      if r.used_days + r.this_days > t.quota_days then
        v_msg := format('%s รอบ %s เกินโควตา %s วัน (ใช้แล้ว %s วันรวมใบที่รออนุมัติ + ครั้งนี้ %s วัน)',
          t.label, r.label, private.fmt_days(t.quota_days), private.fmt_days(r.used_days),
          private.fmt_days(r.this_days));
        if t.quota_mode = 'block' then
          v_errors := array_append(v_errors, v_msg);
        else
          v_warnings := array_append(v_warnings, v_msg);
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', cardinality(v_errors) = 0, 'errors', to_jsonb(v_errors),
    'warnings', to_jsonb(v_warnings), 'days', v_days, 'total_days', v_total,
    'requires_cert', t.requires_cert);
end $$;

-- ตัวอย่างจำนวนวันแบบ real-time ระหว่างกรอกฟอร์ม (ไม่บันทึกอะไร)
create function public.preview_leave(p_leave_type text, p_from date, p_to date, p_half_day boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_ready();
begin
  if me.role = 'director' then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('ผู้อำนวยการไม่ต้องยื่นใบลาในระบบนี้'),
      'warnings', '[]'::jsonb, 'days', '[]'::jsonb, 'total_days', 0, 'requires_cert', false);
  end if;
  return private.check_leave(me.id, p_leave_type, p_from, p_to, p_half_day);
end $$;

-- ยื่นใบลา: เซิร์ฟเวอร์กำหนดวันที่ยื่น จำนวนวัน และขั้นอนุมัติเอง
create function public.submit_leave(
  p_leave_type text,
  p_from date,
  p_to date,
  p_half_day boolean,
  p_reason text,
  p_contact_phone text,
  p_signature_path text,
  p_cert_path text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me public.profiles := private.require_ready();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_phone text := btrim(coalesce(p_contact_phone, ''));
  v_check jsonb;
  v_steps public.app_role[];
  v_status public.leave_status;
  v_id bigint;
begin
  if me.role = 'director' then
    raise exception 'ผู้อำนวยการไม่ต้องยื่นใบลาในระบบนี้';
  end if;

  -- ยื่นทีละใบต่อคน กันใบซ้อนกันเมื่อกดส่งซ้ำพร้อมกัน
  perform 1 from public.profiles where id = me.id for update;

  if v_reason = '' then
    raise exception 'กรุณากรอกเหตุผลการลา';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'เหตุผลการลายาวเกิน 1,000 ตัวอักษร';
  end if;
  if v_phone = '' then
    raise exception 'กรุณากรอกช่องทางติดต่อระหว่างลา';
  end if;
  if char_length(v_phone) > 200 then
    raise exception 'ช่องทางติดต่อยาวเกิน 200 ตัวอักษร';
  end if;

  v_check := private.check_leave(me.id, p_leave_type, p_from, p_to, p_half_day);
  if not (v_check ->> 'ok')::boolean then
    raise exception '%', v_check -> 'errors' ->> 0;
  end if;

  -- ไฟล์ต้องอยู่ในโฟลเดอร์ของผู้ยื่นและอัปโหลดโดยผู้ยื่นเอง
  if p_signature_path is null
     or p_signature_path !~ ('^' || me.id::text || '/[0-9a-f-]{36}\.png$')
     or not exists (select 1 from storage.objects o
                    where o.bucket_id = 'leave-signatures' and o.name = p_signature_path
                      and coalesce(o.owner_id, o.owner::text) = me.id::text) then
    raise exception 'ไม่พบไฟล์ลายเซ็น กรุณาเซ็นชื่อแล้วส่งใหม่';
  end if;
  if p_cert_path is not null
     and (p_cert_path !~ ('^' || me.id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')
          or not exists (select 1 from storage.objects o
                         where o.bucket_id = 'leave-certs' and o.name = p_cert_path
                           and coalesce(o.owner_id, o.owner::text) = me.id::text)) then
    raise exception 'ไม่พบไฟล์ใบรับรองแพทย์ กรุณาแนบใหม่';
  end if;
  if p_cert_path is null and (v_check ->> 'requires_cert')::boolean then
    raise exception 'การลาประเภทนี้ต้องแนบใบรับรองแพทย์';
  end if;

  -- ผู้ยื่นที่เป็นหัวหน้าฝ่ายบุคลากรหรือรอง ผอ. ข้ามขั้นของตัวเอง
  v_steps := array_remove(array['hr', 'deputy', 'director']::public.app_role[], me.role);
  v_status := ('pending_' || v_steps[1]::text)::public.leave_status;

  insert into public.leaves (user_id, snap_name, snap_position, leave_type, from_date, to_date,
    total_days, half_day, reason, contact_phone, filed_date, signature_path, cert_path, steps, status)
  values (me.id, me.full_name, me.position, p_leave_type, p_from, p_to,
    (v_check ->> 'total_days')::numeric, coalesce(p_half_day, false), v_reason, v_phone,
    private.today(), p_signature_path, p_cert_path, v_steps, v_status)
  returning id into v_id;

  insert into public.leave_days (leave_id, day, portion)
  select v_id, (e ->> 'day')::date, (e ->> 'portion')::numeric
  from jsonb_array_elements(v_check -> 'days') e;

  return jsonb_build_object('id', v_id, 'status', v_status,
    'total_days', (v_check ->> 'total_days')::numeric, 'warnings', v_check -> 'warnings');
end $$;

-- พิจารณาใบลา: ต้องเป็นผู้อนุมัติของขั้นปัจจุบันเท่านั้น
create function public.decide_leave(
  p_leave_id bigint,
  p_decision text,
  p_reason text default null,
  p_approve_date date default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me public.profiles := private.require_ready();
  lv public.leaves;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_date date;
  v_pos int;
  v_status public.leave_status;
begin
  if me.role = 'teacher' then
    raise exception 'คุณไม่มีสิทธิ์พิจารณาใบลา' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'ผลการพิจารณาไม่ถูกต้อง';
  end if;

  select * into lv from public.leaves where id = p_leave_id for update;
  if lv.id is null then
    raise exception 'ไม่พบใบลา';
  end if;
  if lv.user_id = me.id then
    raise exception 'พิจารณาใบลาของตนเองไม่ได้' using errcode = '42501';
  end if;
  if lv.status::text <> 'pending_' || me.role::text then
    raise exception 'ใบลานี้ไม่ได้รอการพิจารณาจากคุณ' using errcode = '42501';
  end if;

  if p_decision = 'reject' and v_reason is null then
    raise exception 'กรุณาระบุเหตุผลที่ไม่อนุมัติ';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'เหตุผลยาวเกิน 500 ตัวอักษร';
  end if;
  if p_decision = 'approve' and me.signature_path is null then
    raise exception 'ยังไม่มีลายเซ็นของคุณในระบบ กรุณาให้แอดมินอัปโหลดลายเซ็นก่อนอนุมัติ';
  end if;

  if me.role = 'director' then
    v_date := coalesce(p_approve_date, private.today());
    if v_date > private.today() then
      raise exception 'วันที่อนุญาตต้องไม่เกินวันนี้';
    end if;
    if v_date < lv.filed_date then
      raise exception 'วันที่อนุญาตต้องไม่ก่อนวันที่ยื่นใบลา';
    end if;
  end if;

  insert into public.approvals (leave_id, step, decision, reason, decided_by,
    snap_name, snap_position, signature_path, approve_date)
  values (lv.id, me.role, p_decision, case when p_decision = 'reject' then v_reason end, me.id,
    me.full_name, me.position, case when p_decision = 'approve' then me.signature_path end, v_date);

  if p_decision = 'reject' then
    v_status := 'rejected';
  else
    v_pos := array_position(lv.steps, me.role);
    if v_pos < cardinality(lv.steps) then
      v_status := ('pending_' || lv.steps[v_pos + 1]::text)::public.leave_status;
    else
      v_status := 'approved';
    end if;
  end if;

  update public.leaves set status = v_status where id = lv.id;
  return jsonb_build_object('id', lv.id, 'status', v_status);
end $$;

-- ยกเลิกได้เฉพาะเจ้าของ และยังไม่มีใครพิจารณา
create function public.cancel_leave(p_leave_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me public.profiles := private.require_ready();
  lv public.leaves;
begin
  select * into lv from public.leaves where id = p_leave_id for update;
  if lv.id is null or lv.user_id <> me.id then
    raise exception 'ไม่พบใบลา';
  end if;
  if lv.status not in ('pending_hr', 'pending_deputy', 'pending_director')
     or exists (select 1 from public.approvals a where a.leave_id = lv.id) then
    raise exception 'ยกเลิกไม่ได้ เพราะใบลานี้มีผู้พิจารณาแล้ว';
  end if;
  update public.leaves set status = 'cancelled', cancelled_at = now() where id = lv.id;
  return jsonb_build_object('id', lv.id, 'status', 'cancelled');
end $$;

-- ข้อมูลสำหรับพิมพ์ใบลา: ใบลา + สถิติในรอบ + ใบที่ลาล่าสุด + ผลพิจารณา + ค่าตั้งค่า
-- "ลามาแล้ว" = ใบที่อนุมัติแล้วของคนเดียวกันซึ่งเริ่มลาก่อนใบนี้ (นับครั้งในรอบของวันเริ่มลา
-- และนับวันเฉพาะวันที่อยู่ในรอบ)
create function public.get_leave_form(p_leave_id bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_ready();
  lv public.leaves;
  rd public.leave_rounds;
  v_stats jsonb;
  v_last jsonb;
  v_approvals jsonb;
  v_settings jsonb;
begin
  select * into lv from public.leaves where id = p_leave_id;
  if lv.id is null or not (lv.user_id = me.id or me.is_admin or me.role <> 'teacher') then
    raise exception 'ไม่พบใบลา หรือคุณไม่มีสิทธิ์ดูใบลานี้' using errcode = '42501';
  end if;

  select * into rd from public.leave_rounds r where lv.from_date between r.start_date and r.end_date;

  with prior as (
    select l.id, l.leave_type, l.from_date
    from public.leaves l
    where l.user_id = lv.user_id and l.status = 'approved'
      and (l.from_date, l.id) < (lv.from_date, lv.id)
  )
  select jsonb_agg(jsonb_build_object(
      'code', t.code, 'label', t.label, 'form_label', t.form_label,
      'before_times', bt.n, 'before_days', bd.n,
      'this_times', case when t.code = lv.leave_type then 1 else 0 end,
      'this_days', case when t.code = lv.leave_type then td.n else 0 end) order by t.sort)
    into v_stats
  from public.leave_types t
  cross join lateral (
    select count(*) as n from prior p
    where p.leave_type = t.code and p.from_date between rd.start_date and rd.end_date) bt
  cross join lateral (
    select coalesce(sum(d.portion), 0) as n
    from prior p join public.leave_days d on d.leave_id = p.id
    where p.leave_type = t.code and d.day between rd.start_date and rd.end_date) bd
  cross join lateral (
    select coalesce(sum(d.portion), 0) as n
    from public.leave_days d
    where d.leave_id = lv.id and (rd.id is null or d.day between rd.start_date and rd.end_date)) td;

  select jsonb_build_object('leave_type', l.leave_type, 'label', t.label, 'form_label', t.form_label,
      'from_date', l.from_date, 'to_date', l.to_date, 'total_days', l.total_days, 'half_day', l.half_day)
    into v_last
  from public.leaves l
  join public.leave_types t on t.code = l.leave_type
  where l.user_id = lv.user_id and l.status = 'approved'
    and (l.from_date, l.id) < (lv.from_date, lv.id)
  order by l.from_date desc, l.id desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
      'step', a.step, 'decision', a.decision, 'reason', a.reason,
      'name', a.snap_name, 'position', a.snap_position, 'signature_path', a.signature_path,
      'approve_date', a.approve_date, 'decided_at', a.decided_at) order by a.decided_at, a.id), '[]')
    into v_approvals
  from public.approvals a
  where a.leave_id = lv.id;

  select coalesce(jsonb_object_agg(s.key, s.value), '{}') into v_settings from public.app_settings s;

  return jsonb_build_object(
    'leave', to_jsonb(lv) - 'legacy_row_no'
      || jsonb_build_object('type_label', (select t.label from public.leave_types t where t.code = lv.leave_type)),
    'round', case when rd.id is null then null
                  else jsonb_build_object('id', rd.id, 'label', rd.label,
                         'start_date', rd.start_date, 'end_date', rd.end_date) end,
    'stats', v_stats,
    'last_leave', v_last,
    'approvals', v_approvals,
    'settings', v_settings);
end $$;

-- ยอดลาของฉันในรอบปัจจุบัน แยกประเภท (ครั้ง/วัน) — นับเฉพาะที่อนุมัติแล้ว + แยกยอดที่รออนุมัติ
create function public.my_balances() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_ready();
  rd public.leave_rounds;
  v_types jsonb;
begin
  select * into rd from public.leave_rounds r where private.today() between r.start_date and r.end_date;

  select jsonb_agg(jsonb_build_object(
      'code', t.code, 'label', t.label, 'quota_days', t.quota_days, 'quota_mode', t.quota_mode,
      'requires_cert', t.requires_cert, 'count_calendar_days', t.count_calendar_days,
      'approved_times', c.approved_times, 'pending_times', c.pending_times,
      'approved_days', d.approved_days, 'pending_days', d.pending_days) order by t.sort)
    into v_types
  from public.leave_types t
  cross join lateral (
    select count(*) filter (where l.status = 'approved') as approved_times,
           count(*) filter (where l.status in ('pending_hr', 'pending_deputy', 'pending_director')) as pending_times
    from public.leaves l
    where l.user_id = me.id and l.leave_type = t.code
      and l.from_date between rd.start_date and rd.end_date) c
  cross join lateral (
    select coalesce(sum(ld.portion) filter (where l.status = 'approved'), 0) as approved_days,
           coalesce(sum(ld.portion) filter (
             where l.status in ('pending_hr', 'pending_deputy', 'pending_director')), 0) as pending_days
    from public.leaves l
    join public.leave_days ld on ld.leave_id = l.id
    where l.user_id = me.id and l.leave_type = t.code
      and ld.day between rd.start_date and rd.end_date) d;

  return jsonb_build_object(
    'today', private.today(),
    'round', case when rd.id is null then null
                  else jsonb_build_object('id', rd.id, 'label', rd.label,
                         'start_date', rd.start_date, 'end_date', rd.end_date) end,
    'types', v_types);
end $$;

-- ตารางสรุปรายคน × ประเภท ต่อรอบ (นับเฉพาะที่อนุมัติแล้ว) + จำนวนใบแยกสถานะ
create function public.admin_summary(p_round_id bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_ready();
  rd public.leave_rounds;
  v_rows jsonb;
  v_counts jsonb;
  v_types jsonb;
begin
  if not (me.is_admin or me.role <> 'teacher') then
    raise exception 'คุณไม่มีสิทธิ์ดูสรุปการลา' using errcode = '42501';
  end if;
  select * into rd from public.leave_rounds where id = p_round_id;
  if rd.id is null then
    raise exception 'ไม่พบรอบการลา';
  end if;

  select jsonb_agg(jsonb_build_object('code', t.code, 'label', t.label) order by t.sort)
    into v_types from public.leave_types t;

  with people as (
    select p.id, p.user_code, p.full_name, p.position, p.active
    from public.profiles p
    where (p.active and p.role <> 'director')
       or exists (select 1 from public.leaves l
                  where l.user_id = p.id and l.from_date between rd.start_date and rd.end_date)
  ), times as (
    select l.user_id, l.leave_type, count(*) as n
    from public.leaves l
    where l.status = 'approved' and l.from_date between rd.start_date and rd.end_date
    group by 1, 2
  ), days as (
    select l.user_id, l.leave_type, sum(d.portion) as n
    from public.leaves l
    join public.leave_days d on d.leave_id = l.id
    where l.status = 'approved' and d.day between rd.start_date and rd.end_date
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', p.id, 'user_code', p.user_code, 'full_name', p.full_name,
      'position', p.position, 'active', p.active,
      'by_type', (select jsonb_object_agg(t.code, jsonb_build_object(
                    'times', coalesce(ti.n, 0), 'days', coalesce(da.n, 0)))
                  from public.leave_types t
                  left join times ti on ti.user_id = p.id and ti.leave_type = t.code
                  left join days da on da.user_id = p.id and da.leave_type = t.code),
      'total_times', (select coalesce(sum(ti.n), 0) from times ti where ti.user_id = p.id),
      'total_days', (select coalesce(sum(da.n), 0) from days da where da.user_id = p.id)
    ) order by p.full_name), '[]')
    into v_rows
  from people p;

  select jsonb_build_object(
      'total', count(*) filter (where l.status <> 'cancelled'),
      'pending_hr', count(*) filter (where l.status = 'pending_hr'),
      'pending_deputy', count(*) filter (where l.status = 'pending_deputy'),
      'pending_director', count(*) filter (where l.status = 'pending_director'),
      'approved', count(*) filter (where l.status = 'approved'),
      'rejected', count(*) filter (where l.status = 'rejected'),
      'cancelled', count(*) filter (where l.status = 'cancelled'))
    into v_counts
  from public.leaves l
  where l.from_date between rd.start_date and rd.end_date;

  return jsonb_build_object(
    'round', jsonb_build_object('id', rd.id, 'label', rd.label,
               'start_date', rd.start_date, 'end_date', rd.end_date),
    'types', v_types, 'rows', v_rows, 'counts', v_counts);
end $$;

-- ให้ GitHub Actions เรียกสัปดาห์ละครั้งกันโปรเจกต์ Free ถูก pause (ไม่แตะข้อมูลใด ๆ)
create function public.keepalive() returns text
language sql stable set search_path = '' as $$
  select 'ok'::text
$$;

revoke all on function
  private.today(), private.th_date(date), private.fmt_days(numeric), private.require_ready(),
  private.leave_day_rows(text, date, date, boolean),
  private.check_leave(uuid, text, date, date, boolean)
  from public;

revoke all on function
  public.preview_leave(text, date, date, boolean),
  public.submit_leave(text, date, date, boolean, text, text, text, text),
  public.decide_leave(bigint, text, text, date),
  public.cancel_leave(bigint),
  public.get_leave_form(bigint),
  public.my_balances(),
  public.admin_summary(bigint),
  public.keepalive()
  from public, anon, authenticated;

grant execute on function
  public.preview_leave(text, date, date, boolean),
  public.submit_leave(text, date, date, boolean, text, text, text, text),
  public.decide_leave(bigint, text, text, date),
  public.cancel_leave(bigint),
  public.get_leave_form(bigint),
  public.my_balances(),
  public.admin_summary(bigint)
  to authenticated;

grant execute on function public.keepalive() to anon, authenticated;
