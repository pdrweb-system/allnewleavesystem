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
  return url ? h('img', { class: 'sig', src: url, alt }) : h('span', { class: 'sig-missing' }, '(ไม่พบภาพลายเซ็น)');
}

function signBlock({ img, name, title, date, label = '(ลงชื่อ)' }) {
  return h('div', { class: 'sign' },
    h('div', { class: 'sign-line' }, h('span', {}, label), h('span', { class: 'sign-slot' }, img ?? '')),
    h('div', { class: 'sign-name' }, `(${name ? ` ${name} ` : ' '.repeat(40)})`),
    title ? h('div', { class: 'sign-title' }, title) : null,
    date !== undefined ? h('div', { class: 'sign-date' }, `วันที่ ${date || '.........../.........../...........'}`) : null);
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

  const decidedDate = (a) => (a ? thDate(a.approve_date ?? a.decided_at?.slice(0, 10), { short: true }) : '');
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
    last
      ? h('p', {}, 'ข้าพเจ้าได้ลา ', dots(last.label, 'w-type'), ' ครั้งสุดท้ายตั้งแต่วันที่ ',
        dots(thDate(last.from_date), 'w-date'), ' ถึงวันที่ ', dots(thDate(last.to_date), 'w-date'),
        ' มีกำหนด ', dots(last.half_day ? '0.5' : fmtDays(last.total_days), 'w-num'), ' วัน')
      : h('p', {}, 'ข้าพเจ้าได้ลา ', dots('-', 'w-type'), ' ครั้งสุดท้ายตั้งแต่วันที่ ', dots('-', 'w-date'),
        ' ถึงวันที่ ', dots('-', 'w-date'), ' มีกำหนด ', dots('-', 'w-num'), ' วัน'),
    h('p', {}, 'ในระหว่างลาจะติดต่อข้าพเจ้าได้ที่ ', dots(leave.contact_phone, 'w-contact')));

  const applicant = h('div', { class: 'f-applicant' },
    h('div', { class: 'f-regards' }, 'ขอแสดงความนับถือ'),
    signBlock({ img: teacherSig, name: leave.name ?? leave.snap_name }));

  // ---------- ส่วนล่างซ้าย: สถิติ + ผู้ตรวจสอบ ----------
  const statTable = h('table', { class: 'f-stats' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'ประเภทการลา'), h('th', {}, 'ลามาแล้ว'), h('th', {}, 'ลาครั้งนี้'), h('th', {}, 'รวมเป็น'))),
    h('tbody', {}, FORM_ORDER.map((code) => {
      const x = statByCode[code] ?? { before_times: 0, before_days: 0, this_times: 0, this_days: 0 };
      return h('tr', {},
        h('td', {}, x.form_label ?? code),
        h('td', {}, statCell(x.before_times, x.before_days)),
        h('td', {}, x.this_times ? statCell(x.this_times, x.this_days) : ''),
        h('td', {}, statCell(x.before_times + x.this_times, Number(x.before_days) + Number(x.this_days))));
    })),
    h('caption', {}, 'หน่วย: ครั้ง / วัน'));

  const hr = byStep.hr;
  const checker = h('div', { class: 'f-box' },
    skipped('hr')
      ? h('p', { class: 'f-note' }, 'ผู้ลาเป็นหัวหน้าฝ่ายบริหารงานบุคคล (ไม่ต้องผ่านขั้นตรวจสอบ)')
      : [
        hr?.decision === 'reject' ? h('p', { class: 'f-reject' }, `ไม่ผ่านการตรวจสอบ: ${hr.reason}`) : null,
        signBlock({
          img: hrSig, name: hr?.name, title: s.hr_title ?? 'หัวหน้าฝ่ายบริหารงานบุคคล',
          date: decidedDate(hr), label: '(ลงชื่อ)',
        }),
        h('div', { class: 'sign-role' }, 'ผู้ตรวจสอบ'),
      ]);

  const left = h('div', { class: 'f-col' },
    h('h2', {}, 'สถิติการลาในปีงบประมาณนี้', round ? h('small', {}, ` (รอบ ${round.label})`) : null),
    statTable,
    checker);

  // ---------- ส่วนล่างขวา: ความเห็นรองฯ + คำสั่ง ผอ. ----------
  const dep = byStep.deputy;
  const deputyBox = h('div', { class: 'f-box' },
    h('h2', {}, 'ความเห็นรองผู้อำนวยการ'),
    skipped('deputy')
      ? h('p', { class: 'f-note' }, 'ผู้ลาเป็นรองผู้อำนวยการ')
      : [
        h('p', { class: 'f-opinion' }, dots(dep
          ? (dep.decision === 'approve' ? s.deputy_approve_text : `${s.deputy_reject_text} ${dep.reason ? `(${dep.reason})` : ''}`)
          : '', 'w-full')),
        signBlock({ img: deputySig, name: dep?.name, title: s.deputy_title, date: decidedDate(dep) }),
      ]);

  const dir = byStep.director;
  const directorBox = h('div', { class: 'f-box' },
    h('h2', {}, 'ความเห็นผู้บังคับบัญชา'),
    h('p', { class: 'f-order' },
      h('span', { class: 'tick' }, `${BOX[dir?.decision === 'approve']} อนุญาต`),
      h('span', { class: 'tick' }, `${BOX[dir?.decision === 'reject']} ไม่อนุญาต`)),
    dir?.decision === 'reject' ? h('p', {}, 'เหตุผล ', dots(dir.reason, 'w-full')) : null,
    signBlock({ img: directorSig, name: dir?.name, title: s.director_title, date: dir ? decidedDate(dir) : '' }));

  const right = h('div', { class: 'f-col' }, deputyBox, directorBox);

  const page = h('article', { class: 'a4', 'aria-label': 'ใบลา' },
    header, lines, applicant, h('div', { class: 'f-bottom' }, left, right),
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
}
