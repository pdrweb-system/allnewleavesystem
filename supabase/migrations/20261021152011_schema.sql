-- ระบบใบลาออนไลน์ v2: ตารางหลัก
-- วันที่ทุกช่องเก็บเป็น ค.ศ. หน้าเว็บแปลงเป็น พ.ศ. ตอนแสดงผลเท่านั้น

create schema if not exists private;

create type public.app_role as enum ('teacher', 'hr', 'deputy', 'director');
create type public.leave_status as enum
  ('pending_hr', 'pending_deputy', 'pending_director', 'approved', 'rejected', 'cancelled');

-- ผู้ใช้ ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- ชื่อล็อกอิน หน้าเว็บต่อท้ายด้วยโดเมนภายในเป็นอีเมลของ Supabase Auth
  user_code text not null unique
    constraint profiles_user_code_format check (user_code ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  full_name text not null
    constraint profiles_full_name_len check (char_length(btrim(full_name)) between 1 and 120),
  position text not null
    constraint profiles_position_len check (char_length(btrim(position)) between 1 and 120),
  role public.app_role not null default 'teacher',
  is_admin boolean not null default false,
  -- ลายเซ็นตายตัวของผู้อนุมัติ (bucket approver-signatures)
  signature_path text,
  must_change_password boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- หัวหน้าฝ่ายบุคลากร / รอง ผอ. / ผอ. ที่ยังใช้งานอยู่มีได้ตำแหน่งละ 1 คน
create unique index profiles_one_active_approver_per_role
  on public.profiles (role) where active and role <> 'teacher';

-- ประเภทการลา (4 ประเภทตามแบบฟอร์มเดิม แอดมินแก้ได้เฉพาะโควตาและวิธีนับ) -----
create table public.leave_types (
  code text primary key,
  label text not null,
  form_label text not null,          -- ข้อความหลังช่องติ๊กในใบลา
  sort smallint not null,
  quota_days numeric(5,1)            -- วันต่อรอบ; null = ไม่กำหนด
    constraint leave_types_quota_days check (quota_days is null or quota_days > 0),
  quota_mode text not null default 'none'
    constraint leave_types_quota_mode check (quota_mode in ('none', 'warn', 'block')),
  requires_cert boolean not null default false,
  -- true = นับทุกวันรวมวันหยุด (ระเบียบการลาฯ 2555 ข้อ 8: ลาคลอดนับต่อเนื่องรวมวันหยุด)
  count_calendar_days boolean not null default false,
  constraint leave_types_quota_needs_days check (quota_mode = 'none' or quota_days is not null)
);

insert into public.leave_types (code, label, form_label, sort, count_calendar_days) values
  ('sick', 'ลาป่วย', 'ป่วย', 1, false),
  ('personal', 'ลากิจ', 'กิจส่วนตัว', 2, false),
  ('maternity', 'ลาคลอด', 'คลอดบุตร', 3, true),
  ('wife_childbirth', 'ลาไปช่วยเหลือภริยาที่คลอดบุตร', 'ไปช่วยเหลือภริยาที่คลอดบุตร', 4, false);

-- รอบการลา (ครึ่งปีงบประมาณ) ห้ามช่วงวันซ้อนกัน ---------------------------
create table public.leave_rounds (
  id bigint generated always as identity primary key,
  label text not null unique
    constraint leave_rounds_label_len check (char_length(btrim(label)) between 1 and 40),
  start_date date not null,
  end_date date not null,
  constraint leave_rounds_dates check (end_date >= start_date),
  constraint leave_rounds_no_overlap exclude using gist (daterange(start_date, end_date, '[]') with &&)
);

insert into public.leave_rounds (label, start_date, end_date) values
  ('2/2569', '2026-04-01', '2026-09-30'),
  ('1/2570', '2026-10-01', '2027-03-31');

-- วันหยุดนักขัตฤกษ์/วันหยุดโรงเรียน (แอดมินกรอก) -------------------------
create table public.holidays (
  day date primary key,
  name text not null
    constraint holidays_name_len check (char_length(btrim(name)) between 1 and 120)
);

-- ใบลา -----------------------------------------------------------------------
create table public.leaves (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id),
  snap_name text not null,            -- ชื่อ/ตำแหน่ง ณ วันยื่น
  snap_position text not null,
  leave_type text not null references public.leave_types (code),
  from_date date not null,
  to_date date not null,
  total_days numeric(4,1) not null
    constraint leaves_total_days check (total_days > 0),
  half_day boolean not null default false,
  reason text not null,
  contact_phone text not null,
  filed_date date not null,           -- เซิร์ฟเวอร์กำหนด (เวลาไทย)
  signature_path text,
  cert_path text,
  -- ขั้นอนุมัติที่ใบนี้ต้องผ่าน (ผู้ยื่นที่เป็นผู้อนุมัติข้ามขั้นของตัวเอง)
  steps public.app_role[] not null default '{hr,deputy,director}',
  status public.leave_status not null,
  cancelled_at timestamptz,
  legacy_pdf_url text,                -- ข้อมูลที่ย้ายมาจากระบบเดิม
  legacy_row_no int unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leaves_dates check (to_date >= from_date),
  constraint leaves_half_day check (not half_day or from_date = to_date),
  constraint leaves_signature check (signature_path is not null or legacy_row_no is not null),
  constraint leaves_steps check (
    steps::text[] in ('{hr,deputy,director}'::text[], '{deputy,director}'::text[], '{hr,director}'::text[])),
  constraint leaves_pending_step check (
    status not in ('pending_hr', 'pending_deputy', 'pending_director')
    or substr(status::text, 9) = any (steps::text[]))
);

create index leaves_user_id_from_date_idx on public.leaves (user_id, from_date);
create index leaves_status_idx on public.leaves (status);
create index leaves_leave_type_idx on public.leaves (leave_type);

-- วันลาแต่ละวันที่นับจริง (ใช้คำนวณสถิติตามรอบ ตรวจวันซ้อน และปฏิทิน)
create table public.leave_days (
  leave_id bigint not null references public.leaves (id) on delete cascade,
  day date not null,
  portion numeric(2,1) not null
    constraint leave_days_portion check (portion in (0.5, 1.0)),
  primary key (leave_id, day)
);

create index leave_days_day_idx on public.leave_days (day);

-- ประวัติการพิจารณา (เพิ่มได้อย่างเดียว ห้ามแก้/ลบ) ------------------------
create table public.approvals (
  id bigint generated always as identity primary key,
  leave_id bigint not null references public.leaves (id),
  step public.app_role not null
    constraint approvals_step check (step <> 'teacher'),
  decision text not null
    constraint approvals_decision check (decision in ('approve', 'reject')),
  reason text,
  decided_by uuid references public.profiles (id),
  snap_name text,                     -- ชื่อ/ตำแหน่ง/ลายเซ็นผู้พิจารณา ณ เวลาที่กด
  snap_position text,
  signature_path text,
  approve_date date,                  -- วันที่อนุญาตที่ ผอ. เลือก
  decided_at timestamptz not null default now(),
  constraint approvals_one_per_step unique (leave_id, step),
  constraint approvals_reject_reason check (
    decision = 'approve' or char_length(btrim(coalesce(reason, ''))) > 0),
  constraint approvals_signature_on_approve check (decision = 'approve' or signature_path is null)
);

create index approvals_decided_by_idx on public.approvals (decided_by);

-- ค่าตั้งค่าที่แสดงบนหน้าเว็บ/ใบลา (ห้ามเก็บ secret ที่นี่: ผู้ล็อกอินทุกคนอ่านได้)
create table public.app_settings (
  key text primary key
    constraint app_settings_key_format check (key ~ '^[a-z_]{1,40}$'),
  value jsonb not null
);

insert into public.app_settings (key, value) values
  ('school_name', to_jsonb('โรงเรียนวัดปรีดาราม (มณีศิริวรรณ)'::text)),
  ('form_title', to_jsonb('แบบใบลาป่วย ลากิจส่วนตัว ลาคลอด'::text)),
  ('addressee', to_jsonb('ผู้อำนวยการโรงเรียนวัดปรีดาราม (มณีศิริวรรณ)'::text)),
  ('hr_title', to_jsonb('หัวหน้าฝ่ายบริหารงานบุคคล'::text)),
  ('deputy_title', to_jsonb('รองผู้อำนวยการโรงเรียนวัดปรีดาราม (มณีศิริวรรณ)'::text)),
  ('director_title', to_jsonb('ผู้อำนวยการโรงเรียนวัดปรีดาราม (มณีศิริวรรณ)'::text)),
  ('deputy_approve_text', to_jsonb('เห็นควรอนุญาตดำเนินการตามคำขอ'::text)),
  ('deputy_reject_text', to_jsonb('ไม่เห็นควรอนุญาต'::text));

-- updated_at ----------------------------------------------------------------
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger leaves_touch_updated_at before update on public.leaves
  for each row execute function private.touch_updated_at();

-- ประวัติการพิจารณาห้ามแก้หรือลบ
create function private.forbid_approval_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'ห้ามแก้ไขหรือลบประวัติการพิจารณาใบลา' using errcode = '42501';
end $$;

create trigger approvals_append_only before update or delete on public.approvals
  for each row execute function private.forbid_approval_change();
