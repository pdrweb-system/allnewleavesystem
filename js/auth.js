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
export const canFile = (p) => !!p && p.role !== 'director';

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

export async function signIn(userCode, password, remember) {
  setRemember(remember);
  const email = `${userCode.trim().toLowerCase()}@${LOGIN_DOMAIN}`;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if (/banned/i.test(error.message) || error.code === 'user_banned') {
      throw new Error('บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อแอดมิน');
    }
    if (/invalid login credentials/i.test(error.message) || error.status === 400) {
      throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    if (error.status === 429) throw new Error('ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
    throw error;
  }
  auth.user = data.user;
  return refreshProfile();
}

export async function changePassword(newPassword) {
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) {
    if (/different from the old password/i.test(error.message)) {
      throw new Error('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
    }
    if (/weak|at least/i.test(error.message)) throw new Error('รหัสผ่านสั้นหรือคาดเดาง่ายเกินไป');
    if (/reauthentication|recent/i.test(error.message)) {
      throw new Error('กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่ก่อนเปลี่ยนรหัสผ่าน');
    }
    throw error;
  }
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
