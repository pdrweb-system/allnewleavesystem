-- ใช้เฉพาะทดสอบบน Postgres ในเครื่อง (ห้ามรันบนโปรเจกต์ Supabase จริง)
-- จำลองบทบาท สคีมา auth/storage และสิทธิ์ตั้งต้นให้ใกล้กับโปรเจกต์ Supabase
-- รันด้วย superuser (supabase_admin) บนฐานข้อมูลเปล่า

-- บทบาทเป็นของทั้งคลัสเตอร์ สร้างครั้งเดียวแล้วใช้ซ้ำได้หลายฐานข้อมูลทดสอบ
do $$
declare
  r text;
begin
  foreach r in array array['postgres', 'anon', 'authenticated', 'service_role', 'authenticator',
                           'supabase_auth_admin', 'supabase_storage_admin'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I', r);
    end if;
  end loop;
end $$;
alter role postgres login createrole bypassrls;
alter role anon nologin noinherit;
alter role authenticated nologin noinherit;
alter role service_role nologin noinherit bypassrls;
alter role authenticator login noinherit;
alter role supabase_auth_admin login noinherit createrole;
alter role supabase_storage_admin login noinherit createrole;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role, authenticator to postgres;
-- บน Supabase จริง postgres สร้าง policy บน storage.objects ได้ผ่าน supautils
grant supabase_storage_admin, supabase_auth_admin to postgres;

do $$ begin
  execute format('grant create, connect on database %I to postgres', current_database());
end $$;
alter schema public owner to postgres;
grant usage on schema public to anon, authenticated, service_role;

-- ค่าตั้งต้นเหมือนโปรเจกต์ใหม่: anon/authenticated ได้ทุกสิทธิ์บนตาราง/ฟังก์ชันใหม่ใน public
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;

create schema extensions;
grant usage, create on schema extensions to postgres;
grant usage on schema extensions to anon, authenticated, service_role;

-- auth --------------------------------------------------------------------
create schema auth authorization supabase_auth_admin;
grant usage on schema auth to postgres, anon, authenticated, service_role;

create table auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  banned_until timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_anonymous boolean not null default false
);
alter table auth.users owner to supabase_auth_admin;
grant all on auth.users to postgres;

create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
alter function auth.uid() owner to supabase_auth_admin;
alter function auth.role() owner to supabase_auth_admin;
alter function auth.jwt() owner to supabase_auth_admin;

-- storage -----------------------------------------------------------------
create schema storage authorization supabase_storage_admin;
grant usage on schema storage to postgres, anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner_id text
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  version text,
  owner_id text,
  user_metadata jsonb,
  unique (bucket_id, name)
);
alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to postgres, service_role;
grant select, insert, update, delete on storage.buckets, storage.objects to anon, authenticated;

create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end $$;
alter function storage.foldername(text) owner to supabase_storage_admin;

create function storage.protect_delete() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
      using errcode = '42501';
  end if;
  return null;
end $$;
create trigger protect_objects_delete before delete on storage.objects
  for each statement execute function storage.protect_delete();
