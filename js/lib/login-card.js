// การ์ดหน้าล็อกอิน: ใช้ร่วมกันระหว่างหน้าล็อกอินจริง (js/views/login.js) และตัวอย่างสดในหน้าแอดมิน (admin-login.js)
// ค่าทั้งหมดแสดงด้วย textContent เท่านั้น สีส่งผ่านตัวแปร CSS (ผ่าน CSSOM จึงไม่ขัดกับ CSP)
import { h } from '../ui.js';
import { sb } from '../supabase.js';
import { SITE_NAME, SCHOOL_NAME } from '../config.js';

export const LOGIN_DEFAULTS = {
  title: SITE_NAME,
  subtitle: SCHOOL_NAME,
  logo_text: 'ลา',
  welcome_text: '',
  code_label: 'รหัสเข้าใช้',
  code_placeholder: '',
  button_label: 'เข้าสู่ระบบ',
  show_remember: true,
  remember_label: 'จดจำการเข้าสู่ระบบในเครื่องนี้',
  help_text: 'ลืมรหัส? ติดต่อแอดมิน (ฝ่ายบริหารงานบุคคล) เพื่อตั้งรหัสใหม่',
  footer_text: '',
  accent: '#0f5e57',
  background: 'soft',
  bg_image: null,
  bg_dim: 35,
};

export const ACCENT_PRESETS = [
  ['เขียวเข้ม', '#0f5e57'], ['น้ำเงิน', '#1a5fb4'], ['ม่วง', '#7b3fa0'],
  ['แดงเลือดหมู', '#9b2335'], ['ส้มเข้ม', '#b45309'], ['เทาเข้ม', '#37474f'],
];
export const BACKGROUNDS = [['soft', 'สีอ่อน'], ['gradient', 'ไล่สี'], ['plain', 'เรียบ'], ['image', 'รูปภาพ']];

const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
const mix = (hex, other, t) => toHex(rgb(hex).map((x, i) => x * (1 - t) + other[i] * t));
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map((x) => {
    const v = x / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function normalize(cfg) {
  const c = { ...LOGIN_DEFAULTS, ...Object.fromEntries(Object.entries(cfg ?? {}).filter(([, v]) => v !== null && v !== undefined)) };
  if (!isHex(c.accent)) c.accent = LOGIN_DEFAULTS.accent;
  if (!BACKGROUNDS.some(([k]) => k === c.background)) c.background = LOGIN_DEFAULTS.background;
  c.bg_dim = Math.max(0, Math.min(80, Number(c.bg_dim) || 0));
  if (typeof c.bg_image !== 'string' || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(c.bg_image)) c.bg_image = null;
  return c;
}

// ตั้งตัวแปรสีบนกรอบหน้าล็อกอิน (ตัวอักษรบนปุ่มเปลี่ยนเป็นสีเข้มอัตโนมัติถ้าสีหลักสว่างมาก)
export function applyTheme(el, cfg) {
  const { accent } = normalize(cfg);
  el.style.setProperty('--primary', accent);
  el.style.setProperty('--primary-hover', mix(accent, [0, 0, 0], 0.2));
  el.style.setProperty('--primary-soft', mix(accent, [255, 255, 255], 0.88));
  el.style.setProperty('--on-primary', luminance(accent) > 0.45 ? '#1c2a29' : '#ffffff');
}

// รูปพื้นหลังอยู่ใน bucket สาธารณะ login-assets: โหลดด้วย fetch แล้วแสดงเป็น blob: URL
// (CSP ของระบบอนุญาตเฉพาะ img-src 'self' blob: จึงไม่ต้องเปิดโดเมนรูปเพิ่ม) ถ้าโหลดไม่ได้คืน null
const imageCache = new Map();
export function loadPublicImage(path) {
  if (!path) return Promise.resolve(null);
  if (!imageCache.has(path)) {
    const { data } = sb.storage.from('login-assets').getPublicUrl(path);
    imageCache.set(path, fetch(data.publicUrl)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => (blob && /^image\//.test(blob.type) ? URL.createObjectURL(blob) : null))
      .catch(() => null));
  }
  return imageCache.get(path);
}

// ใส่รูปพื้นหลัง (blob: URL) ให้กรอบหน้าล็อกอิน ส่ง null = กลับไปใช้พื้นสีอ่อน
function paintImage(root, c, url) {
  const on = c.background === 'image' && !!url;
  root.classList.toggle('bg-image', on);
  root.classList.toggle('bg-soft', c.background === 'image' && !on);
  if (on) root.style.setProperty('--bg-image', `url("${url}")`);
  else root.style.removeProperty('--bg-image');
  root.style.setProperty('--dim', String(c.bg_dim / 100));
}

// preview = true: ตัวอย่างในหน้าแอดมิน (ช่องกรอกและปุ่มกดไม่ได้)
export function buildLoginCard(cfg, { preview = false, onSubmit = null, remembered = false, imageUrl = null } = {}) {
  const c = normalize(cfg);
  const code = h('input', {
    name: 'password', id: 'login-code', type: 'password', autocomplete: 'current-password', autocapitalize: 'none',
    spellcheck: 'false', maxlength: '72', required: !preview, disabled: preview, placeholder: c.code_placeholder,
  });
  const remember = h('input', { type: 'checkbox', checked: remembered, disabled: preview });
  const message = h('div', { class: 'alert error', role: 'alert', hidden: true });
  const submit = h('button', { type: preview ? 'button' : 'submit', class: 'btn primary block', disabled: preview }, c.button_label);

  const form = h('form', { class: 'stack', onsubmit: onSubmit },
    h('div', { class: 'field' }, h('label', { for: 'login-code' }, c.code_label), code),
    c.show_remember ? h('label', { class: 'check' }, remember, ` ${c.remember_label}`) : null,
    c.show_remember ? h('small', { class: 'hint' }, 'ถ้าใช้เครื่องร่วมกับผู้อื่น อย่าติ๊กช่องนี้') : null,
    message,
    submit);

  const root = h('div', { class: `login-stage bg-${c.background === 'image' ? 'soft' : c.background}` },
    h('section', { class: 'card narrow login' },
      h('div', { class: 'login-head' },
        c.logo_text ? h('div', { class: 'logo', 'aria-hidden': 'true' }, c.logo_text) : null,
        h('h1', {}, c.title),
        c.subtitle ? h('p', { class: 'muted' }, c.subtitle) : null,
        c.welcome_text ? h('p', { class: 'login-welcome' }, c.welcome_text) : null),
      form,
      c.help_text ? h('p', { class: 'muted small center' }, c.help_text) : null),
    c.footer_text ? h('p', { class: 'login-footer' }, c.footer_text) : null);
  applyTheme(root, c);
  paintImage(root, c, imageUrl);
  return { root, code, remember, message, submit, setImage: (url) => paintImage(root, c, url) };
}
