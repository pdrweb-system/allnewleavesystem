import { h, mount, loading, toast, errorText, confirmDialog } from '../ui.js';
import { sb } from '../supabase.js';
import { auth } from '../auth.js';
import { buildLoginCard, normalize, loadPublicImage, LOGIN_DEFAULTS, ACCENT_PRESETS, BACKGROUNDS } from '../lib/login-card.js';

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
const SAVE_KEYS = [...TEXT_FIELDS.map(([k]) => k), 'show_remember', 'accent', 'background', 'bg_image', 'bg_dim'];
const BUCKET = 'login-assets';

// ย่อรูปฝั่งเบราว์เซอร์ก่อนอัปโหลด (ด้านยาวสุด 1920px, JPEG) ให้ไม่เกินขีดจำกัด 2 MB ของ bucket
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('ใช้ได้เฉพาะไฟล์ JPG, PNG หรือ WebP');
  if (file.size > 25 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกินไป (เกิน 25 MB)');
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('เปิดไฟล์รูปนี้ไม่ได้');
  }
  const scale = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  for (const q of [0.85, 0.72, 0.6, 0.45]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
    if (blob && blob.size <= 2 * 1024 * 1024) return blob;
  }
  throw new Error('ย่อรูปให้เล็กกว่า 2 MB ไม่ได้ ลองใช้รูปอื่น');
}

export default async function adminLogin(el) {
  mount(el, loading());
  const { data: row, error } = await sb.from('login_page').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  let saved = normalize(row);
  let draft = { ...saved };
  let draftImageUrl = await loadPublicImage(saved.bg_image);
  const uploaded = []; // ไฟล์ที่อัปโหลดในหน้านี้ ตอนบันทึกจะลบไฟล์ที่ไม่ได้ใช้ทิ้ง

  const previewBox = h('div', { class: 'lp-preview-card' });
  const status = h('span', { class: 'muted small' });
  const saveBtn = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'บันทึก');
  const dirty = () => SAVE_KEYS.some((k) => draft[k] !== saved[k]);

  const refresh = () => {
    mount(previewBox, buildLoginCard(draft, { preview: true, imageUrl: draftImageUrl }).root);
    imageBox.hidden = draft.background !== 'image';
    thumb.style.backgroundImage = draftImageUrl ? `url("${draftImageUrl}")` : '';
    thumb.textContent = draftImageUrl ? '' : 'ยังไม่มีรูป';
    removeImg.hidden = !draft.bg_image;
    dimValue.textContent = `${draft.bg_dim}%`;
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
  const syncBg = () => bgButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(BACKGROUNDS[i][0] === draft.background)));
  const bgButtons = BACKGROUNDS.map(([k, label]) => h('button', {
    type: 'button', class: 'btn', 'aria-pressed': String(draft.background === k),
    onclick: () => { set('background', k); syncBg(); },
  }, label));

  // ---- รูปพื้นหลัง ----
  const thumb = h('div', { class: 'lp-thumb', role: 'img', 'aria-label': 'ตัวอย่างรูปพื้นหลัง' });
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
  const uploadBtn = h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, 'อัปโหลดรูปพื้นหลัง');
  const removeImg = h('button', {
    type: 'button', class: 'btn', hidden: true,
    onclick: () => {
      draft.bg_image = null;
      draftImageUrl = null;
      draft.background = 'soft';
      syncBg();
      refresh();
    },
  }, 'ลบรูป');
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'กำลังอัปโหลด…';
    try {
      const blob = await shrinkImage(file);
      const name = `${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await sb.storage.from(BUCKET).upload(name, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
      if (upErr) throw upErr;
      uploaded.push(name);
      draft.bg_image = name;
      draftImageUrl = URL.createObjectURL(blob);
      refresh();
      toast('อัปโหลดแล้ว — กด “บันทึก” เพื่อใช้กับหน้าล็อกอินจริง');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'อัปโหลดรูปพื้นหลัง';
    }
  };
  const dimValue = h('strong', {}, `${draft.bg_dim}%`);
  const dim = h('input', { type: 'range', min: '0', max: '80', step: '5', value: String(draft.bg_dim), 'aria-label': 'ความเข้มของฝ้าดำทับรูป', oninput: () => set('bg_dim', Number(dim.value)) });
  const imageBox = h('div', { class: 'lp-image', hidden: draft.background !== 'image' },
    thumb,
    h('div', { class: 'lp-seg' }, uploadBtn, removeImg, fileInput),
    h('div', { class: 'field' }, h('label', {}, 'ความเข้มของฝ้าดำทับรูป ', dimValue), dim,
      h('small', { class: 'hint' }, 'เพิ่มความเข้มถ้ารูปสว่างจนมองข้อความท้ายหน้าไม่ชัด')),
    h('small', { class: 'hint' }, 'ใช้ไฟล์ JPG/PNG/WebP รูปแนวนอนจะสวยสุด ระบบย่อรูปให้อัตโนมัติ — รูปนี้ทุกคนเห็นได้โดยไม่ต้องล็อกอิน อย่าใช้รูปที่มีใบหน้านักเรียนหรือข้อมูลส่วนบุคคล'));

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
      const keep = patch.background === 'image' ? patch.bg_image : null;
      const stale = [...new Set([...uploaded, saved.bg_image])].filter((f) => f && f !== keep);
      if (stale.length) await sb.storage.from(BUCKET).remove(stale).catch(() => {}); // ลบไฟล์ที่ไม่ได้ใช้ (ไม่สำเร็จก็ไม่เป็นไร)
      uploaded.length = 0;
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
      draftImageUrl = null;
      dim.value = String(draft.bg_dim);
      syncBg();
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
          h('div', { class: 'field' }, h('label', {}, 'พื้นหลังของหน้า'), h('div', { class: 'lp-seg' }, bgButtons)),
          imageBox),
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
