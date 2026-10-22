import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// "จดจำฉันไว้" = เก็บ session ใน localStorage (มือถือส่วนตัว)
// ไม่ติ๊ก = sessionStorage ปิดแท็บแล้วต้องล็อกอินใหม่ (เครื่องใช้ร่วมกัน)
const REMEMBER_KEY = 'leave.remember';

function target() {
  try {
    return localStorage.getItem(REMEMBER_KEY) === '0' ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

const authStorage = {
  getItem(key) {
    try {
      return target()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      target()?.setItem(key, value);
    } catch {
      // เบราว์เซอร์ปิด storage: session อยู่ได้จนรีเฟรชหน้า
    }
  },
  removeItem(key) {
    for (const s of [globalThis.localStorage, globalThis.sessionStorage]) {
      try {
        s?.removeItem(key);
      } catch {
        // ignore
      }
    }
  },
};

export function setRemember(on) {
  try {
    localStorage.setItem(REMEMBER_KEY, on ? '1' : '0');
  } catch {
    // ignore
  }
}

export function getRemember() {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== '0';
  } catch {
    return false;
  }
}

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
