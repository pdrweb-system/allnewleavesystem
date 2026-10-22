// ค่าสาธารณะเท่านั้น: publishable key ใส่ในหน้าเว็บได้ ความปลอดภัยอยู่ที่ RLS ฝั่งฐานข้อมูล
// ห้ามใส่ secret key / service_role key ในไฟล์นี้หรือที่ใดใน repo
export const SUPABASE_URL = 'https://oqlgytbaihfjqhsriiyb.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_8gvjnN5p5symcplZCY8SDQ_ojm1h0DI';

// ผู้ใช้กรอกแค่ชื่อผู้ใช้ หน้าเว็บต่อโดเมนภายในเป็นอีเมลของ Supabase Auth
// ต้องตรงกับ LOGIN_DOMAIN ใน supabase/functions/admin-users/index.ts
export const LOGIN_DOMAIN = 'leave.pdr.invalid';

export const SITE_NAME = 'ระบบใบลาออนไลน์';
// แสดงที่หน้าล็อกอิน (ก่อนล็อกอินยังอ่าน app_settings ไม่ได้)
export const SCHOOL_NAME = 'โรงเรียนวัดปรีดาราม (มณีศิริวรรณ)';
