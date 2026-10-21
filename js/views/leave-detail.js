import { h, mount, loading, toast, errorText, errorBox, dialog, confirmDialog, statusBadge, field } from '../ui.js';
import { sb } from '../supabase.js';
import { rpc, query, typeLabels, fileUrl } from '../api.js';
import { thDate, thRange, todayISO } from '../lib/thai-date.js';
import { timeline, daysText, STEP_LABEL } from './parts.js';

async function showCert(path) {
  const url = await fileUrl('leave-certs', path);
  await dialog({
    title: 'ใบรับรองแพทย์',
    body: url
      ? [h('img', { class: 'cert-full', src: url, alt: 'ใบรับรองแพทย์' })]
      : [h('p', { class: 'alert error' }, 'เปิดไฟล์ไม่ได้ หรือคุณไม่มีสิทธิ์ดูไฟล์นี้')],
  });
}

function decisionPanel(leave, profile, onDone) {
  const isDirector = profile.role === 'director';
  const reason = h('textarea', { rows: '3', maxlength: '500', placeholder: 'จำเป็นเมื่อไม่อนุมัติ' });
  const today = todayISO();
  const date = h('input', { type: 'date', value: today, max: today, min: leave.filed_date });
  const msg = h('div', { class: 'alert error', role: 'alert', hidden: true });
  const buttons = [];

  const decide = async (decision) => {
    msg.hidden = true;
    const why = reason.value.trim();
    if (decision === 'reject' && !why) {
      msg.textContent = 'กรุณาระบุเหตุผลที่ไม่อนุมัติ';
      msg.hidden = false;
      reason.focus();
      return;
    }
    const ok = await confirmDialog(
      decision === 'approve' ? 'ยืนยันอนุมัติ' : 'ยืนยันไม่อนุมัติ',
      decision === 'approve'
        ? `อนุมัติใบลาของ ${leave.snap_name} — ระบบจะใส่ลายเซ็นของคุณในใบลาให้อัตโนมัติ`
        : `ไม่อนุมัติใบลาของ ${leave.snap_name} — ใบลาจะสิ้นสุดทันทีและแจ้งผู้ลา`,
      { okText: decision === 'approve' ? 'อนุมัติ' : 'ไม่อนุมัติ', danger: decision === 'reject' });
    if (!ok) return;
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const res = await rpc('decide_leave', {
        p_leave_id: leave.id,
        p_decision: decision,
        p_reason: why || null,
        p_approve_date: isDirector ? date.value || null : null,
      });
      toast(res.status === 'approved' ? 'อนุญาตแล้ว' : res.status === 'rejected' ? 'บันทึกไม่อนุมัติแล้ว' : 'อนุมัติแล้ว ส่งต่อขั้นถัดไป');
      onDone();
    } catch (e) {
      msg.textContent = errorText(e);
      msg.hidden = false;
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  };

  buttons.push(
    h('button', { type: 'button', class: 'btn primary', onclick: () => decide('approve') }, isDirector ? 'อนุญาต' : 'อนุมัติ'),
    h('button', { type: 'button', class: 'btn danger', onclick: () => decide('reject') }, isDirector ? 'ไม่อนุญาต' : 'ไม่อนุมัติ'));

  return h('section', { class: 'card decision stack' },
    h('h2', {}, `การพิจารณาของคุณ (${STEP_LABEL[profile.role]})`),
    !profile.signature_path
      ? h('p', { class: 'alert warn' }, 'ยังไม่มีลายเซ็นของคุณในระบบ อนุมัติไม่ได้จนกว่าแอดมินจะอัปโหลดลายเซ็นให้')
      : null,
    isDirector ? field('วันที่อนุญาต', date) : null,
    field('เหตุผล / ความเห็น', reason),
    msg,
    h('div', { class: 'row gap' }, buttons));
}

export default async function leaveDetail(el, { id }, { profile }) {
  const leaveId = Number(id);
  const load = async () => {
    mount(el, loading());
    const [rows, approvals, labels] = await Promise.all([
      query(sb.from('leaves').select('*').eq('id', leaveId).limit(1)),
      query(sb.from('approvals').select('step, decision, reason, snap_name, approve_date, decided_at')
        .eq('leave_id', leaveId).order('decided_at')),
      typeLabels(),
    ]);
    const leave = rows[0];
    if (!leave) {
      mount(el, h('section', { class: 'card narrow center' }, h('h1', {}, 'ไม่พบใบลา'),
        h('p', {}, 'ใบลานี้ไม่มีอยู่ หรือคุณไม่มีสิทธิ์ดู'), h('a', { class: 'btn primary', href: '#/' }, 'กลับหน้าหลัก')));
      return;
    }
    const isOwner = leave.user_id === profile.id;
    const myTurn = !isOwner && profile.role !== 'teacher' && leave.status === `pending_${profile.role}`;
    const cancellable = isOwner && leave.status.startsWith('pending_') && approvals.length === 0;

    const actions = h('div', { class: 'row gap wrap' },
      h('a', { class: 'btn', href: `#/leave/${leave.id}/form` }, 'ดู / พิมพ์ใบลา'),
      leave.cert_path
        ? h('button', { type: 'button', class: 'btn', onclick: () => showCert(leave.cert_path) }, 'ดูใบรับรองแพทย์')
        : null,
      leave.legacy_pdf_url && /^https:\/\//.test(leave.legacy_pdf_url)
        ? h('a', { class: 'btn', href: leave.legacy_pdf_url, target: '_blank', rel: 'noopener noreferrer' }, 'ใบลาเดิม (PDF)')
        : null,
      cancellable
        ? h('button', {
          type: 'button', class: 'btn danger ghost',
          onclick: async () => {
            if (!await confirmDialog('ยกเลิกใบลา', 'ยกเลิกใบลานี้? ยกเลิกแล้วต้องยื่นใหม่', { okText: 'ยกเลิกใบลา', danger: true })) return;
            try {
              await rpc('cancel_leave', { p_leave_id: leave.id });
              toast('ยกเลิกใบลาแล้ว');
              load();
            } catch (e) {
              toast(errorText(e), 'error');
            }
          },
        }, 'ยกเลิกใบลา')
        : null);

    mount(el,
      h('div', { class: 'row space' },
        h('a', { class: 'back', href: canBack() ? '#/approvals' : '#/' }, '← กลับ'),
        statusBadge(leave.status)),
      h('section', { class: 'card stack' },
        h('h1', {}, `${labels[leave.leave_type] ?? leave.leave_type}`),
        h('dl', { class: 'facts' },
          h('dt', {}, 'ผู้ลา'), h('dd', {}, `${leave.snap_name} (${leave.snap_position})`),
          h('dt', {}, 'วันที่ลา'), h('dd', {}, thRange(leave.from_date, leave.to_date, { short: false })),
          h('dt', {}, 'จำนวน'), h('dd', {}, daysText(leave)),
          h('dt', {}, 'เนื่องจาก'), h('dd', { class: 'pre' }, leave.reason),
          h('dt', {}, 'ติดต่อได้ที่'), h('dd', {}, leave.contact_phone),
          h('dt', {}, 'วันที่ยื่น'), h('dd', {}, thDate(leave.filed_date))),
        actions),
      myTurn ? decisionPanel(leave, profile, load) : null,
      h('section', { class: 'card' }, h('h2', {}, 'ขั้นการอนุมัติ'), timeline(leave, approvals)));
  };

  const canBack = () => profile.role !== 'teacher' || profile.is_admin;
  try {
    await load();
  } catch (e) {
    mount(el, errorBox(e));
  }
}

