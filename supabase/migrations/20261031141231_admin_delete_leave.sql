-- แอดมินลบใบลาได้ทุกสถานะ (รวมที่อนุมัติแล้ว) พร้อมบันทึกเหตุผลลงประวัติแอดมิน (เพิ่มได้อย่างเดียว)
-- ลบแล้วกู้คืนไม่ได้ และสถิติ/ยอดลาของคนนั้นเปลี่ยนตาม ประวัติไม่เก็บเหตุผลการลา/เบอร์โทร/ข้อมูลสุขภาพ
-- ไฟล์ลายเซ็น/ใบรับรองแพทย์ลบผ่าน Storage API หลังฟังก์ชันนี้ (ฟังก์ชันคืนชื่อไฟล์ให้) ตามนโยบายด้านล่าง
-- ประวัติการพิจารณายังห้ามแก้/ลบเหมือนเดิม ยกเว้นระหว่างที่ admin_delete_leave กำลังลบใบนั้นทั้งใบ
-- (ฟังก์ชันตั้งค่า leave.admin_delete = เลขใบลา เฉพาะภายในธุรกรรมของมัน; ผู้ใช้ทั่วไปไม่มีสิทธิ์ delete ตาราง approvals อยู่แล้ว)
create or replace function private.forbid_approval_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('leave.admin_delete', true) = old.leave_id::text then
    return old;
  end if;
  raise exception 'ห้ามแก้ไขหรือลบประวัติการพิจารณาใบลา' using errcode = '42501';
end $$;

create function public.admin_delete_leave(p_leave_id bigint, p_reason text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me public.profiles := private.require_ready();
  lv public.leaves;
  why text := btrim(coalesce(p_reason, ''));
begin
  if not me.is_admin then
    raise exception 'เฉพาะแอดมินเท่านั้น' using errcode = '42501';
  end if;
  if char_length(why) not between 1 and 200 then
    raise exception 'กรุณาระบุเหตุผลที่ลบ (ไม่เกิน 200 ตัวอักษร)';
  end if;
  select * into lv from public.leaves where id = p_leave_id for update;
  if lv.id is null then
    raise exception 'ไม่พบใบลา';
  end if;
  insert into public.admin_audit (actor, action, target, detail)
  values (me.id, 'delete_leave', lv.user_id, jsonb_build_object(
    'leave_id', lv.id, 'name', lv.snap_name, 'type', lv.leave_type, 'from', lv.from_date, 'to', lv.to_date,
    'days', lv.total_days, 'status', lv.status, 'reason', why));
  delete from public.line_notifications where leave_id = lv.id;
  perform set_config('leave.admin_delete', lv.id::text, true);
  delete from public.approvals where leave_id = lv.id;
  perform set_config('leave.admin_delete', '', true);
  delete from public.leaves where id = lv.id; -- leave_days ถูกลบตาม (on delete cascade)
  return jsonb_build_object('id', lv.id, 'signature_path', lv.signature_path, 'cert_path', lv.cert_path);
end $$;

revoke all on function public.admin_delete_leave(bigint, text) from public, anon, authenticated;
grant execute on function public.admin_delete_leave(bigint, text) to authenticated;

-- แอดมินลบไฟล์ลายเซ็น/ใบรับรองแพทย์ของใบที่ถูกลบแล้วได้ (เฉพาะไฟล์ที่ไม่มีใบลาใดอ้างอิงอยู่)
create policy "leave files: admin delete orphaned" on storage.objects for delete to authenticated
  using (
    bucket_id in ('leave-signatures', 'leave-certs')
    and (select private.is_admin())
    and not exists (select 1 from public.leaves l where l.signature_path = name or l.cert_path = name)
  );
