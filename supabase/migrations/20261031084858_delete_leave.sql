-- ลบใบลาที่ยกเลิกแล้ว (เจ้าของเท่านั้น)
-- ใบที่ยกเลิกได้ต้องยังไม่มีผู้พิจารณา จึงไม่มีประวัติ approvals ที่ต้องเก็บ ลบแล้วสถิติ/ยอดลาไม่เปลี่ยน
-- (ใบที่ยกเลิกไม่ถูกนับอยู่แล้ว) ไฟล์ลายเซ็น/ใบรับรองแพทย์ลบผ่าน Storage API ก่อนเรียกฟังก์ชันนี้ ตามนโยบายด้านล่าง
create function public.delete_leave(p_leave_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me public.profiles := private.require_ready();
  lv public.leaves;
begin
  select * into lv from public.leaves where id = p_leave_id for update;
  if lv.id is null or lv.user_id <> me.id then
    raise exception 'ไม่พบใบลา';
  end if;
  if lv.status <> 'cancelled' or exists (select 1 from public.approvals a where a.leave_id = lv.id) then
    raise exception 'ลบได้เฉพาะใบลาที่ยกเลิกแล้ว';
  end if;
  delete from public.line_notifications where leave_id = lv.id;
  delete from public.leaves where id = lv.id; -- leave_days ถูกลบตาม (on delete cascade)
  return jsonb_build_object('id', lv.id, 'deleted', true);
end $$;

revoke all on function public.delete_leave(bigint) from public, anon, authenticated;
grant execute on function public.delete_leave(bigint) to authenticated;

-- เจ้าของลบไฟล์ของใบที่ยกเลิกแล้วได้ (ไฟล์ที่ใบอื่นที่ยังไม่ยกเลิกอ้างอยู่ ลบไม่ได้)
create policy "leave files: delete own files of cancelled leaves" on storage.objects for delete to authenticated
  using (
    bucket_id in ('leave-signatures', 'leave-certs')
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.leaves l
                where l.user_id = (select auth.uid()) and l.status = 'cancelled'
                  and (l.signature_path = name or l.cert_path = name))
    and not exists (select 1 from public.leaves l
                    where l.user_id = (select auth.uid()) and l.status <> 'cancelled'
                      and (l.signature_path = name or l.cert_path = name))
  );
