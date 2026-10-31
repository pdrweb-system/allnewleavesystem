import { h, mount, loading, toast, errorText, errorBox, dialog, statusBadge, field } from '../ui.js';
import { sb } from '../supabase.js';
import { rpc, query, typeLabels, clearCaches } from '../api.js';
import { thDate, thDateTime, todayISO } from '../lib/thai-date.js';
import { LEAVE_COLUMNS, daysText } from './parts.js';

const STATUS_FILTERS = [
  ['approved', 'อนุญาตแล้ว'],
  ['all', 'ทุกสถานะ'],
  ['pending', 'รอพิจารณา'],
  ['rejected', 'ไม่อนุมัติ'],
  ['cancelled', 'ยกเลิกแล้ว'],
];

const dateRange = (l) => (l.from_date === l.to_date ? thDate(l.from_date) : `${thDate(l.from_date)} – ${thDate(l.to_date)}`);

// ลบใบลาแบบแอดมิน: ถามเหตุผล → ลบใบลา (ฐานข้อมูลบันทึกประวัติ) → ลบไฟล์ลายเซ็น/ใบรับรองแพทย์ที่แนบ
async function deleteDialog(l, labels, reload) {
  const reason = h('input', { maxlength: '200', placeholder: 'เช่น บันทึกผิดคน / ยื่นซ้ำ', 'aria-label': 'เหตุผลที่ลบ' });
  const msg = h('div', { class: 'alert error', role: 'alert', hidden: true });
  const ok = await dialog({
    title: 'ลบใบลา',
    body: [
      h('p', { class: 'alert warn' }, 'ลบแล้วกู้คืนไม่ได้ ใบลาและไฟล์แนบจะหายถาวร และยอดลา/สถิติของคนนี้จะเปลี่ยนตาม'),
      h('p', {}, h('strong', {}, l.snap_name), ` — ${labels[l.leave_type] ?? l.leave_type} ${dateRange(l)} (${daysText(l)}) `, statusBadge(l.status)),
      field('เหตุผลที่ลบ (จำเป็น — บันทึกไว้ในประวัติ)', reason),
      msg,
    ],
    actions: [
      { label: 'ยกเลิก', value: false },
      {
        label: 'ลบถาวร', value: true, kind: 'danger',
        validate: () => {
          if (reason.value.trim()) return true;
          msg.textContent = 'กรุณาระบุเหตุผลที่ลบ';
          msg.hidden = false;
          return false;
        },
      },
    ],
    onOpen: () => reason.focus(),
  });
  if (!ok) return;
  try {
    const res = await rpc('admin_delete_leave', { p_leave_id: l.id, p_reason: reason.value.trim() });
    let leftover = 0;
    for (const [bucket, path] of [['leave-signatures', res.signature_path], ['leave-certs', res.cert_path]]) {
      if (!path) continue;
      const { error } = await sb.storage.from(bucket).remove([path]);
      if (error) leftover += 1;
    }
    clearCaches();
    toast(leftover ? 'ลบใบลาแล้ว แต่ลบไฟล์แนบไม่สำเร็จบางไฟล์ (ลบเองได้ที่ Supabase Storage)' : 'ลบใบลาแล้ว', leftover ? 'error' : 'ok');
  } catch (e) {
    toast(errorText(e), 'error');
  }
  reload();
}

export default async function adminLeaves(el) {
  mount(el, loading());
  const [labels, rounds] = await Promise.all([
    typeLabels(),
    query(sb.from('leave_rounds').select('id, label, start_date, end_date').order('start_date', { ascending: false })),
  ]);
  const today = todayISO();
  const current = rounds.find((r) => r.start_date <= today && today <= r.end_date) ?? rounds[0];

  const roundSel = h('select', { 'aria-label': 'รอบการลา' },
    h('option', { value: 'all' }, 'ทุกรอบ'),
    rounds.map((r) => h('option', { value: String(r.id), selected: r.id === current?.id }, `รอบ ${r.label}`)));
  const statusSel = h('select', { 'aria-label': 'สถานะ' }, STATUS_FILTERS.map(([v, l]) => h('option', { value: v }, l)));
  const search = h('input', { type: 'search', placeholder: 'ค้นหาชื่อ', 'aria-label': 'ค้นหาชื่อ' });
  const list = h('div', {});
  const log = h('div', {});
  let rows = [];

  const draw = () => {
    const q = search.value.trim();
    const shown = rows.filter((l) => !q || l.snap_name.includes(q));
    mount(list, shown.length
      ? h('table', { class: 'table responsive' },
        h('thead', {}, h('tr', {}, ['ผู้ลา', 'ประเภท', 'วันที่ลา', 'จำนวน', 'สถานะ', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, shown.map((l) => h('tr', {},
          h('td', { 'data-label': 'ผู้ลา' }, h('strong', {}, l.snap_name), h('div', { class: 'muted small' }, l.snap_position ?? '')),
          h('td', { 'data-label': 'ประเภท' }, labels[l.leave_type] ?? l.leave_type),
          h('td', { 'data-label': 'วันที่ลา' }, dateRange(l)),
          h('td', { 'data-label': 'จำนวน' }, daysText(l)),
          h('td', { 'data-label': 'สถานะ' }, statusBadge(l.status)),
          h('td', {},
            h('a', { class: 'btn small', href: `#/leave/${l.id}` }, 'ดู'), ' ',
            h('button', { type: 'button', class: 'btn small danger', onclick: () => deleteDialog(l, labels, reload) }, 'ลบ'))))))
      : h('p', { class: 'empty' }, 'ไม่พบใบลา'));
  };

  const reload = async () => {
    mount(list, loading());
    try {
      let q = sb.from('leaves').select(LEAVE_COLUMNS).order('from_date', { ascending: false }).order('id', { ascending: false }).limit(500);
      const r = rounds.find((x) => String(x.id) === roundSel.value);
      if (r) q = q.gte('from_date', r.start_date).lte('from_date', r.end_date);
      if (statusSel.value === 'pending') q = q.like('status', 'pending_%');
      else if (statusSel.value !== 'all') q = q.eq('status', statusSel.value);
      rows = await query(q);
      draw();
    } catch (e) {
      mount(list, errorBox(e));
    }
    drawLog();
  };

  const drawLog = async () => {
    try {
      const audit = await query(sb.from('admin_audit').select('id, actor, detail, created_at')
        .eq('action', 'delete_leave').order('created_at', { ascending: false }).limit(20));
      const ids = [...new Set(audit.map((a) => a.actor))];
      const people = ids.length ? await query(sb.from('profiles').select('id, full_name').in('id', ids)) : [];
      const nameOf = Object.fromEntries(people.map((p) => [p.id, p.full_name]));
      mount(log,
        h('h2', {}, 'ประวัติการลบใบลาล่าสุด'),
        audit.length
          ? h('ul', { class: 'log' }, audit.map((a) => {
            const d = a.detail ?? {};
            return h('li', {},
              h('span', { class: 'muted small' }, thDateTime(a.created_at)), ' ',
              `${nameOf[a.actor] ?? 'แอดมิน'} ลบใบลา${labels[d.type] ?? d.type ?? ''}ของ ${d.name ?? ''} (${d.from ? thDate(d.from) : ''}${d.to && d.to !== d.from ? ` – ${thDate(d.to)}` : ''}) — เหตุผล: ${d.reason ?? ''}`);
          }))
          : h('p', { class: 'empty' }, 'ยังไม่มีประวัติ'));
    } catch (e) {
      mount(log, errorBox(e));
    }
  };

  for (const c of [roundSel, statusSel]) c.addEventListener('change', reload);
  search.addEventListener('input', draw);
  mount(el,
    h('h1', {}, 'จัดการใบลา'),
    h('p', { class: 'muted' }, 'แอดมินลบใบลาที่บันทึกผิดหรือซ้ำได้ทุกสถานะ รวมที่อนุญาตแล้ว — ต้องระบุเหตุผลและระบบเก็บประวัติไว้ แต่ลบแล้วกู้ใบลาคืนไม่ได้'),
    h('div', { class: 'row gap wrap' }, roundSel, statusSel, search),
    list,
    h('section', { class: 'section' }, log));
  await reload();
}
