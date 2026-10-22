// วันที่ในฐานข้อมูลเป็น ค.ศ. รูปแบบ YYYY-MM-DD เสมอ แสดงผลเป็น พ.ศ. ที่นี่ที่เดียว
export const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

export function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

// thDate('2026-10-21') → '21 ตุลาคม 2569'; { short: true } → '21 ต.ค. 2569'; { weekday: true } → 'วันพุธที่ 21 ตุลาคม 2569'
export function thDate(iso, { short = false, weekday = false } = {}) {
  const p = parseISO(iso);
  if (!p) return '';
  const month = (short ? MONTHS_SHORT : MONTHS)[p.m - 1];
  const text = `${p.d} ${month} ${p.y + 543}`;
  if (!weekday) return text;
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `วัน${WEEKDAYS[wd]}ที่ ${text}`;
}

export function thRange(from, to, opts = { short: true }) {
  if (!from) return '';
  if (!to || from === to) return thDate(from, opts);
  return `${thDate(from, opts)} – ${thDate(to, opts)}`;
}

// เวลาไทยจาก timestamptz เช่น '21 ต.ค. 2569 14:05 น.'
export function thDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${thDate(`${parts.year}-${parts.month}-${parts.day}`, { short: true })} ${parts.hour}:${parts.minute} น.`;
}

// วันนี้ตามเวลาประเทศไทย (YYYY-MM-DD)
export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}

export function addDaysISO(iso, n) {
  const p = parseISO(iso);
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return d.toISOString().slice(0, 10);
}

// แปลงข้อความวันที่ที่แอดมินวางมา: 2026-12-05, 5/12/2569, 05/12/2026
export function parseFlexibleDate(text) {
  const t = text.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  let y, mo, d;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  if (y > 2400) y -= 543;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
