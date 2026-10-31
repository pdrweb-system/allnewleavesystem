-- สร้างบัญชีแอดมินคนแรก (ทำครั้งเดียวตอนติดตั้ง) — บัญชีอื่นสร้างจากหน้าแอดมินบนเว็บ
--
-- 1) Supabase Dashboard → Authentication → Users → Add user → Create new user
--      Email:    admin@leave.pdr.invalid   (ชั่วคราว ข้อ 3 จะเปลี่ยนให้เอง)
--      Password: อะไรก็ได้อย่างน้อย 8 ตัว (ข้อ 3 จะแทนด้วยรหัสเข้าใช้)
--      ✓ Auto Confirm User
-- 2) แก้ชื่อ-สกุล ตำแหน่ง บทบาท ด้านล่าง แล้วรันใน SQL Editor
--      role: 'teacher' | 'hr' (หัวหน้าฝ่ายบุคลากร) | 'deputy' | 'director'
insert into public.profiles (id, user_code, full_name, position, role, is_admin, must_change_password)
select u.id, 'admin', 'ชื่อ นามสกุล', 'ครู', 'hr', true, false
from auth.users u
where u.email = 'admin@leave.pdr.invalid'
returning user_code, full_name, role, is_admin;
-- 3) เปิด set_login_code.sql ตั้ง v_user_code = 'admin' และรหัสเข้าใช้ 8 หลัก แล้วรัน
-- 4) เข้า https://<เว็บไซต์>/#/login แล้วกรอกรหัสเข้าใช้ 8 หลักอย่างเดียว
