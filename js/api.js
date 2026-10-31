import { sb } from './supabase.js';

export async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}

export async function query(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

let typesCache;
export async function leaveTypes() {
  typesCache ??= query(sb.from('leave_types')
    .select('code, label, form_label, sort, quota_days, quota_mode, requires_cert, count_calendar_days')
    .order('sort'));
  try {
    return await typesCache;
  } catch (e) {
    typesCache = undefined;
    throw e;
  }
}

export function clearCaches() {
  typesCache = undefined;
  for (const url of blobUrls.values()) Promise.resolve(url).then((u) => u && URL.revokeObjectURL(u));
  blobUrls.clear();
}

export async function typeLabels() {
  return Object.fromEntries((await leaveTypes()).map((t) => [t.code, t.label]));
}

// อัปโหลดไฟล์ลง bucket ส่วนตัว ชื่อไฟล์สุ่มใหม่เสมอ (ไม่มีการเขียนทับ)
export async function upload(bucket, folder, blob, ext) {
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from(bucket).upload(path, blob, {
    contentType: blob.type, upsert: false, cacheControl: '3600',
  });
  if (error) {
    if (/exceeded|too large|maximum/i.test(error.message)) throw new Error('ไฟล์มีขนาดใหญ่เกินกำหนด');
    if (/mime|type/i.test(error.message)) throw new Error('ชนิดไฟล์ไม่รองรับ');
    throw error;
  }
  return path;
}

// โหลดไฟล์ส่วนตัวด้วยสิทธิ์ของผู้ล็อกอิน (RLS ของ storage ตรวจ) แล้วแสดงเป็น blob: URL
// ไม่มี URL สาธารณะของไฟล์เกิดขึ้นเลย
const blobUrls = new Map();
export function fileUrl(bucket, path) {
  if (!path) return Promise.resolve(null);
  const key = `${bucket}/${path}`;
  if (!blobUrls.has(key)) {
    blobUrls.set(key, sb.storage.from(bucket).download(path).then(({ data, error }) => {
      if (error || !data) {
        blobUrls.delete(key);
        return null;
      }
      return URL.createObjectURL(data);
    }));
  }
  return blobUrls.get(key);
}

// เรียก Edge Function แล้วแปลง error เป็นข้อความไทยจากฟังก์ชัน
export async function callFunction(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    try {
      const j = await error.context?.json?.();
      if (j?.error) message = j.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return data;
}

export const adminUsers = (body) => callFunction('admin-users', body);
