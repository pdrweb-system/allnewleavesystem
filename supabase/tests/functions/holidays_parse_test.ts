// ทดสอบตัวอ่านวันหยุดจากหน้า calendar.kapook.com กับไฟล์ตัวอย่างที่โครงเดียวกับหน้าจริง
// รัน: deno test --allow-read supabase/tests/functions/
import { parseKapookHolidays } from '../../functions/holidays-import/parse.ts';

function check(ok: boolean, message: string) {
  if (!ok) throw new Error(message);
}
const fixture = (year: number) =>
  Deno.readTextFileSync(new URL(`../fixtures/kapook-${year}.html`, import.meta.url));

Deno.test('2569: เฉพาะวันหยุดราชการ 22 วัน แปลง พ.ศ. เป็น ค.ศ.', () => {
  const list = parseKapookHolidays(fixture(2569), 2569);
  check(list.length === 22, `ได้ ${list.length} วัน`);
  check(list[0].date === '2026-01-01' && list[0].name === 'วันขึ้นปีใหม่', JSON.stringify(list[0]));
  check(list.at(-1)?.date === '2026-12-31', JSON.stringify(list.at(-1)));
  const dates = new Set(list.map((h) => h.date));
  check(!dates.has('2026-05-01'), 'วันแรงงาน (หยุดเฉพาะธนาคาร) ต้องไม่อยู่ในรายการ');
  check(!dates.has('2026-10-16'), 'วันหยุดพิเศษธนาคารต้องไม่อยู่ในรายการ');
  check(dates.has('2026-05-13') && dates.has('2026-07-30'), 'วันพืชมงคล/เข้าพรรษา (หยุดเฉพาะราชการ) ต้องอยู่ในรายการ');
  check(list.find((h) => h.date === '2026-12-07')?.name === 'วันหยุดชดเชย วันพ่อแห่งชาติ', 'ชื่อวันหยุดชดเชย');
  check(list.every((h) => h.name.length <= 120 && !/[<>]|&nbsp;/.test(h.name)), 'ชื่อต้องเป็นข้อความล้วน');
});

Deno.test('2570: ตัดวันหยุดชดเชยวันแรงงาน (ธนาคาร) และไม่อ่านรายการนอกตารางวันหยุด', () => {
  const list = parseKapookHolidays(fixture(2570), 2570);
  check(list.length === 22, `ได้ ${list.length} วัน`);
  const dates = list.map((h) => h.date);
  check(!dates.includes('2027-05-03'), 'วันหยุดชดเชยวันแรงงานต้องไม่อยู่ในรายการ');
  check(dates.includes('2027-10-15') && dates.includes('2027-10-25'), 'วันออกพรรษา/ชดเชยวันปิยมหาราช');
  check(new Set(dates).size === dates.length, 'วันที่ต้องไม่ซ้ำ');
});

Deno.test('ปีไม่ตรงหรือหน้าเว็บผิดรูปแบบ ได้รายการว่าง', () => {
  check(parseKapookHolidays(fixture(2569), 2570).length === 0, 'ปีไม่ตรงต้องไม่ได้ข้อมูล');
  check(parseKapookHolidays('<html><body>ไม่มีตาราง</body></html>', 2569).length === 0, 'ไม่มี #holiday_wrap');
});
