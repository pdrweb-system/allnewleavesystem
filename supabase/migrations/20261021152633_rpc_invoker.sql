-- RPC ที่อ่านอย่างเดียวรันด้วยสิทธิ์ของผู้เรียก (security invoker) ให้ RLS กรองข้อมูลซ้ำอีกชั้น
-- คง security definer ไว้เฉพาะ RPC ที่ต้องเขียนตารางซึ่งหน้าเว็บไม่มีสิทธิ์เขียนตรง
-- (submit_leave, decide_leave, cancel_leave, resend_line_notification) — ตั้งใจให้ผู้ล็อกอินเรียกได้
-- และทุกตัวตรวจผู้เรียกเองก่อนทำงาน (Security Advisor จะเตือน 0029 สำหรับ 4 ตัวนี้)
alter function public.preview_leave(text, date, date, boolean) security invoker;
alter function public.get_leave_form(bigint) security invoker;
alter function public.my_balances() security invoker;
alter function public.admin_summary(bigint) security invoker;
alter function private.check_leave(uuid, text, date, date, boolean) security invoker;
alter function private.leave_day_rows(text, date, date, boolean) security invoker;

-- สคีมา private ไม่ได้เปิดเป็น API จึงเรียกฟังก์ชันเหล่านี้ได้เฉพาะจากใน RPC ข้างบน
grant execute on function
  private.require_ready(), private.today(), private.th_date(date), private.fmt_days(numeric),
  private.check_leave(uuid, text, date, date, boolean),
  private.leave_day_rows(text, date, date, boolean)
  to authenticated;
