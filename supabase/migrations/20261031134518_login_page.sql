-- ตั้งค่าหน้าล็อกอิน (ปรับแต่งจากหน้าแอดมิน "หน้าล็อกอิน")
-- ตารางนี้ anon อ่านได้ เพราะหน้าล็อกอินแสดงก่อนเข้าสู่ระบบ → ห้ามเก็บข้อมูลลับ/ข้อมูลส่วนบุคคลที่นี่
-- มีแถวเดียว (id = 1) แก้ได้เฉพาะแอดมิน ไม่มีสิทธิ์ insert/delete
create table public.login_page (
  id smallint primary key default 1 constraint login_page_single check (id = 1),
  title text not null default 'ระบบใบลาออนไลน์' constraint login_page_title_len check (char_length(title) between 1 and 60),
  subtitle text not null default 'โรงเรียนวัดปรีดาราม (มณีศิริวรรณ)' constraint login_page_subtitle_len check (char_length(subtitle) <= 100),
  logo_text text not null default 'ลา' constraint login_page_logo_len check (char_length(logo_text) <= 4),
  welcome_text text not null default '' constraint login_page_welcome_len check (char_length(welcome_text) <= 200),
  code_label text not null default 'รหัสเข้าใช้' constraint login_page_code_label_len check (char_length(code_label) between 1 and 40),
  code_placeholder text not null default '' constraint login_page_placeholder_len check (char_length(code_placeholder) <= 60),
  button_label text not null default 'เข้าสู่ระบบ' constraint login_page_button_len check (char_length(button_label) between 1 and 30),
  show_remember boolean not null default true,
  remember_label text not null default 'จดจำการเข้าสู่ระบบในเครื่องนี้' constraint login_page_remember_len check (char_length(remember_label) between 1 and 80),
  help_text text not null default 'ลืมรหัส? ติดต่อแอดมิน (ฝ่ายบริหารงานบุคคล) เพื่อตั้งรหัสใหม่' constraint login_page_help_len check (char_length(help_text) <= 200),
  footer_text text not null default '' constraint login_page_footer_len check (char_length(footer_text) <= 200),
  accent text not null default '#0f5e57' constraint login_page_accent_hex check (accent ~ '^#[0-9a-fA-F]{6}$'),
  background text not null default 'soft' constraint login_page_background_kind check (background in ('plain', 'soft', 'gradient')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
insert into public.login_page (id) values (1);

create trigger login_page_touch before update on public.login_page
  for each row execute function private.touch_updated_at();

alter table public.login_page enable row level security;
create policy login_page_select on public.login_page for select to anon, authenticated using (true);
create policy login_page_update on public.login_page for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on public.login_page from anon, authenticated;
grant select on public.login_page to anon, authenticated;
grant update (title, subtitle, logo_text, welcome_text, code_label, code_placeholder, button_label,
              show_remember, remember_label, help_text, footer_text, accent, background, updated_by)
  on public.login_page to authenticated;

create index login_page_updated_by_idx on public.login_page (updated_by);
