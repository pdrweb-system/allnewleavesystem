// แอดมินจัดการบัญชีผู้ใช้: สร้างบัญชี / รีเซ็ตรหัสผ่าน / แก้ข้อมูล บทบาท สิทธิ์แอดมิน เปิด-ปิดบัญชี ลายเซ็นผู้อนุมัติ
// deploy แบบ verify_jwt = false แล้วตรวจผู้เรียกเองด้านล่าง (ต้องเป็นแอดมินที่เปลี่ยนรหัสผ่านชั่วคราวแล้ว)
// body: { action: 'create' | 'reset_password' | 'update', ... }
import { cors, json, serviceClient } from '../_shared/supabase.ts';

// ต้องตรงกับ LOGIN_DOMAIN ใน js/config.js
const LOGIN_DOMAIN = 'leave.pdr.invalid';
const ROLES = ['teacher', 'hr', 'deputy', 'director'] as const;
type Role = (typeof ROLES)[number];
const ROLE_LABEL: Record<Role, string> = {
  teacher: 'ครู',
  hr: 'หัวหน้าฝ่ายบุคลากร',
  deputy: 'รองผู้อำนวยการ',
  director: 'ผู้อำนวยการ',
};
const USER_CODE_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// รหัสผ่านชั่วคราว 10 ตัว (ตัดตัวที่สับสนง่าย 0/o 1/l/i) เช่น k7m3p-x9q2r
function tempPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const out: string[] = [];
  const buf = new Uint8Array(1);
  while (out.length < 10) {
    crypto.getRandomValues(buf);
    if (buf[0] < 248) out.push(alphabet[buf[0] % alphabet.length]); // 248 = 8 × 31 ไม่เอนเอียง
  }
  return out.slice(0, 5).join('') + '-' + out.slice(5).join('');
}

function text(value: unknown, field: string, max = 120): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `กรุณากรอก${field}`);
  const v = value.trim().replace(/\s+/g, ' ');
  if (v.length > max) throw new HttpError(400, `${field}ยาวเกิน ${max} ตัวอักษร`);
  return v;
}

function role(value: unknown): Role {
  if (typeof value !== 'string' || !(ROLES as readonly string[]).includes(value)) {
    throw new HttpError(400, 'บทบาทไม่ถูกต้อง');
  }
  return value as Role;
}

function userId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new HttpError(400, 'ไม่พบผู้ใช้');
  return value;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  const admin = serviceClient();
  try {
    // ผู้เรียกต้องเป็นแอดมินที่บัญชีเปิดอยู่และเปลี่ยนรหัสผ่านชั่วคราวแล้ว
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await admin.auth.getUser(jwt);
    if (!auth?.user) throw new HttpError(401, 'กรุณาเข้าสู่ระบบใหม่');
    const { data: caller } = await admin.from('profiles')
      .select('id, is_admin, active, must_change_password')
      .eq('id', auth.user.id).maybeSingle();
    if (!caller?.is_admin || !caller.active || caller.must_change_password) {
      throw new HttpError(403, 'คุณไม่มีสิทธิ์จัดการผู้ใช้');
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง');
    }

    const audit = (action: string, target: string, detail: Record<string, unknown> = {}) =>
      admin.from('admin_audit').insert({ actor: caller.id, action, target, detail });

    // ตำแหน่งผู้อนุมัติมีได้ตำแหน่งละ 1 คนที่ยังใช้งานอยู่
    const assertRoleFree = async (r: Role, exceptId: string | null) => {
      if (r === 'teacher') return;
      let q = admin.from('profiles').select('id, full_name').eq('role', r).eq('active', true);
      if (exceptId) q = q.neq('id', exceptId);
      const { data } = await q.limit(1);
      if (data?.length) {
        throw new HttpError(409, `ตำแหน่ง${ROLE_LABEL[r]}มีผู้ใช้อยู่แล้ว (${data[0].full_name}) ` +
          'กรุณาเปลี่ยนบทบาทหรือปิดบัญชีคนเดิมก่อน');
      }
    };

    switch (body.action) {
      case 'create': {
        const userCode = typeof body.user_code === 'string' ? body.user_code.trim().toLowerCase() : '';
        if (!USER_CODE_RE.test(userCode)) {
          throw new HttpError(400, 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - (ไม่เกิน 32 ตัว ขึ้นต้นด้วยตัวอักษรหรือตัวเลข)');
        }
        const fullName = text(body.full_name, 'ชื่อ-สกุล');
        const position = text(body.position, 'ตำแหน่ง');
        const r = role(body.role ?? 'teacher');
        const isAdmin = body.is_admin === true;

        const { data: dup } = await admin.from('profiles').select('id').eq('user_code', userCode).maybeSingle();
        if (dup) throw new HttpError(409, 'ชื่อผู้ใช้นี้มีอยู่แล้ว');
        await assertRoleFree(r, null);

        const password = tempPassword();
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: `${userCode}@${LOGIN_DOMAIN}`,
          password,
          email_confirm: true,
        });
        if (createErr || !created?.user) {
          console.error('createUser failed', createErr?.code, createErr?.message);
          throw new HttpError(400, 'สร้างบัญชีไม่สำเร็จ (ชื่อผู้ใช้นี้อาจมีบัญชีอยู่แล้ว)');
        }
        const { error: profileErr } = await admin.from('profiles').insert({
          id: created.user.id, user_code: userCode, full_name: fullName, position,
          role: r, is_admin: isAdmin, must_change_password: true, active: true,
        });
        if (profileErr) {
          console.error('profile insert failed', profileErr.code, profileErr.message);
          await admin.auth.admin.deleteUser(created.user.id);
          throw new HttpError(profileErr.code === '23505' ? 409 : 500, 'สร้างบัญชีไม่สำเร็จ');
        }
        await audit('create', created.user.id, { user_code: userCode, role: r, is_admin: isAdmin });
        return json(200, { user_id: created.user.id, user_code: userCode, temp_password: password });
      }

      case 'reset_password': {
        const id = userId(body.user_id);
        const { data: target } = await admin.from('profiles').select('id, active').eq('id', id).maybeSingle();
        if (!target) throw new HttpError(404, 'ไม่พบผู้ใช้');
        if (!target.active) throw new HttpError(400, 'บัญชีนี้ถูกปิดอยู่ กรุณาเปิดบัญชีก่อน');
        const password = tempPassword();
        const { error } = await admin.auth.admin.updateUserById(id, { password });
        if (error) {
          console.error('updateUserById failed', error.code, error.message);
          throw new HttpError(400, 'รีเซ็ตรหัสผ่านไม่สำเร็จ');
        }
        // trigger ใน DB ปลดธงเมื่อรหัสผ่านเปลี่ยน จึงต้องตั้งธงกลับหลังรีเซ็ต
        await admin.from('profiles').update({ must_change_password: true }).eq('id', id);
        await audit('reset_password', id);
        return json(200, { user_id: id, temp_password: password });
      }

      case 'update': {
        const id = userId(body.user_id);
        const { data: target } = await admin.from('profiles')
          .select('id, role, is_admin, active').eq('id', id).maybeSingle();
        if (!target) throw new HttpError(404, 'ไม่พบผู้ใช้');

        const patch: Record<string, unknown> = {};
        if ('full_name' in body) patch.full_name = text(body.full_name, 'ชื่อ-สกุล');
        if ('position' in body) patch.position = text(body.position, 'ตำแหน่ง');
        if ('role' in body) patch.role = role(body.role);
        if ('is_admin' in body) patch.is_admin = body.is_admin === true;
        if ('active' in body) patch.active = body.active === true;
        if ('signature_path' in body) {
          const p = body.signature_path;
          if (p === null) {
            patch.signature_path = null;
          } else {
            if (typeof p !== 'string' || !new RegExp(`^${id}/[0-9a-f-]{36}\\.(png|jpg|webp)$`).test(p)) {
              throw new HttpError(400, 'ไฟล์ลายเซ็นไม่ถูกต้อง');
            }
            const name = p.slice(id.length + 1);
            const { data: files } = await admin.storage.from('approver-signatures').list(id, { search: name, limit: 5 });
            if (!files?.some((f) => f.name === name)) throw new HttpError(400, 'ไม่พบไฟล์ลายเซ็นที่อัปโหลด');
            patch.signature_path = p;
          }
        }
        if (!Object.keys(patch).length) throw new HttpError(400, 'ไม่มีข้อมูลที่ต้องแก้ไข');

        // กันแอดมินล็อกตัวเองออกจากระบบ
        if (id === caller.id && (patch.is_admin === false || patch.active === false)) {
          throw new HttpError(400, 'ปิดสิทธิ์แอดมินหรือปิดบัญชีของตัวเองไม่ได้');
        }
        const nextRole = (patch.role ?? target.role) as Role;
        const nextActive = (patch.active ?? target.active) as boolean;
        if (nextActive && (nextRole !== target.role || !target.active)) await assertRoleFree(nextRole, id);

        const { error } = await admin.from('profiles').update(patch).eq('id', id);
        if (error) {
          console.error('profile update failed', error.code, error.message);
          throw new HttpError(error.code === '23505' ? 409 : 400, 'บันทึกไม่สำเร็จ');
        }
        // ปิดบัญชี = ห้ามล็อกอิน/ต่ออายุ session ทันที (ข้อมูลเดิมยังอยู่ครบ)
        if ('active' in patch && patch.active !== target.active) {
          const { error: banErr } = await admin.auth.admin.updateUserById(id, {
            ban_duration: patch.active ? 'none' : '876000h',
          });
          if (banErr) console.error('ban update failed', banErr.code, banErr.message);
        }
        await audit('update', id, patch);
        return json(200, { user_id: id });
      }

      default:
        throw new HttpError(400, 'คำสั่งไม่ถูกต้อง');
    }
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error('admin-users error', e instanceof Error ? e.message : e);
    return json(500, { error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});
