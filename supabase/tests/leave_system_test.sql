-- ชุดทดสอบตรรกะและสิทธิ์ของระบบใบลา (ข้อมูลสมมติทั้งหมด)
-- รันทั้งไฟล์ด้วยสิทธิ์ postgres ได้ทั้งในเครื่องและบนโปรเจกต์จริง (SQL editor / MCP)
-- ทุกอย่างอยู่ในบล็อกเดียวและจบด้วย raise exception จึง rollback เองเสมอ
-- ผลลัพธ์อยู่ในข้อความ error: "TEST REPORT: pass=… fail=…" ตามด้วยรายการที่ไม่ผ่าน
--
-- ปฏิทินทดสอบ (ปี 2090 ไม่ชนกับรอบจริง): รอบ T1 = ม.ค. 2090, T2 = ก.พ. 2090
--   2 ม.ค. = จันทร์ | 7–8 = ส–อา | 10 = วันหยุดทดสอบ (อังคาร) | 30 = จันทร์ | 1 ก.พ. = พุธ | 6 ก.พ. = จันทร์

do $test$
declare
  pass int := 0;
  fail int := 0;
  failures text := '';

  u_hr uuid := '00000000-0000-4000-8000-000000000001';
  u_deputy uuid := '00000000-0000-4000-8000-000000000002';
  u_director uuid := '00000000-0000-4000-8000-000000000003';
  u_t1 uuid := '00000000-0000-4000-8000-000000000011';
  u_t2 uuid := '00000000-0000-4000-8000-000000000012';
  u_admin uuid := '00000000-0000-4000-8000-000000000021';    -- ครูที่เป็นแอดมิน
  u_new uuid := '00000000-0000-4000-8000-000000000031';      -- ยังไม่เปลี่ยนรหัสผ่าน
  u_off uuid := '00000000-0000-4000-8000-000000000032';      -- ถูกปิดบัญชี
  u_stranger uuid := '00000000-0000-4000-8000-000000000041'; -- มีบัญชี Auth แต่ไม่มี profile

  res jsonb;
  st jsonb;
  n int;
  m int;
  ok boolean;
  v_day date;
  l_sick bigint;
  l_half bigint;
  l_cross bigint;
  l_t2 bigint;
  l_hr_own bigint;
  l_dep_own bigint;
  l_feb bigint;
  l_now bigint;
  l_del bigint;
  cert_del text;
  sig_t1 text;
  sig_t2 text;
  cert_t1 text;
  sig_hr text;
  sig_dep text;
begin
  -- ---------------------------------------------------------------------
  -- เตรียมข้อมูล (สิทธิ์ postgres)
  -- ---------------------------------------------------------------------
  insert into auth.users (id, email, encrypted_password) values
    (u_hr, 'test-hr@test.invalid', 'x'), (u_deputy, 'test-deputy@test.invalid', 'x'),
    (u_director, 'test-director@test.invalid', 'x'), (u_t1, 'test-t1@test.invalid', 'x'),
    (u_t2, 'test-t2@test.invalid', 'x'), (u_admin, 'test-admin@test.invalid', 'x'),
    (u_new, 'test-new@test.invalid', 'x'), (u_off, 'test-off@test.invalid', 'x'),
    (u_stranger, 'test-stranger@test.invalid', 'x');

  -- ปิดผู้อนุมัติจริงชั่วคราว (ถ้ามี) เพื่อใช้ผู้อนุมัติสมมติแทนในธุรกรรมนี้
  update public.profiles set active = false where role <> 'teacher' and active;

  insert into public.profiles (id, user_code, full_name, position, role, is_admin,
    must_change_password, active, signature_path) values
    (u_hr, 'test-hr', 'หัวหน้า ทดสอบ', 'ครู', 'hr', false, false, true, u_hr || '/sig.png'),
    (u_deputy, 'test-deputy', 'รอง ทดสอบ', 'รองผู้อำนวยการ', 'deputy', false, false, true, u_deputy || '/sig.png'),
    (u_director, 'test-director', 'ผอ ทดสอบ', 'ผู้อำนวยการ', 'director', false, false, true, null),
    (u_t1, 'test-t1', 'ครูหนึ่ง ทดสอบ', 'ครู', 'teacher', false, false, true, null),
    (u_t2, 'test-t2', 'ครูสอง ทดสอบ', 'ครู', 'teacher', false, false, true, null),
    (u_admin, 'test-admin', 'แอดมิน ทดสอบ', 'ครู', 'teacher', true, false, true, null),
    (u_new, 'test-new', 'ครูใหม่ ทดสอบ', 'ครู', 'teacher', false, true, true, null),
    (u_off, 'test-off', 'ครูปิด ทดสอบ', 'ครู', 'teacher', false, false, false, null);

  insert into public.leave_rounds (label, start_date, end_date) values
    ('T1', '2090-01-01', '2090-01-31'),
    ('T2', '2090-02-01', '2090-02-28');
  insert into public.holidays (day, name) values ('2090-01-10', 'วันหยุดทดสอบ');

  sig_t1 := u_t1 || '/' || gen_random_uuid() || '.png';
  sig_t2 := u_t2 || '/' || gen_random_uuid() || '.png';
  cert_t1 := u_t1 || '/' || gen_random_uuid() || '.jpg';
  sig_hr := u_hr || '/' || gen_random_uuid() || '.png';
  sig_dep := u_deputy || '/' || gen_random_uuid() || '.png';
  insert into storage.objects (bucket_id, name, owner, owner_id) values
    ('leave-signatures', sig_t1, u_t1, u_t1::text),
    ('leave-signatures', sig_t2, u_t2, u_t2::text),
    ('leave-certs', cert_t1, u_t1, u_t1::text),
    ('leave-signatures', sig_hr, u_hr, u_hr::text),
    ('leave-signatures', sig_dep, u_deputy, u_deputy::text);

  -- ผู้อนุมัติแต่ละตำแหน่งมีได้คนเดียว
  begin
    insert into public.profiles (id, user_code, full_name, position, role)
    values (u_stranger, 'test-hr2', 'หัวหน้าคนที่สอง', 'ครู', 'hr');
    fail := fail + 1; failures := failures || E'\n- มีหัวหน้าฝ่ายบุคลากรที่ใช้งานอยู่ 2 คนได้';
  exception when unique_violation then pass := pass + 1;
  end;

  -- ---------------------------------------------------------------------
  -- 1. การนับวัน
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  res := public.preview_leave('sick', '2090-01-05', '2090-01-12', false);  -- พฤ.5 – พฤ.12
  if (res ->> 'total_days')::numeric = 5 and (res ->> 'ok')::boolean then pass := pass + 1;  -- 5,6,9,11,12
  else fail := fail + 1; failures := failures || format(E'\n- ตัดเสาร์-อาทิตย์และวันหยุด: ได้ %s ควรได้ 5', res ->> 'total_days'); end if;

  res := public.preview_leave('sick', '2090-01-07', '2090-01-08', false);
  if not (res ->> 'ok')::boolean and (res ->> 'total_days')::numeric = 0 then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- ลาเฉพาะเสาร์-อาทิตย์ต้องได้ 0 วันและไม่ผ่าน'; end if;

  res := public.preview_leave('sick', '2090-01-10', '2090-01-10', false);
  if not (res ->> 'ok')::boolean then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- ลาวันหยุดในตาราง holidays ต้องไม่ผ่าน'; end if;

  res := public.preview_leave('personal', '2090-01-03', '2090-01-03', true);
  if (res ->> 'total_days')::numeric = 0.5 and (res ->> 'ok')::boolean then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- ครึ่งวันต้องได้ 0.5'; end if;

  res := public.preview_leave('personal', '2090-01-03', '2090-01-04', true);
  if not (res ->> 'ok')::boolean then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- ครึ่งวันแบบหลายวันต้องไม่ผ่าน'; end if;

  res := public.preview_leave('maternity', '2090-01-05', '2090-01-12', false);
  if (res ->> 'total_days')::numeric = 8 then pass := pass + 1;
  else fail := fail + 1; failures := failures || format(E'\n- ลาคลอดนับทุกวัน: ได้ %s ควรได้ 8', res ->> 'total_days'); end if;

  res := public.preview_leave('sick', '2090-01-12', '2090-01-05', false);
  if not (res ->> 'ok')::boolean then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- วันสิ้นสุดก่อนวันเริ่มต้องไม่ผ่าน'; end if;

  res := public.preview_leave('sick', '2091-06-01', '2091-06-01', false);
  if not (res ->> 'ok')::boolean then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- วันที่นอกรอบการลาต้องไม่ผ่าน'; end if;

  res := public.preview_leave('nope', '2090-01-03', '2090-01-03', false);
  if not (res ->> 'ok')::boolean then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- ประเภทการลาที่ไม่มีต้องไม่ผ่าน'; end if;

  -- ---------------------------------------------------------------------
  -- 2. ยื่นใบลา (ครู 1)
  -- ---------------------------------------------------------------------
  res := public.submit_leave('sick', '2090-01-05', '2090-01-06', false, 'ไข้หวัด', '0812345678', sig_t1, cert_t1);
  l_sick := (res ->> 'id')::bigint;
  if res ->> 'status' = 'pending_hr' and (res ->> 'total_days')::numeric = 2 then pass := pass + 1;
  else fail := fail + 1; failures := failures || format(E'\n- ยื่นใบลาป่วย: %s', res); end if;

  reset role;
  select count(*) into n from public.leave_days where leave_id = l_sick;
  select filed_date = (now() at time zone 'Asia/Bangkok')::date into ok from public.leaves where id = l_sick;
  if n = 2 and ok then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- สร้าง leave_days หรือ filed_date (เวลาไทย) ไม่ถูกต้อง'; end if;
  set local role authenticated;

  begin
    res := public.submit_leave('personal', '2090-01-06', '2090-01-06', false, 'ธุระ', '081', sig_t1, null);
    fail := fail + 1; failures := failures || E'\n- ยื่นวันซ้อนต้องไม่ผ่าน';
  exception when others then
    if sqlerrm like 'วันที่ลาซ้อน%' then pass := pass + 1;
    else fail := fail + 1; failures := failures || E'\n- วันซ้อน ข้อความผิด: ' || sqlerrm; end if;
  end;
  begin
    res := public.submit_leave('personal', '2090-01-13', '2090-01-13', false, 'ธุระ', '081', sig_t2, null);
    fail := fail + 1; failures := failures || E'\n- ใช้ไฟล์ลายเซ็นของคนอื่นได้';
  exception when others then pass := pass + 1;
  end;
  begin
    res := public.submit_leave('personal', '2090-01-13', '2090-01-13', false, 'ธุระ', '081',
      u_t1 || '/' || gen_random_uuid() || '.png', null);
    fail := fail + 1; failures := failures || E'\n- ใช้ไฟล์ลายเซ็นที่ไม่ได้อัปโหลดได้';
  exception when others then pass := pass + 1;
  end;
  begin
    res := public.submit_leave('personal', '2090-01-13', '2090-01-13', false, '   ', '081', sig_t1, null);
    fail := fail + 1; failures := failures || E'\n- เหตุผลว่างต้องไม่ผ่าน';
  exception when others then pass := pass + 1;
  end;

  res := public.submit_leave('personal', '2090-01-13', '2090-01-13', true, 'ธุระครึ่งวัน', '081', sig_t1, null);
  l_half := (res ->> 'id')::bigint;
  if (res ->> 'total_days')::numeric = 0.5 then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- ยื่นครึ่งวันต้องได้ 0.5'; end if;

  -- คาบเกี่ยวสองรอบ: จ.30 – ศ.3 ก.พ. = 30, 31 (T1) + 1, 2, 3 (T2)
  res := public.submit_leave('personal', '2090-01-30', '2090-02-03', false, 'ธุระต่างจังหวัด', '081', sig_t1, null);
  l_cross := (res ->> 'id')::bigint;
  if (res ->> 'total_days')::numeric = 5 then pass := pass + 1;
  else fail := fail + 1; failures := failures || format(E'\n- ใบคาบเกี่ยวสองรอบควรได้ 5 วัน: %s', res); end if;

  -- เขียนตารางตรง ๆ จากหน้าเว็บไม่ได้
  begin
    insert into public.leaves (user_id, snap_name, snap_position, leave_type, from_date, to_date, total_days,
      reason, contact_phone, filed_date, signature_path, status)
    values (u_t1, 'x', 'x', 'sick', '2090-01-20', '2090-01-20', 1, 'x', 'x', '2090-01-20', sig_t1, 'approved');
    fail := fail + 1; failures := failures || E'\n- ครู insert leaves ตรงได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  begin
    update public.leaves set status = 'approved' where id = l_sick;
    fail := fail + 1; failures := failures || E'\n- ครู update leaves ตรงได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  begin
    delete from public.leaves where id = l_sick;
    fail := fail + 1; failures := failures || E'\n- ครู delete leaves ตรงได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  begin
    insert into public.approvals (leave_id, step, decision, decided_by) values (l_sick, 'hr', 'approve', u_t1);
    fail := fail + 1; failures := failures || E'\n- ครู insert approvals ตรงได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  begin
    insert into public.leave_days (leave_id, day, portion) values (l_sick, '2090-01-20', 1);
    fail := fail + 1; failures := failures || E'\n- ครู insert leave_days ตรงได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  begin
    update public.profiles set is_admin = true where id = u_t1;
    fail := fail + 1; failures := failures || E'\n- ครูตั้งตัวเองเป็นแอดมินได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  begin
    update public.leave_types set quota_days = 99 where code = 'sick';
    get diagnostics n = row_count;
    if n = 0 then pass := pass + 1;
    else fail := fail + 1; failures := failures || E'\n- ครูแก้โควตาได้'; end if;
  exception when insufficient_privilege then pass := pass + 1;
  end;
  begin
    res := public.decide_leave(l_sick, 'approve');
    fail := fail + 1; failures := failures || E'\n- ครูอนุมัติใบลาได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;

  -- ---------------------------------------------------------------------
  -- 3. ครู 2 เข้าถึงข้อมูล/ไฟล์ของครู 1 ไม่ได้
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_t2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.leaves where user_id = u_t1;
  if n = 0 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- ครู 2 เห็นใบลาครู 1'; end if;
  select count(*) into n from public.leave_days where leave_id = l_sick;
  if n = 0 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- ครู 2 เห็นวันลาครู 1'; end if;
  select count(*) into n from public.approvals;
  if n = 0 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- ครู 2 เห็นประวัติการพิจารณาของคนอื่น'; end if;
  select count(*) into n from public.profiles where id <> u_t2;
  if n = 0 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- ครู 2 เห็น profiles คนอื่น'; end if;
  select count(*) into n from storage.objects
    where bucket_id in ('leave-signatures', 'leave-certs') and owner_id = u_t1::text;
  if n = 0 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- ครู 2 เห็นไฟล์ลายเซ็น/ใบรับรองแพทย์ครู 1'; end if;
  begin
    res := public.get_leave_form(l_sick);
    fail := fail + 1; failures := failures || E'\n- ครู 2 เปิดใบลาครู 1 ได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  begin
    res := public.cancel_leave(l_sick);
    fail := fail + 1; failures := failures || E'\n- ครู 2 ยกเลิกใบลาครู 1 ได้';
  exception when others then pass := pass + 1;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('leave-signatures', u_t1 || '/' || gen_random_uuid() || '.png', u_t2, u_t2::text);
    fail := fail + 1; failures := failures || E'\n- ครู 2 อัปโหลดไฟล์ลงโฟลเดอร์ครู 1 ได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('approver-signatures', u_t2 || '/' || gen_random_uuid() || '.png', u_t2, u_t2::text);
    fail := fail + 1; failures := failures || E'\n- ครูอัปโหลดลายเซ็นผู้อนุมัติได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('leave-certs', u_t2 || '/' || gen_random_uuid() || '.jpg', u_t2, u_t2::text);
    pass := pass + 1;
  exception when others then
    fail := fail + 1; failures := failures || E'\n- ครูอัปโหลดไฟล์ลงโฟลเดอร์ตัวเองไม่ได้: ' || sqlerrm;
  end;
  begin
    update storage.objects set name = name || 'x' where bucket_id = 'leave-certs';
    get diagnostics n = row_count;
    if n = 0 then pass := pass + 1;
    else fail := fail + 1; failures := failures || E'\n- ครูแก้ไฟล์ใน storage ได้'; end if;
  exception when insufficient_privilege then pass := pass + 1;
  end;

  res := public.submit_leave('sick', '2090-01-16', '2090-01-16', false, 'ปวดหัว', '082', sig_t2, null);
  l_t2 := (res ->> 'id')::bigint;

  -- ---------------------------------------------------------------------
  -- 4. ลำดับอนุมัติ หัวหน้าฝ่าย → รอง ผอ. → ผอ.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_deputy, 'role', 'authenticated')::text, true);
  begin
    res := public.decide_leave(l_sick, 'approve');
    fail := fail + 1; failures := failures || E'\n- รอง ผอ. อนุมัติข้ามขั้นได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_director, 'role', 'authenticated')::text, true);
  begin
    res := public.decide_leave(l_sick, 'reject', 'ข้ามขั้น');
    fail := fail + 1; failures := failures || E'\n- ผอ. พิจารณาข้ามขั้นได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_hr, 'role', 'authenticated')::text, true);
  select count(*) into n from public.leaves where user_id = u_t1;
  if n = 3 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- หัวหน้าฝ่ายมองไม่เห็นใบลาครู'; end if;
  begin
    res := public.decide_leave(l_t2, 'reject', '   ');
    fail := fail + 1; failures := failures || E'\n- ไม่อนุมัติโดยไม่มีเหตุผลได้';
  exception when others then pass := pass + 1;
  end;
  res := public.decide_leave(l_t2, 'reject', 'เอกสารไม่ครบ');
  if res ->> 'status' = 'rejected' then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- ไม่อนุมัติต้องจบที่ rejected ทันที'; end if;
  begin
    res := public.decide_leave(l_t2, 'approve');
    fail := fail + 1; failures := failures || E'\n- อนุมัติใบที่ไม่อนุมัติไปแล้วได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;

  res := public.decide_leave(l_sick, 'approve');
  if res ->> 'status' = 'pending_deputy' then pass := pass + 1;
  else fail := fail + 1; failures := failures || format(E'\n- หัวหน้าฝ่ายอนุมัติแล้วควรเป็น pending_deputy: %s', res); end if;
  begin
    res := public.decide_leave(l_sick, 'approve');
    fail := fail + 1; failures := failures || E'\n- หัวหน้าฝ่ายอนุมัติซ้ำได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  begin
    res := public.cancel_leave(l_sick);
    fail := fail + 1; failures := failures || E'\n- ยกเลิกใบที่มีผู้อนุมัติแล้วได้';
  exception when others then pass := pass + 1;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_deputy, 'role', 'authenticated')::text, true);
  res := public.decide_leave(l_sick, 'approve');
  if res ->> 'status' = 'pending_director' then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- รอง ผอ. อนุมัติแล้วควรเป็น pending_director'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_director, 'role', 'authenticated')::text, true);
  begin
    res := public.decide_leave(l_sick, 'approve');
    fail := fail + 1; failures := failures || E'\n- อนุมัติได้ทั้งที่ยังไม่มีลายเซ็นผู้อนุมัติ';
  exception when others then pass := pass + 1;
  end;
  reset role;
  update public.profiles set signature_path = u_director || '/sig.png' where id = u_director;
  set local role authenticated;
  begin
    res := public.decide_leave(l_sick, 'approve', null, (now() at time zone 'Asia/Bangkok')::date + 1);
    fail := fail + 1; failures := failures || E'\n- วันที่อนุญาตในอนาคตต้องไม่ผ่าน';
  exception when others then pass := pass + 1;
  end;
  begin
    res := public.decide_leave(l_sick, 'approve', null, (now() at time zone 'Asia/Bangkok')::date - 1);
    fail := fail + 1; failures := failures || E'\n- วันที่อนุญาตก่อนวันยื่นต้องไม่ผ่าน';
  exception when others then pass := pass + 1;
  end;
  res := public.decide_leave(l_sick, 'approve');
  if res ->> 'status' = 'approved' then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- ผอ. อนุมัติแล้วควรเป็น approved'; end if;

  reset role;
  select count(*) into n from public.approvals where leave_id = l_sick;
  select approve_date = (now() at time zone 'Asia/Bangkok')::date into ok
    from public.approvals where leave_id = l_sick and step = 'director';
  if n = 3 and ok then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- ต้องมีประวัติ 3 ขั้น และวันที่อนุญาตเริ่มต้น = วันนี้'; end if;

  begin
    update public.approvals set decision = 'reject', reason = 'x' where leave_id = l_sick;
    fail := fail + 1; failures := failures || E'\n- แก้ประวัติการพิจารณาได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  begin
    delete from public.approvals where leave_id = l_sick;
    fail := fail + 1; failures := failures || E'\n- ลบประวัติการพิจารณาได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;

  -- ---------------------------------------------------------------------
  -- 5. ผู้อนุมัติยื่นลาเอง → ข้ามขั้นของตัวเอง; ผอ. ยื่นในระบบไม่ได้
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_hr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.submit_leave('personal', '2090-01-20', '2090-01-20', false, 'ธุระ', '083', sig_hr, null);
  l_hr_own := (res ->> 'id')::bigint;
  if res ->> 'status' = 'pending_deputy' then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- ใบลาหัวหน้าฝ่ายควรเริ่มที่ pending_deputy'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_deputy, 'role', 'authenticated')::text, true);
  res := public.submit_leave('personal', '2090-01-19', '2090-01-19', false, 'ธุระ', '084', sig_dep, null);
  l_dep_own := (res ->> 'id')::bigint;
  if res ->> 'status' = 'pending_hr' then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- ใบลารอง ผอ. ควรเริ่มที่ pending_hr'; end if;
  begin
    res := public.decide_leave(l_dep_own, 'approve');
    fail := fail + 1; failures := failures || E'\n- รอง ผอ. อนุมัติใบตัวเองได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  res := public.decide_leave(l_hr_own, 'approve');
  if res ->> 'status' = 'pending_director' then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- รอง ผอ. อนุมัติใบหัวหน้าฝ่ายแล้วควรไป pending_director'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_hr, 'role', 'authenticated')::text, true);
  res := public.decide_leave(l_dep_own, 'approve');
  if res ->> 'status' = 'pending_director' then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- หัวหน้าฝ่ายอนุมัติใบรอง ผอ. แล้วควรข้ามไป pending_director'; end if;
  begin
    res := public.decide_leave(l_hr_own, 'approve');
    fail := fail + 1; failures := failures || E'\n- หัวหน้าฝ่ายอนุมัติใบตัวเองได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_director, 'role', 'authenticated')::text, true);
  begin
    res := public.submit_leave('personal', '2090-01-18', '2090-01-18', false, 'ธุระ', '085', sig_hr, null);
    fail := fail + 1; failures := failures || E'\n- ผอ. ยื่นใบลาในระบบได้';
  exception when others then pass := pass + 1;
  end;

  -- ---------------------------------------------------------------------
  -- 6. ยกเลิก
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  res := public.cancel_leave(l_half);
  if res ->> 'status' = 'cancelled' then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- เจ้าของยกเลิกใบที่ยังไม่มีใครพิจารณาไม่ได้'; end if;
  begin
    res := public.submit_leave('personal', '2090-01-13', '2090-01-13', false, 'ธุระ', '081', sig_t1, null);
    pass := pass + 1;
  exception when others then
    fail := fail + 1; failures := failures || E'\n- ยื่นวันเดียวกับใบที่ยกเลิกแล้วไม่ได้: ' || sqlerrm;
  end;

  -- ---------------------------------------------------------------------
  -- 6.1 ลบใบลาที่ยกเลิกแล้ว (เจ้าของเท่านั้น) พร้อมไฟล์ที่แนบ
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_t2, 'role', 'authenticated')::text, true);
  begin
    res := public.delete_leave(l_half);
    fail := fail + 1; failures := failures || E'\n- ครู 2 ลบใบลาครู 1 ได้';
  exception when others then pass := pass + 1;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  begin
    res := public.delete_leave(l_sick);
    fail := fail + 1; failures := failures || E'\n- ลบใบลาที่ยังไม่ยกเลิกได้';
  exception when others then pass := pass + 1;
  end;
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'leave-signatures' and name = sig_t1;
  get diagnostics n = row_count;
  if n = 0 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- ลบไฟล์ที่ใบลาอื่นยังใช้อยู่ได้'; end if;
  cert_del := u_t1 || '/' || gen_random_uuid() || '.jpg';
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('leave-certs', cert_del, u_t1, u_t1::text);
  res := public.submit_leave('sick', '2090-01-26', '2090-01-26', false, 'ไม่สบาย', '081', sig_t1, cert_del);
  l_del := (res ->> 'id')::bigint;
  delete from storage.objects where bucket_id = 'leave-certs' and name = cert_del;
  get diagnostics n = row_count;
  if n = 0 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- ลบไฟล์ของใบที่ยังไม่ยกเลิกได้'; end if;
  res := public.cancel_leave(l_del);
  delete from storage.objects where bucket_id = 'leave-certs' and name = cert_del;
  get diagnostics n = row_count;
  if n = 1 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- ลบไฟล์ใบรับรองของใบที่ยกเลิกแล้วไม่ได้'; end if;
  res := public.delete_leave(l_del);
  select count(*) into n from public.leaves where id = l_del;
  select count(*) into m from public.leave_days where leave_id = l_del;
  if n = 0 and m = 0 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- ลบใบที่ยกเลิกแล้วไม่ครบ (ใบ/วันลา)'; end if;
  begin
    res := public.delete_leave(l_del);
    fail := fail + 1; failures := failures || E'\n- ลบใบลาที่ลบไปแล้วซ้ำได้';
  exception when others then pass := pass + 1;
  end;
  perform set_config('storage.allow_delete_query', 'false', true);

  -- ---------------------------------------------------------------------
  -- 7. สถิติตามรอบ (ใบคาบเกี่ยวสองรอบ) และข้อมูลใบลา
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_hr, 'role', 'authenticated')::text, true);
  res := public.decide_leave(l_cross, 'approve');
  perform set_config('request.jwt.claims', json_build_object('sub', u_deputy, 'role', 'authenticated')::text, true);
  res := public.decide_leave(l_cross, 'approve');
  perform set_config('request.jwt.claims', json_build_object('sub', u_director, 'role', 'authenticated')::text, true);
  res := public.decide_leave(l_cross, 'approve');

  reset role;
  select count(*) filter (where day <= '2090-01-31'), count(*) filter (where day >= '2090-02-01')
    into n, m from public.leave_days where leave_id = l_cross;
  if n = 2 and m = 3 then pass := pass + 1;
  else fail := fail + 1; failures := failures || format(E'\n- แยกวันตามรอบผิด: T1=%s T2=%s', n, m); end if;

  -- ใบใหม่ในรอบ T2: ใบคาบเกี่ยวเริ่มในรอบ T1 → ลากิจมาแล้ว 0 ครั้ง แต่ 3 วัน (1–3 ก.พ.)
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.submit_leave('personal', '2090-02-06', '2090-02-06', false, 'ธุระ', '081', sig_t1, null);
  l_feb := (res ->> 'id')::bigint;
  res := public.get_leave_form(l_feb);
  select s into st from jsonb_array_elements(res -> 'stats') s where s ->> 'code' = 'personal';
  if (st ->> 'before_times')::int = 0 and (st ->> 'before_days')::numeric = 3
     and (st ->> 'this_times')::int = 1 and (st ->> 'this_days')::numeric = 1
     and res -> 'round' ->> 'label' = 'T2' then pass := pass + 1;
  else fail := fail + 1; failures := failures || format(E'\n- สถิติรอบ T2 ผิด: %s', st); end if;
  if res -> 'last_leave' ->> 'leave_type' = 'personal' and res -> 'last_leave' ->> 'from_date' = '2090-01-30' then pass := pass + 1;
  else fail := fail + 1; failures := failures || format(E'\n- ลาล่าสุดของใบ ก.พ. ผิด: %s', res -> 'last_leave'); end if;

  -- ใบคาบเกี่ยว (รอบ T1): ลาป่วยที่อนุมัติแล้ว 1 ครั้ง 2 วัน, ลากิจครั้งนี้นับ 2 วันในรอบ T1
  res := public.get_leave_form(l_cross);
  select s into st from jsonb_array_elements(res -> 'stats') s where s ->> 'code' = 'sick';
  if (st ->> 'before_times')::int = 1 and (st ->> 'before_days')::numeric = 2 then pass := pass + 1;
  else fail := fail + 1; failures := failures || format(E'\n- สถิติลาป่วยก่อนใบคาบเกี่ยวผิด: %s', st); end if;
  select s into st from jsonb_array_elements(res -> 'stats') s where s ->> 'code' = 'personal';
  if (st ->> 'before_times')::int = 0 and (st ->> 'this_days')::numeric = 2
     and res -> 'last_leave' ->> 'leave_type' = 'sick' and res -> 'round' ->> 'label' = 'T1' then pass := pass + 1;
  else fail := fail + 1; failures := failures || format(E'\n- สถิติลากิจของใบคาบเกี่ยวผิด: %s', st); end if;
  if jsonb_array_length(res -> 'approvals') = 3
     and (select bool_and(a ->> 'signature_path' is not null) from jsonb_array_elements(res -> 'approvals') a)
  then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- ใบที่อนุมัติครบต้องมีลายเซ็นผู้อนุมัติ 3 ขั้น'; end if;

  -- ใบที่ไม่อนุมัติไม่มีลายเซ็นผู้พิจารณา; ใบที่ยังไม่ครบมีเฉพาะขั้นที่อนุมัติแล้ว
  perform set_config('request.jwt.claims', json_build_object('sub', u_hr, 'role', 'authenticated')::text, true);
  res := public.get_leave_form(l_t2);
  if jsonb_array_length(res -> 'approvals') = 1
     and res -> 'approvals' -> 0 ->> 'signature_path' is null
     and res -> 'approvals' -> 0 ->> 'decision' = 'reject' then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- ใบที่ไม่อนุมัติต้องไม่มีลายเซ็นผู้พิจารณา'; end if;
  res := public.get_leave_form(l_hr_own);
  if jsonb_array_length(res -> 'approvals') = 1 and res -> 'approvals' -> 0 ->> 'step' = 'deputy'
     and res -> 'approvals' -> 0 ->> 'signature_path' is not null then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- ใบที่ยังไม่ครบขั้นต้องมีลายเซ็นเฉพาะขั้นที่อนุมัติแล้ว'; end if;

  -- ---------------------------------------------------------------------
  -- 8. โควตา warn / block (ลาป่วยครู 1 ในรอบ T1 ใช้แล้ว 2 วัน)
  -- ---------------------------------------------------------------------
  reset role;
  update public.leave_types set quota_days = 3, quota_mode = 'warn' where code = 'sick';
  perform set_config('request.jwt.claims', json_build_object('sub', u_t1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  res := public.preview_leave('sick', '2090-01-23', '2090-01-24', false);  -- 2 + 2 > 3
  if (res ->> 'ok')::boolean and jsonb_array_length(res -> 'warnings') = 1 then pass := pass + 1;
  else fail := fail + 1; failures := failures || format(E'\n- โควตา warn ต้องผ่านพร้อมคำเตือน: %s', res); end if;
  reset role;
  update public.leave_types set quota_mode = 'block' where code = 'sick';
  set local role authenticated;
  begin
    res := public.submit_leave('sick', '2090-01-23', '2090-01-24', false, 'ไข้', '081', sig_t1, null);
    fail := fail + 1; failures := failures || E'\n- โควตา block ต้องปฏิเสธ';
  exception when others then
    if sqlerrm like '%เกินโควตา%' then pass := pass + 1;
    else fail := fail + 1; failures := failures || E'\n- โควตา block ข้อความผิด: ' || sqlerrm; end if;
  end;
  res := public.preview_leave('sick', '2090-01-23', '2090-01-23', false);  -- 2 + 1 = 3 พอดี
  if (res ->> 'ok')::boolean and jsonb_array_length(res -> 'warnings') = 0 then pass := pass + 1;
  else fail := fail + 1; failures := failures || format(E'\n- โควตาพอดีต้องผ่าน: %s', res); end if;
  reset role;
  update public.leave_types set quota_days = null, quota_mode = 'none' where code = 'sick';

  -- ---------------------------------------------------------------------
  -- 9. ยอดลาในรอบปัจจุบัน (my_balances) — ใช้วันทำการแรกที่ว่างในรอบปัจจุบัน
  -- ---------------------------------------------------------------------
  select d::date into v_day
  from generate_series(private.today(), private.today() + 30, interval '1 day') d
  where extract(isodow from d) < 6
    and not exists (select 1 from public.holidays h where h.day = d::date)
    and exists (select 1 from public.leave_rounds r where d::date between r.start_date and r.end_date
                and private.today() between r.start_date and r.end_date)
  order by 1 limit 1;
  if v_day is null then
    failures := failures || E'\n- (ข้าม) ไม่มีรอบการลาที่ครอบคลุมวันนี้ จึงไม่ได้ทดสอบ my_balances';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', u_t2, 'role', 'authenticated')::text, true);
    set local role authenticated;
    res := public.submit_leave('personal', v_day, v_day, true, 'ธุระครึ่งวัน', '082', sig_t2, null);
    l_now := (res ->> 'id')::bigint;
    select t into st from jsonb_array_elements(public.my_balances() -> 'types') t where t ->> 'code' = 'personal';
    if (st ->> 'pending_times')::int = 1 and (st ->> 'pending_days')::numeric = 0.5
       and (st ->> 'approved_times')::int = 0 then pass := pass + 1;
    else fail := fail + 1; failures := failures || format(E'\n- my_balances ใบที่รออนุมัติผิด: %s', st); end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_hr, 'role', 'authenticated')::text, true);
    res := public.decide_leave(l_now, 'approve');
    perform set_config('request.jwt.claims', json_build_object('sub', u_deputy, 'role', 'authenticated')::text, true);
    res := public.decide_leave(l_now, 'approve');
    perform set_config('request.jwt.claims', json_build_object('sub', u_director, 'role', 'authenticated')::text, true);
    res := public.decide_leave(l_now, 'approve');
    perform set_config('request.jwt.claims', json_build_object('sub', u_t2, 'role', 'authenticated')::text, true);
    select t into st from jsonb_array_elements(public.my_balances() -> 'types') t where t ->> 'code' = 'personal';
    if (st ->> 'approved_times')::int = 1 and (st ->> 'approved_days')::numeric = 0.5
       and (st ->> 'pending_times')::int = 0 then pass := pass + 1;
    else fail := fail + 1; failures := failures || format(E'\n- my_balances ใบที่อนุมัติแล้วผิด: %s', st); end if;
    reset role;
  end if;

  -- ---------------------------------------------------------------------
  -- 10. ผู้ใช้ที่ยังไม่พร้อม / ถูกปิด / ไม่มี profile / anon
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_new, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    res := public.my_balances();
    fail := fail + 1; failures := failures || E'\n- ผู้ใช้ที่ยังไม่เปลี่ยนรหัสผ่านเรียก RPC ได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  select count(*) into n from public.profiles where id = u_new;
  if n = 1 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- ผู้ใช้ต้องอ่าน profile ตัวเองได้เสมอ'; end if;
  select count(*) into n from public.leave_types;
  if n = 0 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- ผู้ใช้ที่ยังไม่เปลี่ยนรหัสผ่านอ่าน leave_types ได้'; end if;

  -- เปลี่ยนรหัสผ่าน (Supabase Auth แก้ encrypted_password) → ปลดธงอัตโนมัติ
  reset role;
  update auth.users set encrypted_password = 'changed' where id = u_new;
  select must_change_password into ok from public.profiles where id = u_new;
  if not ok then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- เปลี่ยนรหัสผ่านแล้วธง must_change_password ไม่ถูกปลด'; end if;
  set local role authenticated;
  begin
    res := public.my_balances();
    pass := pass + 1;
  exception when others then
    fail := fail + 1; failures := failures || E'\n- หลังเปลี่ยนรหัสผ่านยังใช้ RPC ไม่ได้: ' || sqlerrm;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_off, 'role', 'authenticated')::text, true);
  begin
    res := public.my_balances();
    fail := fail + 1; failures := failures || E'\n- บัญชีที่ถูกปิดเรียก RPC ได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  select count(*) into n from public.leaves;
  if n = 0 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- ผู้ใช้ที่ไม่มี profile เห็นใบลา'; end if;
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('leave-signatures', u_stranger || '/' || gen_random_uuid() || '.png', u_stranger, u_stranger::text);
    fail := fail + 1; failures := failures || E'\n- ผู้ใช้ที่ไม่มี profile อัปโหลดไฟล์ได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform 1 from public.leaves limit 1;
    fail := fail + 1; failures := failures || E'\n- anon อ่าน leaves ได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  begin
    perform 1 from public.profiles limit 1;
    fail := fail + 1; failures := failures || E'\n- anon อ่าน profiles ได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  begin
    res := public.my_balances();
    fail := fail + 1; failures := failures || E'\n- anon เรียก RPC ได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  if public.keepalive() = 'ok' then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- keepalive ใช้ไม่ได้'; end if;

  -- ---------------------------------------------------------------------
  -- 11. แอดมิน (ครูที่เป็นแอดมิน) และสรุป
  -- ---------------------------------------------------------------------
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.leaves where user_id = u_t1;
  if n >= 3 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- แอดมินมองไม่เห็นใบลา'; end if;
  begin
    res := public.decide_leave(l_feb, 'approve');
    fail := fail + 1; failures := failures || E'\n- แอดมินที่ไม่ใช่ผู้อนุมัติอนุมัติได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  begin
    insert into public.holidays (day, name) values ('2090-01-17', 'หยุดพิเศษ');
    update public.leave_types set quota_mode = 'warn', quota_days = 10 where code = 'personal';
    insert into public.leave_rounds (label, start_date, end_date) values ('T3', '2090-03-01', '2090-03-31');
    update public.app_settings set value = to_jsonb('ทดสอบ'::text) where key = 'school_name';
    pass := pass + 1;
  exception when others then
    fail := fail + 1; failures := failures || E'\n- แอดมินแก้วันหยุด/โควตา/รอบ/ตั้งค่าไม่ได้: ' || sqlerrm;
  end;
  begin
    insert into public.leave_rounds (label, start_date, end_date) values ('T-overlap', '2090-03-15', '2090-04-15');
    fail := fail + 1; failures := failures || E'\n- รอบการลาซ้อนกันได้';
  exception when exclusion_violation then pass := pass + 1;
  end;
  res := public.admin_summary((select id from public.leave_rounds where label = 'T1'));
  if (res -> 'counts' ->> 'approved')::int = 2 and (res -> 'counts' ->> 'rejected')::int = 1
     and (res -> 'counts' ->> 'pending_director')::int = 2 and (res -> 'counts' ->> 'cancelled')::int = 1
  then pass := pass + 1;
  else fail := fail + 1; failures := failures || format(E'\n- admin_summary สถานะรอบ T1 ผิด: %s', res -> 'counts'); end if;
  select r into st from jsonb_array_elements(res -> 'rows') r where r ->> 'user_id' = u_t1::text;
  if (st -> 'by_type' -> 'sick' ->> 'times')::int = 1 and (st -> 'by_type' -> 'sick' ->> 'days')::numeric = 2
     and (st -> 'by_type' -> 'personal' ->> 'days')::numeric = 2 and (st ->> 'total_days')::numeric = 4
  then pass := pass + 1;
  else fail := fail + 1; failures := failures || format(E'\n- admin_summary รายคนผิด: %s', st); end if;
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('approver-signatures', u_hr || '/' || gen_random_uuid() || '.png', u_admin, u_admin::text);
    pass := pass + 1;
  exception when others then
    fail := fail + 1; failures := failures || E'\n- แอดมินอัปโหลดลายเซ็นผู้อนุมัติไม่ได้: ' || sqlerrm;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_t2, 'role', 'authenticated')::text, true);
  begin
    res := public.admin_summary((select id from public.leave_rounds where label = 'T1'));
    fail := fail + 1; failures := failures || E'\n- ครูดูสรุปของทุกคนได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  begin
    insert into public.holidays (day, name) values ('2090-01-18', 'x');
    fail := fail + 1; failures := failures || E'\n- ครูเพิ่มวันหยุดได้';
  exception when insufficient_privilege then pass := pass + 1;
  end;
  begin
    perform 1 from public.line_notifications limit 1;
    select count(*) into n from public.line_notifications;
    if n = 0 then pass := pass + 1;
    else fail := fail + 1; failures := failures || E'\n- ครูเห็นบันทึกแจ้งเตือน LINE'; end if;
  exception when insufficient_privilege then pass := pass + 1;
  end;

  -- ---------------------------------------------------------------------
  -- 12. แจ้งเตือน LINE เข้าคิวครบ และไม่มีเหตุผล/เบอร์โทรในเนื้อหา
  -- ---------------------------------------------------------------------
  reset role;
  select count(*) into n from public.line_notifications where leave_id = l_sick;
  if n = 4 then pass := pass + 1;
  else fail := fail + 1; failures := failures || format(E'\n- ใบลาป่วยควรมีแจ้งเตือน 4 ครั้ง (ยื่น + 3 ขั้น): %s', n); end if;
  select count(*) into n from public.line_notifications
    where leave_id = l_sick and event = 'approved' and payload ->> 'actor_step' = 'director';
  if n = 1 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- ไม่มีแจ้งเตือน ผอ. อนุมัติ'; end if;
  select count(*) into n from public.line_notifications
    where leave_id = l_t2 and event = 'rejected' and payload ->> 'actor_step' = 'hr';
  if n = 1 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- ไม่มีแจ้งเตือนไม่อนุมัติ'; end if;
  select count(*) into n from public.line_notifications
    where payload::text like '%ไข้หวัด%' or payload::text like '%เอกสารไม่ครบ%' or payload::text like '%0812345678%';
  if n = 0 then pass := pass + 1;
  else fail := fail + 1; failures := failures || E'\n- เนื้อหาแจ้งเตือนมีเหตุผลหรือเบอร์โทร'; end if;
  select count(*) into n from public.line_notifications where leave_id = l_half and event <> 'submitted';
  if n = 0 then pass := pass + 1; else fail := fail + 1; failures := failures || E'\n- ยกเลิกใบลาไม่ควรแจ้งกลุ่ม'; end if;

  raise exception 'TEST REPORT: pass=% fail=% %', pass, fail, failures;
end
$test$;
