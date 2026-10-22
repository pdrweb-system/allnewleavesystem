import { h, mount, loading, errorBox } from '../ui.js';
import { sb } from '../supabase.js';
import { query, typeLabels } from '../api.js';
import { isApprover } from '../auth.js';
import { todayISO } from '../lib/thai-date.js';
import { leaveCard, LEAVE_COLUMNS, STEP_LABEL } from './parts.js';

const STATUS_FILTERS = [
  ['all', 'ทุกสถานะ'],
  ['pending', 'รอพิจารณา'],
  ['approved', 'อนุญาตแล้ว'],
  ['rejected', 'ไม่อนุมัติ'],
  ['cancelled', 'ยกเลิก'],
];

export default async function approvals(el, _params, { profile }) {
  mount(el, loading());
  const [labels, rounds] = await Promise.all([
    typeLabels(),
    query(sb.from('leave_rounds').select('id, label, start_date, end_date').order('start_date', { ascending: false })),
  ]);
  const today = todayISO();
  const current = rounds.find((r) => r.start_date <= today && today <= r.end_date) ?? rounds[0];

  const body = h('div', { class: 'view-body' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  let tab = isApprover(profile) ? 'mine' : 'all';

  async function showMine() {
    mount(body, loading());
    const rows = await query(sb.from('leaves').select(LEAVE_COLUMNS)
      .eq('status', `pending_${profile.role}`).neq('user_id', profile.id)
      .order('filed_date').order('id'));
    mount(body,
      h('p', { class: 'muted small' }, `ใบลาที่รอ${STEP_LABEL[profile.role]}พิจารณา เรียงจากยื่นก่อน`),
      rows.length
        ? h('div', { class: 'list' }, rows.map((l) => leaveCard(l, labels, { showName: true })))
        : h('p', { class: 'empty' }, 'ไม่มีใบลารอคุณพิจารณา'));
  }

  async function showAll() {
    const roundSel = h('select', { 'aria-label': 'รอบการลา' },
      rounds.map((r) => h('option', { value: String(r.id), selected: r.id === current?.id }, `รอบ ${r.label}`)));
    const statusSel = h('select', { 'aria-label': 'สถานะ' },
      STATUS_FILTERS.map(([v, l]) => h('option', { value: v }, l)));
    const search = h('input', { type: 'search', placeholder: 'ค้นหาชื่อ', 'aria-label': 'ค้นหาชื่อ' });
    const list = h('div', { class: 'list' });
    let rows = [];

    const draw = () => {
      const q = search.value.trim();
      const shown = rows.filter((l) => !q || l.snap_name.includes(q));
      mount(list, shown.length
        ? shown.map((l) => leaveCard(l, labels, { showName: true }))
        : h('p', { class: 'empty' }, 'ไม่พบใบลา'));
    };
    const reload = async () => {
      mount(list, loading());
      const r = rounds.find((x) => String(x.id) === roundSel.value);
      let q = sb.from('leaves').select(LEAVE_COLUMNS).order('from_date', { ascending: false }).order('id', { ascending: false }).limit(500);
      if (r) q = q.gte('from_date', r.start_date).lte('from_date', r.end_date);
      if (statusSel.value === 'pending') q = q.in('status', ['pending_hr', 'pending_deputy', 'pending_director']);
      else if (statusSel.value !== 'all') q = q.eq('status', statusSel.value);
      try {
        rows = await query(q);
        draw();
      } catch (e) {
        mount(list, errorBox(e));
      }
    };
    roundSel.addEventListener('change', reload);
    statusSel.addEventListener('change', reload);
    search.addEventListener('input', draw);
    mount(body, h('div', { class: 'filters' }, roundSel, statusSel, search), list);
    await reload();
  }

  function drawTabs() {
    const defs = isApprover(profile) ? [['mine', 'รอฉันพิจารณา'], ['all', 'ทั้งหมด']] : [['all', 'ทั้งหมด']];
    mount(tabs, defs.map(([key, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(tab === key), class: tab === key ? 'active' : null,
      onclick: () => {
        tab = key;
        drawTabs();
        (tab === 'mine' ? showMine : showAll)().catch((e) => mount(body, errorBox(e)));
      },
    }, label)));
  }

  mount(el, h('h1', {}, isApprover(profile) ? 'อนุมัติใบลา' : 'ใบลาทั้งหมด'), tabs, body);
  drawTabs();
  await (tab === 'mine' ? showMine() : showAll());
}
