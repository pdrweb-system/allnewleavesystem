-- ไฟล์ทั้งหมดอยู่ใน bucket ส่วนตัว หน้าเว็บเปิดดูผ่าน signed URL อายุสั้นเท่านั้น
--   leave-signatures    {user_id}/{uuid}.png  ลายเซ็นครูต่อใบลา
--   leave-certs         {user_id}/{uuid}.jpg  ใบรับรองแพทย์ (บีบรูปฝั่งเบราว์เซอร์ก่อนอัปโหลด)
--   approver-signatures {user_id}/{uuid}.png  ลายเซ็นตายตัวของผู้อนุมัติ (แอดมินอัปโหลด)
-- ไฟล์ตั้งชื่อใหม่ทุกครั้งและไม่มีสิทธิ์แก้/ลบ ใบลาเก่าจึงอ้างไฟล์เดิมได้เสมอ

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('leave-signatures', 'leave-signatures', false, 512000, array['image/png']),
  ('leave-certs', 'leave-certs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('approver-signatures', 'approver-signatures', false, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- อัปโหลด: ครูเขียนได้เฉพาะโฟลเดอร์ของตัวเอง, ลายเซ็นผู้อนุมัติเขียนได้เฉพาะแอดมิน
create policy "leave files: upload" on storage.objects for insert to authenticated
  with check (
    (bucket_id in ('leave-signatures', 'leave-certs')
     and (storage.foldername(name))[1] = (select auth.uid())::text
     and (select private.is_ready()))
    or (bucket_id = 'approver-signatures' and (select private.is_admin()))
  );

-- อ่าน: ไฟล์ใบลาเฉพาะเจ้าของหรือผู้อนุมัติ/แอดมิน, ลายเซ็นผู้อนุมัติทุกคนที่ล็อกอิน (อยู่บนใบลาอยู่แล้ว)
create policy "leave files: read" on storage.objects for select to authenticated
  using (
    (bucket_id in ('leave-signatures', 'leave-certs')
     and ((storage.foldername(name))[1] = (select auth.uid())::text
          or (select private.can_view_all())))
    or (bucket_id = 'approver-signatures' and (select private.is_ready()))
  );
