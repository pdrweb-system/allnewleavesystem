-- รูปพื้นหลังหน้าล็อกอิน: bucket สาธารณะอันเดียวของระบบ (login-assets)
-- เหตุผล: หน้าล็อกอินแสดงก่อนเข้าสู่ระบบ จึงขอ signed URL ไม่ได้ → รูปในนี้ทุกคนเห็นได้ จึงห้ามเก็บอย่างอื่น
-- เขียน/ลบได้เฉพาะแอดมิน จำกัดชนิดรูปและขนาด ชื่อไฟล์เป็น uuid ใหม่ทุกครั้ง (ไม่มีการเขียนทับ)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('login-assets', 'login-assets', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "login assets: admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'login-assets' and (select private.is_admin()));
create policy "login assets: admin read" on storage.objects for select to authenticated
  using (bucket_id = 'login-assets' and (select private.is_admin()));
create policy "login assets: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'login-assets' and (select private.is_admin()));

alter table public.login_page
  add column bg_image text constraint login_page_bg_image_format check (bg_image ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$'),
  add column bg_dim smallint not null default 35 constraint login_page_bg_dim_range check (bg_dim between 0 and 80);
alter table public.login_page drop constraint login_page_background_kind;
alter table public.login_page add constraint login_page_background_kind
  check (background in ('plain', 'soft', 'gradient', 'image'));
grant update (bg_image, bg_dim) on public.login_page to authenticated;
