-- ตั้งรหัสเข้าใช้ 6 หลักให้บัญชีโดยตรงใน SQL Editor
-- ใช้ตอนสร้างแอดมินคนแรก (ดู bootstrap_admin.sql) หรือเมื่อแอดมินเองเข้าระบบไม่ได้
-- ปกติแอดมินตั้งรหัสให้ผู้อื่นจากหน้าเว็บ: ผู้ใช้ → "ตั้งรหัสใหม่"
-- แก้ 2 ค่าในบรรทัด v_user_code / v_code แล้วกด Run
do $$
declare
  v_user_code text := 'ben';        -- รหัสอ้างอิงของบัญชี (คอลัมน์ user_code ในตาราง profiles)
  v_code      text := '000000';     -- รหัสเข้าใช้ใหม่ ตัวเลข 6 หลัก ห้ามเลขซ้ำหรือเลขเรียง
  v_id    uuid;
  v_email text;
begin
  if v_code !~ '^[0-9]{6}$' or v_code ~ '^([0-9])\1{5}$'
     or position(v_code in '01234567890123456789') > 0 or position(v_code in '98765432109876543210') > 0 then
    raise exception 'รหัสเข้าใช้ต้องเป็นตัวเลข 6 หลัก และไม่ใช่เลขซ้ำหรือเลขเรียง';
  end if;
  select id into v_id from public.profiles where user_code = v_user_code;
  if v_id is null then
    raise exception 'ไม่พบบัญชีรหัสอ้างอิง %', v_user_code;
  end if;
  -- ต้องตรงกับ loginEmail ใน js/auth.js และ supabase/functions/admin-users/index.ts
  v_email := 'k' || left(encode(extensions.digest('pdr-leave-v2:' || v_code, 'sha256'), 'hex'), 32) || '@leave.pdr.invalid';
  if exists (select 1 from auth.users where email = v_email and id <> v_id) then
    raise exception 'รหัสนี้ใช้ไม่ได้ กรุณาใช้รหัสอื่น';
  end if;
  update auth.users
     set email = v_email,
         encrypted_password = extensions.crypt(v_code, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = v_id;
  update auth.identities
     set identity_data = identity_data || jsonb_build_object('email', v_email), updated_at = now()
   where user_id = v_id and provider = 'email';
  update public.profiles set must_change_password = false where id = v_id;
  raise notice 'ตั้งรหัสเข้าใช้ให้ % แล้ว', v_user_code;
end $$;
