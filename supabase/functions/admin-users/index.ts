// แอดมินจัดการบัญชีผู้ใช้: สร้างบัญชี / ตั้งรหัสเข้าใช้ใหม่ / แก้ข้อมูล บทบาท สิทธิ์แอดมิน เปิด-ปิดบัญชี ลายเซ็นผู้อนุมัติ
// deploy แบบ verify_jwt = false แล้วตรวจผู้เรียกเองด้านล่าง (ต้องเป็นแอดมินที่บัญชีเปิดอยู่)
// body: { action: 'create' | 'reset_password' | 'update', ... }
// ล็อกอินด้วยรหัสเข้าใช้ตัวเลข 6 หลักอย่างเดียว ที่แอดมินตั้งให้ (ผู้ใช้เปลี่ยนเองไม่ได้)
// รหัส 8 หลักที่ตั้งไว้ก่อนหน้านี้ยังล็อกอินได้ แต่รหัสที่ตั้งใหม่ต้องเป็น 6 หลัก
// อีเมลของบัญชีใน Auth = แฮชของรหัส จึงหาบัญชีได้จากรหัสโดยไม่ต้องมีชื่อผู้ใช้ และรหัสซ้ำกันไม่ได้
import { cors, json, serviceClient } from '../_shared/supabase.ts';

// ต้องตรงกับ LOGIN_DOMAIN / loginEmail ใน js/config.js, js/auth.js และ supabase/seed/set_login_code.sql
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

async function loginEmail(code: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pdr-leave-v2:${code}`));
  const hex = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `k${hex.slice(0, 32)}@${LOGIN_DOMAIN}`;
}

function randomChars(alphabet: string, length: number): string {
  const limit = 256 - (256 % alphabet.length); // ตัดส่วนเกินทิ้ง ไม่ให้บางตัวออกบ่อยกว่า
  const buf = new Uint8Array(1);
  let out = '';
  while (out.length < length) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) out += alphabet[buf[0] % alphabet.length];
  }
  return out;
}

// ครู: ตัวเลข 6 หลัก ห้ามเลขซ้ำ/เลขเรียง · หัวหน้าฝ่าย/รองฯ/ผอ.: แอดมินตั้งเองได้ทุกแบบ (ไม่จำกัดความยาว/ตัวอักษร ยกเว้นเกิน 72 ตัวที่ Supabase รับไม่ได้)
function codeProblem(code: string, role: Role): string | null {
  if (role !== 'teacher') {
    return code.length >= 1 && code.length <= 72 ? null : 'กรุณาใส่รหัสเข้าใช้ (ไม่เกิน 72 ตัว)';
  }
  if (!/^[0-9]{6}$/.test(code)) return 'รหัสเข้าใช้ต้องเป็นตัวเลข 6 หลัก';
  if (/^([0-9])\1{5}$/.test(code) || '01234567890123456789'.includes(code) || '98765432109876543210'.includes(code)) {
    return 'รหัสนี้เดาง่ายเกินไป กรุณาใช้รหัสอื่น';
  }
  return null;
}

function randomCode(): string {
  for (;;) {
    const code = randomChars('0123456789', 6);
    if (!codeProblem(code, 'teacher')) return code;
  }
}

function requestedCode(value: unknown, role: Role): string | null {
  if (value === undefined || value === null || value === '') return null;
  const code = typeof value === 'string' ? value.trim() : '';
  const problem = codeProblem(code, role);
  if (problem) throw new HttpError(400, problem);
  return code;
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
    // ผู้เรียกต้องเป็นแอดมินที่บัญชีเปิดอยู่
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

    // สร้างหรือเปลี่ยนรหัสเข้าใช้: รหัสที่แอดมินระบุใช้ได้ครั้งเดียว รหัสสุ่มลองใหม่ได้ถ้าบังเอิญซ้ำ
    const withLoginCode = async (
      requested: string | null,
      apply: (email: string, code: string) => Promise<{ code?: string } | null>,
    ) => {
      for (let attempt = 0; attempt < (requested ? 1 : 5); attempt++) {
        const code = requested ?? randomCode();
        const err = await apply(await loginEmail(code), code);
        if (!err) return code;
        if (err.code === 'email_exists') {
          if (requested) throw new HttpError(409, 'รหัสนี้ใช้ไม่ได้ กรุณาใช้รหัสอื่น');
          continue;
        }
        if (err.code === 'weak_password') {
          throw new HttpError(400, 'Supabase ไม่รับรหัสนี้ (สั้นกว่าที่ตั้งไว้): ใน Auth settings ลด Minimum password length ให้ไม่เกินความยาวของรหัส และตั้ง Password Requirements = "No required characters"');
        }
        throw new HttpError(400, 'บันทึกรหัสเข้าใช้ไม่สำเร็จ');
      }
      throw new HttpError(409, 'สุ่มรหัสไม่สำเร็จ กรุณาลองใหม่');
    };

    switch (body.action) {
      case 'create': {
        // user_code เป็นรหัสอ้างอิงภายใน (ไม่ใช้ล็อกอิน) ส่งมาได้ตอนนำเข้าจากระบบเดิม ไม่ส่งระบบตั้งให้
        let userCode = typeof body.user_code === 'string' ? body.user_code.trim().toLowerCase() : '';
        if (userCode && !USER_CODE_RE.test(userCode)) {
          throw new HttpError(400, 'รหัสอ้างอิงใช้ได้เฉพาะ a-z 0-9 . _ - (ไม่เกิน 32 ตัว ขึ้นต้นด้วยตัวอักษรหรือตัวเลข)');
        }
        const fullName = text(body.full_name, 'ชื่อ-สกุล');
        const position = text(body.position, 'ตำแหน่ง');
        const r = role(body.role ?? 'teacher');
        const isAdmin = body.is_admin === true;
        const requested = requestedCode(body.login_code, r);

        if (userCode) {
          const { data: dup } = await admin.from('profiles').select('id').eq('user_code', userCode).maybeSingle();
          if (dup) throw new HttpError(409, `รหัสอ้างอิง ${userCode} มีอยู่แล้ว`);
        } else {
          for (;;) {
            userCode = `u${randomChars('abcdefghjkmnpqrstuvwxyz23456789', 7)}`;
            const { data: dup } = await admin.from('profiles').select('id').eq('user_code', userCode).maybeSingle();
            if (!dup) break;
          }
        }
        await assertRoleFree(r, null);

        let userIdNew = '';
        const loginCode = await withLoginCode(requested, async (email, password) => {
          const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
          if (error || !created?.user) {
            console.error('createUser failed', error?.code, error?.message);
            return { code: error?.code ?? 'unknown' };
          }
          userIdNew = created.user.id;
          return null;
        });
        const { error: profileErr } = await admin.from('profiles').insert({
          id: userIdNew, user_code: userCode, full_name: fullName, position,
          role: r, is_admin: isAdmin, must_change_password: false, active: true,
        });
        if (profileErr) {
          console.error('profile insert failed', profileErr.code, profileErr.message);
          await admin.auth.admin.deleteUser(userIdNew);
          throw new HttpError(profileErr.code === '23505' ? 409 : 500, 'สร้างบัญชีไม่สำเร็จ');
        }
        await audit('create', userIdNew, { user_code: userCode, role: r, is_admin: isAdmin });
        return json(200, { user_id: userIdNew, user_code: userCode, login_code: loginCode });
      }

      case 'reset_password': {
        const id = userId(body.user_id);
        const { data: target } = await admin.from('profiles').select('id, active, role').eq('id', id).maybeSingle();
        if (!target) throw new HttpError(404, 'ไม่พบผู้ใช้');
        if (!target.active) throw new HttpError(400, 'บัญชีนี้ถูกปิดอยู่ กรุณาเปิดบัญชีก่อน');
        const loginCode = await withLoginCode(requestedCode(body.login_code, target.role as Role), async (email, password) => {
          const { error } = await admin.auth.admin.updateUserById(id, { email, password, email_confirm: true });
          if (error) console.error('updateUserById failed', error.code, error.message);
          return error ? { code: error.code ?? 'unknown' } : null;
        });
        // บัญชีเก่าที่ยังติดธงบังคับเปลี่ยนรหัส ใช้งานได้ทันทีหลังได้รหัสใหม่
        await admin.from('profiles').update({ must_change_password: false }).eq('id', id);
        await audit('reset_password', id);
        return json(200, { user_id: id, login_code: loginCode });
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
