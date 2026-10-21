-- สิทธิ์และ RLS
-- Supabase ให้ anon/authenticated ได้ทุกสิทธิ์บนตาราง/ฟังก์ชันใหม่ใน public เป็นค่าตั้งต้น
-- จึงถอนออกทั้งหมดก่อน แล้วให้เฉพาะที่หน้าเว็บต้องใช้

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
-- สิทธิ์ EXECUTE ให้ PUBLIC เป็นค่าตั้งต้นระดับทั้งฐานข้อมูล ถอนได้เฉพาะแบบไม่ระบุสคีมา
alter default privileges for role postgres revoke execute on functions from public;

revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ฟังก์ชันช่วยของ RLS (security definer เพื่ออ่าน profiles โดยไม่วนเข้า RLS ของตัวเอง)
-- ผู้ใช้ "พร้อมใช้งาน" = บัญชียังเปิดอยู่และเปลี่ยนรหัสผ่านชั่วคราวแล้ว
create function private.is_ready() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and not p.must_change_password)
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and not p.must_change_password and p.is_admin)
$$;

-- ผู้อนุมัติ (หัวหน้าฝ่ายบุคลากร/รอง ผอ./ผอ.) หรือแอดมิน ดูใบลาของทุกคนได้
create function private.can_view_all() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and not p.must_change_password
      and (p.is_admin or p.role <> 'teacher'))
$$;

revoke all on function private.is_ready(), private.is_admin(), private.can_view_all() from public;
grant execute on function private.is_ready(), private.is_admin(), private.can_view_all() to authenticated;
revoke all on function private.touch_updated_at(), private.forbid_approval_change() from public;

-- เปิด RLS ทุกตาราง (ไม่มี policy = ปฏิเสธ)
alter table public.profiles enable row level security;
alter table public.leave_types enable row level security;
alter table public.leave_rounds enable row level security;
alter table public.holidays enable row level security;
alter table public.leaves enable row level security;
alter table public.leave_days enable row level security;
alter table public.approvals enable row level security;
alter table public.app_settings enable row level security;

-- profiles: เห็นของตัวเองเสมอ (หน้าเว็บต้องรู้ must_change_password/active)
-- ผู้อนุมัติ/แอดมินเห็นทุกคน; แก้ไขผ่าน Edge Function admin-users เท่านั้น
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.can_view_all()));
grant select (id, user_code, full_name, position, role, is_admin, signature_path,
  must_change_password, active, created_at, updated_at) on public.profiles to authenticated;

-- ตารางอ้างอิง: ผู้ใช้ที่พร้อมใช้งานอ่านได้ แอดมินแก้ได้
create policy leave_types_select on public.leave_types for select to authenticated
  using ((select private.is_ready()));
create policy leave_types_update on public.leave_types for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
grant select on public.leave_types to authenticated;
grant update (quota_days, quota_mode, requires_cert, count_calendar_days) on public.leave_types to authenticated;

create policy leave_rounds_select on public.leave_rounds for select to authenticated
  using ((select private.is_ready()));
create policy leave_rounds_insert on public.leave_rounds for insert to authenticated
  with check ((select private.is_admin()));
create policy leave_rounds_update on public.leave_rounds for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy leave_rounds_delete on public.leave_rounds for delete to authenticated
  using ((select private.is_admin()));
grant select, delete on public.leave_rounds to authenticated;
grant insert (label, start_date, end_date), update (label, start_date, end_date)
  on public.leave_rounds to authenticated;

create policy holidays_select on public.holidays for select to authenticated
  using ((select private.is_ready()));
create policy holidays_insert on public.holidays for insert to authenticated
  with check ((select private.is_admin()));
create policy holidays_update on public.holidays for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy holidays_delete on public.holidays for delete to authenticated
  using ((select private.is_admin()));
grant select, insert, update, delete on public.holidays to authenticated;

create policy app_settings_select on public.app_settings for select to authenticated
  using ((select private.is_ready()));
create policy app_settings_insert on public.app_settings for insert to authenticated
  with check ((select private.is_admin()));
create policy app_settings_update on public.app_settings for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy app_settings_delete on public.app_settings for delete to authenticated
  using ((select private.is_admin()));
grant select, insert, update, delete on public.app_settings to authenticated;

-- ใบลา/วันลา/ประวัติการพิจารณา: อ่านได้เฉพาะเจ้าของ หรือผู้อนุมัติ/แอดมิน
-- เขียนตรงจากหน้าเว็บไม่ได้เลย (ไม่มี grant insert/update/delete) ต้องผ่าน RPC
create policy leaves_select on public.leaves for select to authenticated
  using (user_id = (select auth.uid()) or (select private.can_view_all()));
grant select on public.leaves to authenticated;

create policy leave_days_select on public.leave_days for select to authenticated
  using (
    (select private.can_view_all())
    or exists (select 1 from public.leaves l
               where l.id = leave_days.leave_id and l.user_id = (select auth.uid())));
grant select on public.leave_days to authenticated;

create policy approvals_select on public.approvals for select to authenticated
  using (
    (select private.can_view_all())
    or exists (select 1 from public.leaves l
               where l.id = approvals.leave_id and l.user_id = (select auth.uid())));
grant select on public.approvals to authenticated;
