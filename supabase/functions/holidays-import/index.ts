// ดึงวันหยุดราชการจากปฏิทินกระปุก (calendar.kapook.com/<ปี พ.ศ.>/holiday) ให้แอดมินตรวจก่อนเพิ่มในระบบ
// อ่านอย่างเดียว ไม่เขียนฐานข้อมูล: หน้าเว็บบันทึกวันที่แอดมินเลือกเองด้วยสิทธิ์แอดมินตาม RLS ของตาราง holidays
// deploy แบบ verify_jwt = false แล้วตรวจผู้เรียกเองด้านล่าง (ต้องเป็นแอดมินที่บัญชีเปิดอยู่)
// body: { years: [2569, 2570] } (ปี พ.ศ. ไม่เกิน 3 ปี)
import { cors, json, serviceClient } from '../_shared/supabase.ts';
import { type Holiday, parseKapookHolidays } from './parse.ts';

// ทดสอบในเครื่องชี้ไปไฟล์ตัวอย่างได้ด้วย HOLIDAY_SOURCE_URL ({year} = ปี พ.ศ.)
const SOURCE = Deno.env.get('HOLIDAY_SOURCE_URL') ?? 'https://calendar.kapook.com/{year}/holiday';

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function fetchYear(year: number): Promise<{ year: number; url: string; holidays: Holiday[]; error?: string }> {
  const url = SOURCE.replace('{year}', String(year));
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; leave-system holiday import)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const holidays = parseKapookHolidays(await res.text(), year);
    // หน้าปีหนึ่งมีวันหยุดราว 20 วัน ถ้าอ่านได้น้อยผิดปกติแปลว่ารูปแบบหน้าเว็บเปลี่ยน อย่าส่งข้อมูลครึ่ง ๆ กลาง ๆ
    if (holidays.length < 10) throw new Error(`parsed only ${holidays.length} rows`);
    return { year, url, holidays };
  } catch (e) {
    console.error('holiday import failed', year, e instanceof Error ? e.message : e);
    return {
      year, url, holidays: [],
      error: `ดึงวันหยุดปี ${year} ไม่สำเร็จ (เว็บต้นทางเข้าไม่ได้หรือเปลี่ยนรูปแบบ) — เพิ่มเองด้วยช่อง "เพิ่มหลายวันพร้อมกัน" ได้`,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  const admin = serviceClient();
  try {
    // ผู้เรียกต้องเป็นแอดมินที่บัญชีเปิดอยู่ (ตรวจแบบเดียวกับ admin-users)
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await admin.auth.getUser(jwt);
    if (!auth?.user) throw new HttpError(401, 'กรุณาเข้าสู่ระบบใหม่');
    const { data: caller } = await admin.from('profiles')
      .select('is_admin, active, must_change_password')
      .eq('id', auth.user.id).maybeSingle();
    if (!caller?.is_admin || !caller.active || caller.must_change_password) {
      throw new HttpError(403, 'คุณไม่มีสิทธิ์ใช้คำสั่งนี้');
    }

    let body: { years?: unknown };
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง');
    }
    const years = Array.isArray(body.years) ? [...new Set(body.years)] : [];
    if (!years.length || years.length > 3 || !years.every((y) => Number.isInteger(y) && y >= 2560 && y <= 2700)) {
      throw new HttpError(400, 'ปีไม่ถูกต้อง');
    }
    const results = await Promise.all((years as number[]).map(fetchYear));
    return json(200, { results });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error('holidays-import error', e instanceof Error ? e.message : e);
    return json(500, { error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});
