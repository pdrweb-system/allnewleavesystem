-- บังคับเปลี่ยนรหัสผ่านชั่วคราว: เมื่อรหัสผ่านใน Supabase Auth เปลี่ยน ปลดธง must_change_password
-- Edge Function admin-users ตั้งธงกลับเป็น true หลังรีเซ็ตรหัสให้ผู้ใช้ (ลำดับ: เปลี่ยนรหัส → ตั้งธง)
create function private.clear_must_change_password() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles set must_change_password = false
    where id = new.id and must_change_password;
  end if;
  return new;
end $$;

revoke all on function private.clear_must_change_password() from public;

create trigger on_auth_user_password_changed
  after update of encrypted_password on auth.users
  for each row execute function private.clear_must_change_password();
