import { h, mount, loading, toast, errorText, confirmDialog } from '../ui.js';
import { sb } from '../supabase.js';
import { auth } from '../auth.js';
import { buildLoginCard, normalize, LOGIN_DEFAULTS, ACCENT_PRESETS, BACKGROUNDS } from '../lib/login-card.js';

// ช่องข้อความ: [คีย์, ป้ายกำกับ, ความยาวสูงสุด, จำเป็น, คำอธิบาย]
const TEXT_FIELDS = [
  ['title', 'ชื่อระบบ (หัวข้อใหญ่)', 60, true],
  ['subtitle', 'ชื่อโรงเรียน / บรรทัดใต้ชื่อระบบ', 100, false],
  ['logo_text', 'ตัวอักษรในโลโก้ (1–4 ตัว เว้นว่าง = ไม่แสดงโลโก้)', 4, false],
  ['welcome_text', 'ข้อความต้อนรับ (ไม่บังคับ)', 200, false],
  ['code_label', 'ป้ายช่องกรอกรหัส', 40, true],
  ['code_placeholder', 'ข้อความจางในช่องรหัส (ไม่บังคับ)', 60, false],
  ['button_label', 'ข้อความบนปุ่มเข้าสู่ระบบ', 30, true],
  ['remember_label', 'ข้อความช่อง "จดจำการเข้าสู่ระบบ"', 80, true],
  ['help_text', 'ข้อความช่วยเหลือใต้ปุ่ม (เช่น ลืมรหัสติดต่อใคร)', 200, false],
  ['footer_text', 'ข้อความท้ายหน้า (ไม่บังคับ)', 200, false],
];
const SAVE_KEYS = [...TEXT_FIELDS.map(([k]) => k), 'show_remember', 'accent', 'background'];

export default async function adminLogin(el) {
  mount(el, loading());
  const { data: row, error } = await sb.from('login_page').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  let saved = normalize(row);
  let draft = { ...saved };

  const previewBox = h('div', { class: 'lp-preview-card' });
  const status = h('span', { class: 'muted small' });
  const saveBtn = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'บันทึก');
  const dirty = () => SAVE_KEYS.some((k) => draft[k] !== saved[k]);

  const refresh = () => {
    mount(previewBox, buildLoginCard(draft, { preview: true }).root);
    saveBtn.disabled = !dirty();
    status.textContent = dirty() ? 'มีการแก้ไขที่ยังไม่ได้บันทึก' : 'ตรงกับที่บันทึกไว้';
  };
  const set = (k, v) => { draft[k] = v; refresh(); };

  // ---- ช่องข้อความ ----
  const textInputs = {};
  const textRows = TEXT_FIELDS.map(([k, label, max, required]) => {
    const input = h('input', { maxlength: String(max), value: draft[k], required, oninput: () => { set(k, input.value); count.textContent = `${input.value.length}/${max}`; } });
    const count = h('small', { class: 'muted lp-count' }, `${draft[k].length}/${max}`);
    textInputs[k] = { input, count, max };
    const id = `lp-${k}`;
    input.id = id;
    return h('div', { class: 'field' }, h('label', { for: id }, label), input, count);
  });

  // ---- สีหลัก ----
  const customColor = h('input', { type: 'color', value: draft.accent, 'aria-label': 'เลือกสีเอง', oninput: () => { set('accent', customColor.value.toLowerCase()); syncSwatches(); } });
  const swatches = ACCENT_PRESETS.map(([name, hex]) => {
    const b = h('button', {
      type: 'button', class: 'lp-swatch', title: name, 'aria-label': name,
      onclick: () => { set('accent', hex); customColor.value = hex; syncSwatches(); },
    });
    b.style.background = hex;
    return { b, hex };
  });
  const syncSwatches = () => swatches.forEach(({ b, hex }) => b.setAttribute('aria-pressed', String(hex === draft.accent)));
  syncSwatches();

  // ---- พื้นหลัง ----
  const bgButtons = BACKGROUNDS.map(([k, label]) => h('button', {
    type: 'button', class: 'btn', 'aria-pressed': String(draft.background === k),
    onclick: () => { set('background', k); bgButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(BACKGROUNDS[i][0] === k))); },
  }, label));

  const showRemember = h('input', { type: 'checkbox', checked: draft.show_remember, onchange: () => set('show_remember', showRemember.checked) });

  saveBtn.onclick = async () => {
    for (const [k, label, , required] of TEXT_FIELDS) {
      if (required && !draft[k].trim()) return toast(`กรุณากรอก “${label}”`, 'error');
    }
    saveBtn.disabled = true;
    try {
      const patch = Object.fromEntries(SAVE_KEYS.map((k) => [k, typeof draft[k] === 'string' ? draft[k].trim() : draft[k]]));
      patch.updated_by = auth.user?.id ?? null;
      const { data, error: err } = await sb.from('login_page').update(patch).eq('id', 1).select('id');
      if (err) throw err;
      if (!data?.length) throw new Error('บันทึกไม่ได้ (ไม่มีสิทธิ์แอดมิน)');
      saved = normalize({ ...draft, ...patch });
      draft = { ...saved };
      toast('บันทึกแล้ว — หน้าล็อกอินใช้ค่าใหม่ทันที');
    } catch (e) {
      toast(errorText(e), 'error');
    }
    refresh();
  };

  const reset = h('button', {
    type: 'button', class: 'btn',
    onclick: async () => {
      if (!await confirmDialog('คืนค่าตั้งต้น', 'คืนข้อความและสีทั้งหมดเป็นค่าตั้งต้นของระบบ (ยังไม่บันทึกจนกว่าจะกด “บันทึก”)', { okText: 'คืนค่าตั้งต้น' })) return;
      draft = { ...LOGIN_DEFAULTS };
      for (const [k, { input, count, max }] of Object.entries(textInputs)) { input.value = draft[k]; count.textContent = `${draft[k].length}/${max}`; }
      customColor.value = draft.accent;
      showRemember.checked = draft.show_remember;
      bgButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(BACKGROUNDS[i][0] === draft.background)));
      syncSwatches();
      refresh();
    },
  }, 'คืนค่าตั้งต้น');

  mount(el,
    h('h1', {}, 'ปรับแต่งหน้าล็อกอิน'),
    h('p', { class: 'muted' }, 'แก้ไขแล้วดูตัวอย่างทางขวา (หรือด้านล่างบนมือถือ) พอใจแล้วกด “บันทึก” ผู้ใช้จะเห็นทันทีเมื่อเปิดหน้าเข้าสู่ระบบ'),
    h('p', { class: 'alert info small' }, 'ข้อความในหน้านี้ทุกคนเห็นได้โดยไม่ต้องล็อกอิน — ห้ามใส่รหัสผ่าน ข้อมูลส่วนบุคคล หรือข้อมูลภายในโรงเรียน'),
    h('div', { class: 'lp-layout' },
      h('div', { class: 'stack' },
        h('section', { class: 'card stack' }, h('h2', {}, '1. ข้อความ'), textRows),
        h('section', { class: 'card stack' },
          h('h2', {}, '2. สีและพื้นหลัง'),
          h('div', { class: 'field' }, h('label', {}, 'สีหลัก (ปุ่ม โลโก้ ชื่อระบบ)'),
            h('div', { class: 'lp-swatches' }, swatches.map((s) => s.b), customColor),
            h('small', { class: 'hint' }, 'เลือกสีสำเร็จรูป หรือกดช่องสีเพื่อเลือกสีเอง ระบบปรับสีตัวอักษรบนปุ่มให้อ่านออกอัตโนมัติ')),
          h('div', { class: 'field' }, h('label', {}, 'พื้นหลังของหน้า'), h('div', { class: 'lp-seg' }, bgButtons))),
        h('section', { class: 'card stack' },
          h('h2', {}, '3. ตัวเลือก'),
          h('label', { class: 'check' }, showRemember, ' แสดงช่อง “จดจำการเข้าสู่ระบบในเครื่องนี้”'))),
      h('div', { class: 'lp-preview' },
        h('div', { class: 'lp-preview-bar' }, h('h2', {}, 'ตัวอย่างสด'), status),
        previewBox)),
    h('div', { class: 'lp-savebar' }, saveBtn, reset,
      h('a', { class: 'btn ghost', href: '#/login', target: '_blank', rel: 'noopener noreferrer', onclick: (e) => { e.preventDefault(); window.open(`${location.pathname}#/login`, '_blank', 'noopener'); } }, 'เปิดหน้าล็อกอินจริง')));
  refresh();
}
