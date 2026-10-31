// ส่วนประกอบที่ใช้ร่วมกันหลายหน้า
import { h, fmtDays, statusBadge } from '../ui.js';
import { thRange, thDate, thDateTime } from '../lib/thai-date.js';

export const STEPS = ['hr', 'deputy', 'director'];
export const STEP_LABEL = { hr: 'หัวหน้าฝ่ายบุคลากร', deputy: 'รองผู้อำนวยการ', director: 'ผู้อำนวยการ' };

export const LEAVE_COLUMNS = 'id, user_id, snap_name, snap_position, leave_type, from_date, to_date, total_days, '
  + 'half_day, status, steps, filed_date, created_at, cert_path, signature_path';

export function daysText(leave) {
  return leave.half_day ? 'ครึ่งวัน' : `${fmtDays(leave.total_days)} วัน`;
}

// สถานะของแต่ละขั้นจากใบลา (+ ประวัติการพิจารณา ถ้ามี)
export function stepStates(leave, approvals = []) {
  const byStep = Object.fromEntries(approvals.map((a) => [a.step, a]));
  const current = leave.status.startsWith('pending_') ? leave.status.slice(8) : null;
  return STEPS.map((step) => {
    const a = byStep[step];
    if (!leave.steps.includes(step)) return { step, state: 'skipped' };
    if (a) return { step, state: a.decision === 'approve' ? 'done' : 'rejected', approval: a };
    if (step === current) return { step, state: 'current' };
    if (leave.status === 'approved') return { step, state: 'done' };
    if (leave.status === 'rejected' || leave.status === 'cancelled') return { step, state: 'stopped' };
    return { step, state: 'waiting' };
  });
}

export function progressDots(leave) {
  return h('ol', { class: 'dots', 'aria-label': 'ขั้นการอนุมัติ' },
    stepStates(leave).map((s) => h('li', { class: s.state, title: STEP_LABEL[s.step] }, STEP_LABEL[s.step])));
}

// สีประจำประเภทการลา (ใช้ร่วมกันทั้งระบบ): ตามลำดับประเภทใน leave_types ได้ tc-0 .. tc-5 สีไม่ซ้ำกัน
export function typeColor(typeLabels, code) {
  return `tc-${Math.max(0, Object.keys(typeLabels).indexOf(code)) % 6}`;
}

export function leaveCard(leave, typeLabels, { showName = false } = {}) {
  return h('a', { class: `leave-card ${typeColor(typeLabels, leave.leave_type)}`, href: `#/leave/${leave.id}` },
    h('div', { class: 'leave-card-top' },
      h('strong', {}, showName ? leave.snap_name : typeLabels[leave.leave_type] ?? leave.leave_type),
      statusBadge(leave.status)),
    showName ? h('div', { class: 'muted' }, typeLabels[leave.leave_type] ?? leave.leave_type) : null,
    h('div', {}, `${thRange(leave.from_date, leave.to_date)} · ${daysText(leave)}`),
    h('div', { class: 'leave-card-bottom' },
      leave.status.startsWith('pending_') ? progressDots(leave) : h('span'),
      h('small', { class: 'muted' }, `ยื่น ${thDate(leave.filed_date, { short: true })}`)));
}

const STATE_TEXT = {
  done: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
  current: 'กำลังรอพิจารณา',
  waiting: 'รอขั้นก่อนหน้า',
  stopped: '—',
};

export function timeline(leave, approvals) {
  const skipNote = { hr: 'ผู้ยื่นเป็นหัวหน้าฝ่ายบุคลากร', deputy: 'ผู้ยื่นเป็นรองผู้อำนวยการ', director: '' };
  return h('ol', { class: 'timeline' },
    h('li', { class: 'done' },
      h('div', { class: 'tl-title' }, 'ยื่นใบลา'),
      h('div', { class: 'muted small' }, `${leave.snap_name} · ${thDateTime(leave.created_at)}`)),
    stepStates(leave, approvals).map((s) => {
      const a = s.approval;
      return h('li', { class: s.state },
        h('div', { class: 'tl-title' }, STEP_LABEL[s.step],
          h('span', { class: 'tl-state' }, s.state === 'skipped' ? 'ข้ามขั้นนี้' : STATE_TEXT[s.state])),
        s.state === 'skipped' ? h('div', { class: 'muted small' }, skipNote[s.step]) : null,
        a ? h('div', { class: 'muted small' }, `${a.snap_name ?? ''} · ${thDateTime(a.decided_at)}`) : null,
        a?.approve_date ? h('div', { class: 'small' }, `วันที่อนุญาต ${thDate(a.approve_date)}`) : null,
        a?.reason ? h('div', { class: 'small reason' }, `เหตุผล: ${a.reason}`) : null);
    }),
    leave.status === 'cancelled'
      ? h('li', { class: 'stopped' }, h('div', { class: 'tl-title' }, 'ผู้ยื่นยกเลิกใบลา'))
      : null);
}
