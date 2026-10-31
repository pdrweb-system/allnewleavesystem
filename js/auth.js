import { sb, setRemember } from './supabase.js';
import { LOGIN_DOMAIN } from './config.js';

export const ROLE_LABEL = {
  teacher: 'ครู',
  hr: 'หัวหน้าฝ่ายบุคลากร',
  deputy: 'รองผู้อำนวยการ',
  director: 'ผู้อำนวยการ',
};

const PROFILE_COLUMNS = 'id, user_code, full_name, position, role, is_admin, signature_path, must_change_password, active';

export const auth = { user: null, profile: null };

export const isApprover = (p) => !!p && p.role !== 'teacher';
export const canViewAll = (p) => !!p && (p.is_admin || p.role !== 'teacher');
// แอดมินไม่ใช้บัญชีแอดมินยื่นใบลา (ให้ใช้บัญชีในบทบาทครูแยกต่างหาก) ผอ. ไม่ยื่นใบลาในระบบนี้
export const canFile = (p) => !!p && p.role !== 'director' && !p.is_admin;

export async function loadSession() {
  const { data } = await sb.auth.getSession();
  auth.user = data.session?.user ?? null;
  if (!auth.user) {
    auth.profile = null;
    return null;
  }
  return refreshProfile();
}

export async function refreshProfile() {
  const { data, error } = await sb.from('profiles').select(PROFILE_COLUMNS).eq('id', auth.user.id).maybeSingle();
  if (error) throw error;
  auth.profile = data;
  return data;
}

// อีเมลของบัญชีใน Auth = แฮชของรหัสเข้าใช้ (ต้องตรงกับ loginEmail ใน supabase/functions/admin-users/index.ts)
async function loginEmail(code) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pdr-leave-v2:${code}`));
  const hex = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `k${hex.slice(0, 32)}@${LOGIN_DOMAIN}`;
}

// ล็อกอินด้วยรหัสเข้าใช้ที่แอดมินตั้งให้อย่างเดียว: ครูเป็นตัวเลข 6 หลัก ส่วนหัวหน้าฝ่าย/รองฯ/ผอ. ตั้งเองได้ทุกแบบ
export async function signIn(code, remember) {
  const password = code.trim();
  if (!password || password.length > 72) throw new Error('กรุณากรอกรหัสเข้าใช้');
  setRemember(remember);
  const { data, error } = await sb.auth.signInWithPassword({ email: await loginEmail(password), password });
  if (error) {
    if (/banned/i.test(error.message) || error.code === 'user_banned') {
      throw new Error('บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อแอดมิน');
    }
    if (/invalid login credentials/i.test(error.message) || error.status === 400) {
      throw new Error('รหัสเข้าใช้ไม่ถูกต้อง');
    }
    if (error.status === 429) throw new Error('ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
    throw error;
  }
  auth.user = data.user;
  return refreshProfile();
}

export async function signOut() {
  try {
    await sb.auth.signOut({ scope: 'local' });
  } finally {
    auth.user = null;
    auth.profile = null;
  }
}
