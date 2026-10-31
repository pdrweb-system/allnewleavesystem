import { h, mount, loading, toast, errorText, errorBox, confirmDialog, dialog, field } from '../ui.js';
import { sb } from '../supabase.js';
import { rpc, query, clearCaches, callFunction } from '../api.js';
import { thDate, thDateTime, todayISO, parseFlexibleDate, parseISO } from '../lib/thai-date.js';

const run = async (fn, okMessage) => {
  try {
    await fn();
    if (okMessage) toast(okMessage);
    return true;
  } catch (e) {
    toast(errorText(e), 'error');
    return false;
  }
};

// ---------------- วันหยุด ----------------
// ดึงวันหยุดราชการปีนี้และปีหน้า (พ.ศ.) จาก calendar.kapook.com ผ่าน Edge Function holidays-import
// แสดงให้ตรวจก่อน เพิ่มเฉพาะวันที่ยังไม่มีในระบบ (วันที่มีแล้วไม่แก้ชื่อเดิม)
async function importGovHolidays(onDone) {
  const yearBE = parseISO(todayISO()).y + 543;
  const years = [yearBE, yearBE + 1];
  let waitBox = null;
  const waiting = dialog({ title: 'กำลังดึงวันหยุดราชการ…', body: [loading()], actions: [], onOpen: (d) => { waitBox = d; } });
  let data;
  let existing;
  try {
    [data, existing] = await Promise.all([
      callFunction('holidays-import', { years }),
      query(sb.from('holidays').select('day, name')
        .gte('day', `${years[0] - 543}-01-01`).lte('day', `${years[1] - 543}-12-31`)),
    ]);
  } catch (e) {
    toast(errorText(e), 'error');
    return;
  } finally {
    waitBox?.dispatchEvent(new Event('cancel')); // ปิดหน้าต่างรอ
    await waiting;
  }
  const have = Object.fromEntries(existing.map((r) => [r.day, r.name]));
  const picks = [];
  const blocks = data.results.map((r) => h('section', { class: 'stack' },
    h('h3', {}, `พ.ศ. ${r.year} `, /^https:\/\//.test(r.url)
      ? h('small', { class: 'muted' }, h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, 'ที่มา'))
      : null),
    r.error ? h('p', { class: 'alert error' }, r.error) : null,
    r.holidays.length
      ? h('ul', { class: 'plain-list' }, r.holidays.map((x) => {
        const box = h('input', { type: 'checkbox', checked: !have[x.date], disabled: !!have[x.date] });
        if (!have[x.date]) picks.push({ box, row: { day: x.date, name: x.name } });
        return h('li', {}, h('label', { class: 'check' }, box, ' ',
          h('strong', {}, thDate(x.date, { weekday: true })), ` — ${x.name}`,
          have[x.date] ? h('small', { class: 'muted' }, ` (มีแล้ว: ${have[x.date]})`) : null));
      }))
      : null));
  const msg = h('div', { class: 'alert error', role: 'alert', hidden: true });
  let added = 0;
  const ok = await dialog({
    title: 'วันหยุดราชการจากปฏิทินกระปุก',
    body: [
      h('p', { class: 'muted small' }, 'เฉพาะวันหยุดราชการ (ไม่รวมวันหยุดเฉพาะธนาคาร) — เลือกวันที่จะเพิ่ม วันที่มีในระบบแล้วจะไม่ถูกแก้ไข'),
      blocks, msg,
    ],
    actions: [
      { label: 'ยกเลิก', value: false },
      {
        label: 'เพิ่มวันที่เลือก', value: true, kind: 'primary',
        validate: async () => {
          const rows = picks.filter((p) => p.box.checked).map((p) => p.row);
          if (!rows.length) {
            msg.textContent = 'ยังไม่ได้เลือกวันที่จะเพิ่ม';
            msg.hidden = false;
            return false;
          }
          try {
            await query(sb.from('holidays').upsert(rows, { onConflict: 'day', ignoreDuplicates: true }));
            added = rows.length;
            return true;
          } catch (e) {
            msg.textContent = errorText(e);
            msg.hidden = false;
            return false;
          }
        },
      },
    ],
  });
  if (ok) {
    toast(`เพิ่มวันหยุดราชการ ${added} วันแล้ว`);
    onDone();
  }
}

async function holidaysSection() {
  const box = h('section', { class: 'card stack' });
  const yearNow = parseISO(todayISO()).y;
  const yearSel = h('select', { 'aria-label': 'ปี' },
    [yearNow - 1, yearNow, yearNow + 1].map((y) => h('option', { value: String(y), selected: y === yearNow }, `พ.ศ. ${y + 543}`)));
  const list = h('div');
  const day = h('input', { type: 'date' });
  const name = h('input', { maxlength: '120', placeholder: 'เช่น วันปิยมหาราช' });
  const bulk = h('textarea', { rows: '5', placeholder: '23/10/2569 วันปิยมหาราช\n2026-12-05 วันพ่อแห่งชาติ' });

  const load = async () => {
    mount(list, loading());
    const y = Number(yearSel.value);
    const rows = await query(sb.from('holidays').select('day, name').gte('day', `${y}-01-01`).lte('day', `${y}-12-31`).order('day'));
    mount(list, rows.length
      ? h('ul', { class: 'plain-list' }, rows.map((r) => h('li', { class: 'row space' },
        h('span', {}, h('strong', {}, thDate(r.day, { weekday: true })), ` — ${r.name}`),
        h('button', {
          type: 'button', class: 'btn ghost small',
          onclick: async () => {
            if (!await confirmDialog('ลบวันหยุด', `ลบ ${thDate(r.day)} ${r.name}?`, { okText: 'ลบ', danger: true })) return;
            if (await run(() => query(sb.from('holidays').delete().eq('day', r.day)), 'ลบแล้ว')) load();
          },
        }, 'ลบ'))))
      : h('p', { class: 'empty' }, 'ยังไม่มีวันหยุดในปีนี้'));
  };

  const addOne = async () => {
    if (!day.value || !name.value.trim()) return toast('กรุณากรอกวันที่และชื่อวันหยุด', 'error');
    if (await run(() => query(sb.from('holidays').upsert({ day: day.value, name: name.value.trim() })), 'เพิ่มวันหยุดแล้ว')) {
      day.value = '';
      name.value = '';
      load();
    }
  };

  const addBulk = async () => {
    const rows = [];
    const bad = [];
    for (const line of bulk.value.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const [d, ...rest] = line.split(/\s+/);
      const iso = parseFlexibleDate(d);
      if (!iso || !rest.length) bad.push(line);
      else rows.push({ day: iso, name: rest.join(' ') });
    }
    if (bad.length) return toast(`อ่านบรรทัดนี้ไม่ได้: ${bad[0]}`, 'error');
    if (!rows.length) return;
    if (await run(() => query(sb.from('holidays').upsert(rows)), `เพิ่ม/แก้ไข ${rows.length} วันแล้ว`)) {
      bulk.value = '';
      load();
    }
  };

  yearSel.addEventListener('change', () => load().catch((e) => mount(list, errorBox(e))));
  mount(box,
    h('div', { class: 'row space wrap' }, h('h2', {}, 'วันหยุดนักขัตฤกษ์ / วันหยุดโรงเรียน'), yearSel),
    h('p', { class: 'muted small' }, 'ระบบไม่นับวันเหล่านี้เป็นวันลา (ยกเว้นประเภทที่นับทุกวัน) — ใบที่ยื่นไปแล้วไม่ถูกคำนวณใหม่ จึงควรกรอกล่วงหน้า'),
    list,
    h('div', { class: 'grid-2' }, field('วันที่', day), field('ชื่อวันหยุด', name)),
    h('div', { class: 'row gap wrap' },
      h('button', { type: 'button', class: 'btn', onclick: addOne }, 'เพิ่มวันหยุด'),
      h('button', { type: 'button', class: 'btn', onclick: () => importGovHolidays(load) }, 'ดึงวันหยุดราชการ')),
    h('p', { class: 'muted small' }, '"ดึงวันหยุดราชการ" ดึงวันหยุดราชการปีนี้และปีหน้าจาก calendar.kapook.com ให้ตรวจก่อนเพิ่ม '
      + '— วันหยุดเฉพาะของโรงเรียนเพิ่มเองได้ตามปกติ'),
    h('details', {}, h('summary', {}, 'เพิ่มหลายวันพร้อมกัน'),
      field('วางรายการ บรรทัดละวัน: วันที่ เว้นวรรค ชื่อวันหยุด (ปี พ.ศ. หรือ ค.ศ. ก็ได้)', bulk),
      h('button', { type: 'button', class: 'btn', onclick: addBulk }, 'เพิ่มทั้งหมด')));
  await load();
  return box;
}

// ---------------- รอบการลา ----------------
async function roundsSection() {
  const box = h('section', { class: 'card stack' });
  const label = h('input', { maxlength: '40', placeholder: 'เช่น 2/2570' });
  const start = h('input', { type: 'date' });
  const end = h('input', { type: 'date' });
  const list = h('div');

  const load = async () => {
    const rows = await query(sb.from('leave_rounds').select('id, label, start_date, end_date').order('start_date', { ascending: false }));
    const today = todayISO();
    mount(list, h('ul', { class: 'plain-list' }, rows.map((r) => h('li', { class: 'row space' },
      h('span', {},
        h('strong', {}, `รอบ ${r.label}`), ` ${thDate(r.start_date, { short: true })} – ${thDate(r.end_date, { short: true })}`,
        r.start_date <= today && today <= r.end_date ? h('span', { class: 'badge approved' }, 'รอบปัจจุบัน') : null),
      h('button', {
        type: 'button', class: 'btn ghost small',
        onclick: async () => {
          if (!await confirmDialog('ลบรอบการลา', `ลบรอบ ${r.label}? ใบลาในช่วงนี้จะไม่ถูกนับในสถิติรอบใด และยื่นใบลาในช่วงนี้ไม่ได้`, { okText: 'ลบ', danger: true })) return;
          if (await run(() => query(sb.from('leave_rounds').delete().eq('id', r.id)), 'ลบแล้ว')) load();
        },
      }, 'ลบ')))));
  };

  // เสนอรอบถัดไปให้อัตโนมัติ: 1 ต.ค.–31 มี.ค. (รอบ 1) / 1 เม.ย.–30 ก.ย. (รอบ 2)
  const suggest = async () => {
    const rows = await query(sb.from('leave_rounds').select('end_date').order('end_date', { ascending: false }).limit(1));
    const lastEnd = rows[0]?.end_date;
    if (!lastEnd) return;
    const p = parseISO(lastEnd);
    const nextStartIso = new Date(Date.UTC(p.y, p.m - 1, p.d + 1)).toISOString().slice(0, 10);
    const n = parseISO(nextStartIso);
    if (n.m === 10) {
      start.value = nextStartIso;
      end.value = `${n.y + 1}-03-31`;
      label.value = `1/${n.y + 544}`;
    } else if (n.m === 4) {
      start.value = nextStartIso;
      end.value = `${n.y}-09-30`;
      label.value = `2/${n.y + 543}`;
    }
  };

  mount(box,
    h('h2', {}, 'รอบการลา'),
    h('p', { class: 'muted small' }, 'สถิติและโควตานับแยกตามรอบ ระบบเลือกรอบปัจจุบันจากวันที่วันนี้เอง — เพิ่มรอบถัดไปไว้ล่วงหน้าก่อนเริ่มรอบ'),
    list,
    h('div', { class: 'grid-3' }, field('ชื่อรอบ', label), field('เริ่ม', start), field('สิ้นสุด', end)),
    h('div', { class: 'row gap' },
      h('button', {
        type: 'button', class: 'btn',
        onclick: async () => {
          if (!label.value.trim() || !start.value || !end.value) return toast('กรุณากรอกให้ครบ', 'error');
          if (await run(() => query(sb.from('leave_rounds').insert({ label: label.value.trim(), start_date: start.value, end_date: end.value })), 'เพิ่มรอบแล้ว')) {
            label.value = '';
            start.value = '';
            end.value = '';
            load();
          }
        },
      }, 'เพิ่มรอบ'),
      h('button', { type: 'button', class: 'btn ghost', onclick: suggest }, 'เสนอรอบถัดไป')));
  await load();
  return box;
}

// ---------------- ประเภทการลา / โควตา ----------------
async function typesSection() {
  const box = h('section', { class: 'card stack' });
  const types = await query(sb.from('leave_types').select('*').order('sort'));
  const rows = types.map((t) => {
    const quota = h('input', { type: 'number', min: '0.5', step: '0.5', value: t.quota_days ?? '', placeholder: 'ไม่กำหนด' });
    const mode = h('select', {},
      [['none', 'ไม่ตรวจโควตา'], ['warn', 'เตือนเมื่อเกิน'], ['block', 'ห้ามยื่นเกิน']].map(([v, l]) =>
        h('option', { value: v, selected: t.quota_mode === v }, l)));
    const cert = h('input', { type: 'checkbox', checked: t.requires_cert });
    const calendar = h('input', { type: 'checkbox', checked: t.count_calendar_days });
    const save = h('button', {
      type: 'button', class: 'btn small',
      onclick: async () => {
        const q = quota.value === '' ? null : Number(quota.value);
        if (mode.value !== 'none' && !q) return toast('กรุณากรอกจำนวนวันโควตาก่อนเปิดการตรวจ', 'error');
        if (await run(() => query(sb.from('leave_types').update({
          quota_days: q, quota_mode: mode.value, requires_cert: cert.checked, count_calendar_days: calendar.checked,
        }).eq('code', t.code)), `บันทึก${t.label}แล้ว`)) clearCaches();
      },
    }, 'บันทึก');
    return h('div', { class: 'type-row' },
      h('h3', {}, t.label),
      h('div', { class: 'grid-2' }, field('โควตาต่อรอบ (วัน)', quota), field('การตรวจโควตา', mode)),
      h('label', { class: 'check' }, cert, ' ต้องแนบใบรับรองแพทย์'),
      h('label', { class: 'check' }, calendar, ' นับทุกวันรวมเสาร์-อาทิตย์และวันหยุด'),
      save);
  });
  mount(box,
    h('h2', {}, 'ประเภทการลาและโควตา'),
    h('p', { class: 'muted small' }, 'โควตานับรวมใบที่อนุญาตแล้วและที่รออนุมัติในรอบเดียวกัน — ใส่ตัวเลขตามระเบียบของโรงเรียน'),
    rows);
  return box;
}

// ---------------- ข้อความบนใบลา ----------------
const SETTING_FIELDS = [
  ['school_name', 'ชื่อโรงเรียน (เขียนที่)'],
  ['form_title', 'หัวกระดาษใบลา'],
  ['addressee', 'เรียน'],
  ['hr_title', 'ตำแหน่งผู้ตรวจสอบ (หัวหน้าฝ่าย)'],
  ['deputy_title', 'ตำแหน่งรองผู้อำนวยการ'],
  ['director_title', 'ตำแหน่งผู้อำนวยการ'],
  ['deputy_approve_text', 'ความเห็นรองฯ เมื่ออนุมัติ'],
  ['deputy_reject_text', 'ความเห็นรองฯ เมื่อไม่อนุมัติ'],
];

async function textSection() {
  const box = h('section', { class: 'card stack' });
  const rows = await query(sb.from('app_settings').select('key, value'));
  const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const inputs = Object.fromEntries(SETTING_FIELDS.map(([k]) => [k, h('input', { maxlength: '200', value: values[k] ?? '' })]));
  mount(box,
    h('h2', {}, 'ข้อความบนใบลา'),
    h('p', { class: 'alert info small' }, 'ห้ามใส่รหัสผ่านหรือ token ที่นี่ ผู้ใช้ทุกคนอ่านค่าเหล่านี้ได้'),
    SETTING_FIELDS.map(([k, l]) => field(l, inputs[k])),
    h('button', {
      type: 'button', class: 'btn',
      onclick: () => run(() => query(sb.from('app_settings').upsert(
        SETTING_FIELDS.map(([k]) => ({ key: k, value: inputs[k].value.trim() })))), 'บันทึกแล้ว'),
    }, 'บันทึกข้อความ'));
  return box;
}

// ---------------- บันทึกการแจ้งเตือน LINE ----------------
async function lineSection() {
  const box = h('section', { class: 'card stack' });
  const STATUS = { queued: 'รอส่ง', sending: 'กำลังส่ง', sent: 'ส่งแล้ว', failed: 'ล้มเหลว', skipped: 'ไม่ได้ส่ง' };
  const load = async () => {
    const rows = await query(sb.from('line_notifications').select('id, leave_id, event, payload, status, result, created_at, sent_at')
      .order('id', { ascending: false }).limit(30));
    mount(box,
      h('h2', {}, 'การแจ้งเตือน LINE ล่าสุด'),
      rows.length
        ? h('ul', { class: 'log' }, rows.map((n) => h('li', {},
          h('span', { class: `badge ${n.status === 'sent' ? 'approved' : n.status === 'failed' ? 'rejected' : 'pending'}` }, STATUS[n.status] ?? n.status),
          ' ', h('a', { href: `#/leave/${n.leave_id}` }, `ใบลา #${n.leave_id}`),
          ` ${n.payload?.name ?? ''} · ${thDateTime(n.created_at)}`,
          n.result && n.status !== 'sent' ? h('div', { class: 'small muted' }, n.result) : null,
          ['failed', 'skipped'].includes(n.status)
            ? h('button', {
              type: 'button', class: 'btn ghost small',
              onclick: async () => { if (await run(() => rpc('resend_line_notification', { p_id: n.id }), 'สั่งส่งซ้ำแล้ว')) setTimeout(load, 2500); },
            }, 'ส่งซ้ำ')
            : null)))
        : h('p', { class: 'empty' }, 'ยังไม่มีการแจ้งเตือน'));
  };
  await load();
  return box;
}

export default async function adminSettings(el) {
  mount(el, loading());
  const sections = await Promise.all([holidaysSection(), roundsSection(), typesSection(), textSection(), lineSection()]);
  mount(el, h('h1', {}, 'ตั้งค่าระบบ'), sections);
}
