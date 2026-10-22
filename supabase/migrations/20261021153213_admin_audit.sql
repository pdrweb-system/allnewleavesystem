-- บันทึกการกระทำของแอดมินผ่าน Edge Function admin-users (สร้างบัญชี/รีเซ็ตรหัส/แก้บทบาท/ปิดบัญชี/ลายเซ็น)
-- ผู้อนุมัติทุกคนอ่านได้ จึงตรวจสอบย้อนหลังได้ว่าบัญชีใครถูกรีเซ็ตหรือเปลี่ยนบทบาทเมื่อไร
-- เพิ่มได้อย่างเดียว ห้ามแก้/ลบ (ไม่ผูก FK เพื่อให้ประวัติอยู่ต่อแม้ลบผู้ใช้)
create table public.admin_audit (
  id bigint generated always as identity primary key,
  actor uuid not null,
  action text not null,
  target uuid,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index admin_audit_created_at_idx on public.admin_audit (created_at desc);

alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;
create policy admin_audit_select on public.admin_audit for select to authenticated
  using ((select private.can_view_all()));
grant select on public.admin_audit to authenticated;

create function private.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'ห้ามแก้ไขหรือลบประวัตินี้' using errcode = '42501';
end $$;
revoke all on function private.forbid_change() from public;

create trigger admin_audit_append_only before update or delete on public.admin_audit
  for each row execute function private.forbid_change();
