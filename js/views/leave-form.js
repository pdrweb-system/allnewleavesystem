// ใบลา A4 สำหรับพิมพ์/บันทึก PDF จากเบราว์เซอร์ — สร้างสดจากข้อมูลทุกครั้ง (ไม่เก็บ PDF บนเซิร์ฟเวอร์)
// ลายเซ็นผู้อนุมัติแสดงเฉพาะขั้นที่ผู้นั้นกดอนุมัติแล้ว
import { h, mount, loading, fmtDays } from '../ui.js';
import { rpc, fileUrl } from '../api.js';
import { thDate, parseISO, MONTHS } from '../lib/thai-date.js';

const BOX = { true: '☑', false: '☐' };
const FORM_ORDER = ['sick', 'personal', 'maternity', 'wife_childbirth'];

function dots(text, cls = '') {
  return h('span', { class: `fill ${cls}` }, text ?? '');
}

function longDate(iso) {
  const p = parseISO(iso);
  if (!p) return { d: '', m: '', y: '' };
  return { d: String(p.d), m: MONTHS[p.m - 1], y: String(p.y + 543) };
}

function statCell(times, days) {
  if (!times && !Number(days)) return '-';
  return `${times} / ${fmtDays(days)}`;
}

async function sigImg(bucket, path, alt) {
  const url = await fileUrl(bucket, path);
  if (!url) return h('span', { class: 'sig-missing' }, '(ไม่พบภาพลายเซ็น)');
  return h('img', { class: 'sig', src: await cropToInk(url) ?? url, alt });
}

// ตัดขอบว่าง (โปร่งใสหรือขาว) รอบลายเซ็นออก เพื่อให้จัดกลางช่องและวางบนเส้นจุดได้พอดีไม่ว่าไฟล์จะเว้นขอบเท่าไร
async function cropToInk(url) {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const { naturalWidth: w, naturalHeight: ht } = img;
    if (!w || !ht || w * ht > 12e6) return null;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = ht;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, w, ht);
    let x0 = w, y0 = ht, x1 = -1, y1 = -1;
    for (let y = 0; y < ht; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const ink = data[i + 3] > 24 && (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235);
        if (ink) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null; // ภาพว่าง ใช้ภาพเดิม
    const pad = 2;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(ht - 1, y1 + pad);
    if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === ht - 1) return null;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    const blob = await new Promise((res) => out.toBlob(res, 'image/png'));
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    return null; // ตัดขอบไม่ได้ก็แสดงภาพเดิม
  }
}

// ลายเซ็น 1 ชุด: (ลงชื่อ) / (ชื่อ) แล้วผู้อนุมัติมีบรรทัด ตำแหน่ง ... และ วันที่ ... / ... / ... เพิ่ม
function signBlock({ img, name, title, date, label = '(ลงชื่อ)' }) {
  return h('div', { class: 'sign' },
    h('div', { class: 'sign-line' }, h('span', {}, label), h('span', { class: 'sign-slot' }, img ?? '')),
    h('div', { class: 'sign-name' }, `(${name ? ` ${name} ` : ' '.repeat(40)})`),
    title !== undefined ? h('div', { class: 'sign-row' }, 'ตำแหน่ง', dots(title, 'w-title')) : null,
    date !== undefined
      ? h('div', { class: 'sign-row' }, 'วันที่', dots(date.d, 'w-d'), '/', dots(date.m, 'w-m'), '/', dots(date.y, 'w-y'))
      : null);
}

export default async function leaveForm(el, { id }) {
  mount(el, loading('กำลังสร้างใบลา…'));
  const data = await rpc('get_leave_form', { p_leave_id: Number(id) });
  const { leave, stats, last_leave: last, approvals, settings: s, round } = data;
  const byStep = Object.fromEntries(approvals.map((a) => [a.step, a]));
  const steps = leave.steps ?? [];

  const filed = longDate(leave.filed_date);
  const from = longDate(leave.from_date);
  const to = longDate(leave.to_date);
  const days = leave.half_day ? '0.5 (ครึ่งวัน)' : fmtDays(leave.total_days);
  const statByCode = Object.fromEntries((stats ?? []).map((x) => [x.code, x]));
  const typeLabel = statByCode[leave.leave_type]?.label ?? leave.type_label;

  const teacherSig = leave.signature_path
    ? await sigImg('leave-signatures', leave.signature_path, 'ลายเซ็นผู้ลา')
    : null;
  const stepSig = (step) => {
    const a = byStep[step];
    return a?.decision === 'approve' && a.signature_path
      ? sigImg('approver-signatures', a.signature_path, `ลายเซ็น${s[`${step}_title`] ?? ''}`)
      : null;
  };
  const [hrSig, deputySig, directorSig] = await Promise.all(['hr', 'deputy', 'director'].map(stepSig));

  const decidedOn = (a) => (a ? longDate(a.approve_date ?? a.decided_at?.slice(0, 10)) : { d: '', m: '', y: '' });
  const skipped = (step) => !steps.includes(step);

  // ---------- ส่วนบน: คำขอลา ----------
  const header = h('div', { class: 'f-head' },
    h('h1', { class: 'f-title' }, s.form_title ?? 'แบบใบลาป่วย ลากิจส่วนตัว ลาคลอด'),
    h('div', { class: 'f-right' }, 'เขียนที่ ', dots(s.school_name, 'w-school')),
    h('div', { class: 'f-right' }, 'วันที่ ', dots(filed.d, 'w-d'), ' เดือน ', dots(filed.m, 'w-m'), ' พ.ศ. ', dots(filed.y, 'w-y')));

  const lines = h('div', { class: 'f-body' },
    h('p', {}, h('b', {}, 'เรื่อง'), ' ', dots(`ขอ${typeLabel ?? ''}`, 'w-subject')),
    h('p', {}, h('b', {}, 'เรียน'), ' ', dots(s.addressee, 'w-subject')),
    h('p', { class: 'indent' }, 'ข้าพเจ้า ', dots(leave.snap_name, 'w-name'), ' ตำแหน่ง ', dots(leave.snap_position, 'w-pos')),
    h('p', {}, 'ขอลา ', FORM_ORDER.map((code) => h('span', { class: 'tick' },
      `${BOX[leave.leave_type === code]} ${statByCode[code]?.form_label ?? code}`))),
    h('p', {}, 'เนื่องจาก ', dots(leave.reason, 'w-reason')),
    h('p', {}, 'ตั้งแต่วันที่ ', dots(`${from.d} ${from.m} ${from.y}`, 'w-date'),
      ' ถึงวันที่ ', dots(`${to.d} ${to.m} ${to.y}`, 'w-date'),
      ' มีกำหนด ', dots(days, 'w-num'), ' วัน'),
    h('p', {},
      h('span', { class: 'nowrap' }, 'ข้าพเจ้าได้ลา ', dots(last?.label ?? '-', 'w-type')),
      ' ', h('span', { class: 'nowrap' }, 'ครั้งสุดท้ายตั้งแต่วันที่ ', dots(last ? thDate(last.from_date) : '-', 'w-date')),
      ' ', h('span', { class: 'nowrap' }, 'ถึงวันที่ ', dots(last ? thDate(last.to_date) : '-', 'w-date')),
      ' ', h('span', { class: 'nowrap' }, 'มีกำหนด ',
        dots(last ? (last.half_day ? '0.5' : fmtDays(last.total_days)) : '-', 'w-num'), ' วัน')),
    h('p', {}, 'ในระหว่างลาจะติดต่อข้าพเจ้าได้ที่ ', dots(leave.contact_phone, 'w-contact')));

  const applicant = h('div', { class: 'f-applicant' },
    h('div', { class: 'f-regards' }, 'ขอแสดงความนับถือ'),
    signBlock({ img: teacherSig, name: leave.name ?? leave.snap_name }));

  // ---------- ส่วนล่าง: สถิติ + ผู้ตรวจสอบ (ซ้าย), ความเห็นรองฯ + คำสั่ง ผอ. (ขวา) ----------
  const statTable = h('table', { class: 'f-stats' },
    h('colgroup', {}, h('col', { class: 'c-type' }), h('col'), h('col'), h('col')),
    h('thead', {}, h('tr', {},
      h('th', {}, 'ประเภทการลา'), h('th', {}, 'ลามาแล้ว'), h('th', {}, 'ลาครั้งนี้'), h('th', {}, 'รวมเป็น'))),
    h('tbody', {}, FORM_ORDER.map((code) => {
      const x = statByCode[code] ?? { before_times: 0, before_days: 0, this_times: 0, this_days: 0 };
      return h('tr', {},
        h('td', {}, x.form_label ?? code),
        h('td', {}, statCell(x.before_times, x.before_days)),
        h('td', {}, statCell(x.this_times, x.this_days)),
        h('td', {}, statCell(x.before_times + x.this_times, Number(x.before_days) + Number(x.this_days))));
    })),
    h('caption', {}, 'หน่วย: ครั้ง / วัน'));

  const hr = byStep.hr;
  const checker = h('section', { class: 'f-sec' },
    h('h2', { class: 'f-sec-title' }, 'ผู้ตรวจสอบ'),
    skipped('hr')
      ? h('p', { class: 'f-note' }, 'ผู้ลาเป็นหัวหน้าฝ่ายบริหารงานบุคคล (ไม่ต้องผ่านขั้นตรวจสอบ)')
      : [
        hr?.decision === 'reject' ? h('p', { class: 'f-reject' }, `ไม่ผ่านการตรวจสอบ: ${hr.reason}`) : null,
        signBlock({ img: hrSig, name: hr?.name, title: s.hr_title ?? 'หัวหน้าฝ่ายบริหารงานบุคคล', date: decidedOn(hr) }),
      ]);

  const statBlock = h('div', {},
    h('h2', {}, 'สถิติการลาในปีงบประมาณนี้', round ? h('small', {}, ` (รอบ ${round.label})`) : null),
    statTable);

  // ความเห็นผู้บังคับบัญชา: ความเห็นรองฯ แล้วตามด้วยคำสั่ง ผอ. ในส่วนเดียวกัน (ไม่มีกรอบ ตามแบบฟอร์มราชการ)
  const dep = byStep.deputy;
  const dir = byStep.director;
  const supervisor = h('section', { class: 'f-sec' },
    h('h2', { class: 'f-sec-title' }, 'ความเห็นผู้บังคับบัญชา'),
    skipped('deputy')
      ? h('p', { class: 'f-note' }, 'ผู้ลาเป็นรองผู้อำนวยการ (ไม่ต้องผ่านขั้นนี้)')
      : [
        h('p', { class: 'f-opinion' }, dots(dep
          ? (dep.decision === 'approve' ? s.deputy_approve_text : `${s.deputy_reject_text} ${dep.reason ? `(${dep.reason})` : ''}`)
          : '', 'w-full')),
        signBlock({ img: deputySig, name: dep?.name, title: s.deputy_title, date: decidedOn(dep) }),
      ],
    h('p', { class: 'f-order' }, 'คำสั่ง',
      h('span', { class: 'tick' }, `${BOX[dir?.decision === 'approve']} อนุญาต`),
      h('span', { class: 'tick' }, `${BOX[dir?.decision === 'reject']} ไม่อนุญาต`)),
    dir?.decision === 'reject' ? h('div', { class: 'sign-row' }, 'เหตุผล', dots(dir.reason, 'w-grow')) : null,
    signBlock({ img: directorSig, name: dir?.name, title: s.director_title, date: decidedOn(dir) }));

  // ส่วนล่าง 2 คอลัมน์: สถิติ + ผู้ตรวจสอบ | ความเห็นผู้บังคับบัญชา
  const page = h('article', { class: 'a4', 'aria-label': 'ใบลา' },
    header, lines, applicant, h('div', { class: 'f-bottom' }, h('div', { class: 'f-col' }, statBlock, checker), supervisor),
    leave.legacy_pdf_url ? h('p', { class: 'f-legacy' }, 'ใบลานี้นำเข้าจากระบบเดิม ต้นฉบับอยู่ในไฟล์ PDF เดิม') : null);

  const statusNote = {
    pending_hr: 'ใบลานี้ยังรอหัวหน้าฝ่ายบุคลากรตรวจสอบ',
    pending_deputy: 'ใบลานี้ยังรอรองผู้อำนวยการพิจารณา',
    pending_director: 'ใบลานี้ยังรอผู้อำนวยการพิจารณา',
    rejected: 'ใบลานี้ไม่ได้รับอนุมัติ',
    cancelled: 'ใบลานี้ถูกยกเลิกแล้ว',
  }[leave.status];

  mount(el,
    h('div', { class: 'form-toolbar no-print' },
      h('a', { class: 'back', href: `#/leave/${leave.id}` }, '← รายละเอียดใบลา'),
      statusNote ? h('span', { class: 'badge pending' }, statusNote) : h('span', { class: 'badge approved' }, 'อนุญาตแล้ว'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => window.print() }, 'พิมพ์ / บันทึกเป็น PDF')),
    h('div', { class: 'a4-wrap' }, page));

  await document.fonts?.ready;
  // ตำแหน่งยาว (เช่น มีชื่อโรงเรียนเต็ม) ย่อตัวอักษรให้อยู่บรรทัดเดียว ไม่เล็กกว่า 9pt แล้วจึงยอมขึ้นบรรทัดใหม่
  for (const f of page.querySelectorAll('.fill.w-title')) {
    for (let pt = 11.5; f.scrollWidth > f.clientWidth && pt >= 9; pt -= 0.5) f.style.fontSize = `${pt}pt`;
    if (f.scrollWidth > f.clientWidth) f.style.whiteSpace = 'normal';
  }
  // ใบที่ยาวกว่าปกติ (เช่น เหตุผลหลายบรรทัด) บีบระยะบรรทัด แล้วย่อตัวอักษรเหตุผล จนพอดี A4 หน้าเดียว
  const fits = () => {
    const top = page.getBoundingClientRect().top;
    const bottom = Math.max(...[...page.children].map((c) => c.getBoundingClientRect().bottom));
    return bottom - top <= (297 * 96) / 25.4 - parseFloat(getComputedStyle(page).paddingBottom);
  };
  for (const cls of ['compact', 'compact-2']) {
    if (fits()) break;
    page.classList.add(cls);
  }
}
