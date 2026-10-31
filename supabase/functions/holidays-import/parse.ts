// อ่านวันหยุดราชการจากหน้า calendar.kapook.com/<ปี พ.ศ.>/holiday
// แต่ละแถวใน #holiday_wrap: วันที่ ชื่อวันหยุด แล้วตามด้วย <em> 2 ช่อง = วันหยุดธนาคาร, วันหยุดราชการ (&nbsp; = ไม่หยุด)
// เก็บเฉพาะแถวที่ช่องราชการเป็น "วันหยุด" (ตัดวันหยุดเฉพาะธนาคาร เช่น วันแรงงานแห่งชาติ)

export type Holiday = { date: string; name: string };

const MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseKapookHolidays(html: string, yearBE: number): Holiday[] {
  const start = html.indexOf('id="holiday_wrap"');
  if (start < 0) return [];
  const end = html.indexOf('</ul>', start);
  const section = html.slice(start, end < 0 ? undefined : end);
  const seen = new Set<string>();
  const out: Holiday[] = [];
  for (const row of section.split(/<li[\s>]/).slice(1)) {
    const dateText = /<span class="date">([^<]*)<\/span>/.exec(row);
    if (!dateText) continue; // แถวหัวตาราง
    const columns = [...row.matchAll(/<em>([\s\S]*?)<\/em>/g)].map((m) => plainText(m[1]));
    if (columns.length < 2 || !columns[1].includes('วันหยุด')) continue;
    const d = /^(\d{1,2}) (\S+) (\d{4})$/.exec(plainText(dateText[1]));
    if (!d) continue;
    const month = MONTHS.indexOf(d[2]) + 1;
    const day = Number(d[1]);
    if (month === 0 || Number(d[3]) !== yearBE) continue;
    const ce = yearBE - 543;
    const check = new Date(Date.UTC(ce, month - 1, day));
    if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) continue;
    const name = plainText(/<strong>([\s\S]*?)<\/strong>/.exec(row)?.[1] ?? '').slice(0, 120).trim();
    const date = `${ce}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!name || seen.has(date)) continue;
    seen.add(date);
    out.push({ date, name });
  }
  return out;
}
