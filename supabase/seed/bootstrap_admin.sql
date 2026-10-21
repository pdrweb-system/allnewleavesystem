-- สร้างบัญชีแอดมินคนแรก (ทำครั้งเดียวตอนติดตั้ง) — บัญชีอื่นสร้างจากหน้าแอดมินบนเว็บ
--
-- 1) Supabase Dashboard → Authentication → Users → Add user → Create new user
--      Email:    <ชื่อผู้ใช้>@leave.pdr.invalid      เช่น ben@leave.pdr.invalid
--      Password: รหัสชั่วคราวอย่างน้อย 8 ตัว (ระบบจะบังคับเปลี่ยนตอนเข้าใช้ครั้งแรก)
--      ✓ Auto Confirm User
-- 2) แก้ 4 ค่าด้านล่างให้ตรงกับข้อ 1 แล้วรันใน SQL Editor
--      role: 'teacher' | 'hr' (หัวหน้าฝ่ายบุคลากร) | 'deputy' | 'director'
insert into public.profiles (id, user_code, full_name, position, role, is_admin, must_change_password)
select u.id, 'ben', 'ชื่อ นามสกุล', 'ครู', 'hr', true, true
from auth.users u
where u.email = 'ben@leave.pdr.invalid'
returning user_code, full_name, role, is_admin;
-- 3) เข้า https://<เว็บไซต์>/#/login ด้วยชื่อผู้ใช้ (ไม่ต้องพิมพ์ @leave.pdr.invalid) และรหัสชั่วคราว
