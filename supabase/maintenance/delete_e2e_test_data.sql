-- ลบข้อมูลทดสอบอัตโนมัติ (บัญชีขึ้นต้นด้วย e2e-) ออกจากโปรเจกต์จริง
-- บัญชีเหล่านี้ถูกปิด/แบน/สุ่มรหัสผ่านทิ้งไว้แล้ว รันไฟล์นี้ใน SQL editor ครั้งเดียวก่อนเปิดใช้งานจริง
begin;

delete from public.line_notifications
  where leave_id in (select l.id from public.leaves l
                     join public.profiles p on p.id = l.user_id
                     where p.user_code like 'e2e-%');
delete from public.leaves                -- leave_days ถูกลบตาม (on delete cascade)
  where user_id in (select id from public.profiles where user_code like 'e2e-%');

alter table public.admin_audit disable trigger admin_audit_append_only;
delete from public.admin_audit
  where actor in (select id from public.profiles where user_code like 'e2e-%')
     or target in (select id from public.profiles where user_code like 'e2e-%');
alter table public.admin_audit enable trigger admin_audit_append_only;

set local storage.allow_delete_query = 'true';
delete from storage.objects
  where owner_id in (select id::text from public.profiles where user_code like 'e2e-%');

delete from auth.users where email like 'e2e-%@leave.pdr.invalid';  -- profiles ถูกลบตาม

commit;
