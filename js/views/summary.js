import { h, mount, loading, errorBox, fmtDays } from '../ui.js';
import { sb } from '../supabase.js';
import { rpc, query } from '../api.js';
import { thDate, todayISO } from '../lib/thai-date.js';
import { xlsxBlob, downloadBlob } from '../lib/xlsx.js';

const collator = new Intl.Collator('th');

function card(label, value, kind = '') {
  return h('div', { class: `stat ${kind}` }, h('span', { class: 'stat-num' }, String(value)), h('span', {}, label));
}

function exportExcel(data) {
  const { round, types, rows } = data;
  const head1 = ['ลำดับ', 'ชื่อ-สกุล', 'ตำแหน่ง'];
  const head2 = ['', '', ''];
  for (const t of types) {
    head1.push(t.label, '');
    head2.push('ครั้ง', 'วัน');
  }
  head1.push('รวม', '');
  head2.push('ครั้ง', 'วัน');
  const body = rows.map((r, i) => [
    i + 1, r.full_name, r.position,
    ...types.flatMap((t) => [Number(r.by_type[t.code].times), Number(r.by_type[t.code].days)]),
    Number(r.total_times), Number(r.total_days),
  ]);
  const title = [`สรุปการลา รอบ ${round.label} (${thDate(round.start_date)} – ${thDate(round.end_date)}) นับเฉพาะใบที่อนุญาตแล้ว`];
  const blob = xlsxBlob([{
    name: `รอบ ${round.label}`,
    rows: [title, [], head1, head2, ...body],
    headerRows: 4,
    widths: [6, 28, 22, ...types.flatMap(() => [7, 7]), 7, 7],
  }]);
  downloadBlob(blob, `สรุปการลา-รอบ-${round.label.replace('/', '-')}.xlsx`);
}

export default async function summary(el) {
  mount(el, loading());
  const rounds = await query(sb.from('leave_rounds').select('id, label, start_date, end_date')
    .order('start_date', { ascending: false }));
  if (!rounds.length) {
    mount(el, h('h1', {}, 'สรุปการลา'), h('p', { class: 'alert warn' }, 'ยังไม่มีรอบการลา กรุณาเพิ่มรอบในหน้าตั้งค่า'));
    return;
  }
  const today = todayISO();
  const current = rounds.find((r) => r.start_date <= today && today <= r.end_date) ?? rounds[0];
  const roundSel = h('select', { 'aria-label': 'รอบการลา' },
    rounds.map((r) => h('option', { value: String(r.id), selected: r.id === current.id }, `รอบ ${r.label}`)));
  const body = h('div');
  let data = null;
  const exportBtn = h('button', { type: 'button', class: 'btn', onclick: () => data && exportExcel(data) }, 'ส่งออก Excel');

  const load = async () => {
    mount(body, loading());
    try {
      data = await rpc('admin_summary', { p_round_id: Number(roundSel.value) });
      // ซ่อนบัญชีบทบาทหัวหน้าฝ่ายบุคลากร/รองผู้อำนวยการ/ผู้อำนวยการ (ซ้ำกับบัญชีครูของคนเดียวกัน)
      const roles = new Map((await query(sb.from('profiles').select('id, role'))).map((x) => [x.id, x.role]));
      data.rows = data.rows.filter((r) => (roles.get(r.user_id) ?? 'teacher') === 'teacher');
      data.rows.sort((a, b) => collator.compare(a.full_name, b.full_name));
      const { counts, types, rows, round } = data;
      const table = h('table', { class: 'table responsive' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'ชื่อ-สกุล'),
          types.map((t) => h('th', { class: 'num' }, t.label, h('br'), h('small', {}, 'ครั้ง / วัน'))),
          h('th', { class: 'num' }, 'รวม', h('br'), h('small', {}, 'ครั้ง / วัน')))),
        h('tbody', {}, rows.map((r) => h('tr', { class: r.active ? null : 'inactive' },
          h('td', { 'data-label': 'ชื่อ-สกุล' }, h('strong', {}, r.full_name), h('br'), h('small', { class: 'muted' }, r.position)),
          types.map((t) => {
            const x = r.by_type[t.code];
            return h('td', { class: 'num', 'data-label': t.label },
              Number(x.times) ? `${x.times} / ${fmtDays(x.days)}` : '-');
          }),
          h('td', { class: 'num strong', 'data-label': 'รวม' },
            Number(r.total_times) ? `${r.total_times} / ${fmtDays(r.total_days)}` : '-')))));
      mount(body,
        h('div', { class: 'stats' },
          card('ใบลาทั้งหมด', counts.total),
          card('รอหัวหน้าฝ่าย', counts.pending_hr, 'pending'),
          card('รอรองฯ', counts.pending_deputy, 'pending'),
          card('รอ ผอ.', counts.pending_director, 'pending'),
          card('เสร็จแล้ว', counts.approved + counts.rejected, 'done')),
        h('p', { class: 'muted small' },
          `อนุญาต ${counts.approved} · ไม่อนุมัติ ${counts.rejected} · ยกเลิก ${counts.cancelled} — `
          + `รอบ ${round.label}: ${thDate(round.start_date)} – ${thDate(round.end_date)}`),
        rows.length ? table : h('p', { class: 'empty' }, 'ยังไม่มีผู้ใช้'),
        h('p', { class: 'muted small' }, 'ตัวเลขนับเฉพาะใบที่ผู้อำนวยการอนุญาตแล้ว ใบที่คาบเกี่ยวสองรอบนับวันตามรอบที่วันนั้นอยู่ และนับครั้งในรอบของวันเริ่มลา'));
    } catch (e) {
      data = null;
      mount(body, errorBox(e));
    }
  };
  roundSel.addEventListener('change', load);

  mount(el,
    h('div', { class: 'row space wrap' }, h('h1', {}, 'สรุปการลา'), h('div', { class: 'row gap' }, roundSel, exportBtn)),
    body);
  await load();
}
