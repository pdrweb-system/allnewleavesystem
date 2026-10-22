// สร้าง DOM ด้วย textContent เท่านั้น — ห้ามใช้ innerHTML กับข้อมูลใด ๆ ในโปรเจกต์นี้

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction']);
const SAFE_URL = /^(#|https:\/\/|blob:)/i;

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'value' || key === 'checked' || key === 'selected') el[key] = value;
    else if (URL_ATTRS.has(key)) {
      const v = String(value);
      if (!SAFE_URL.test(v)) throw new Error(`unsafe url in ${key}`);
      el.setAttribute(key, v);
    } else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function mount(container, ...nodes) {
  container.replaceChildren();
  append(container, nodes);
}

export function fmtDays(n) {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// ข้อความ error ภาษาไทยจาก Supabase/เครือข่าย (RPC ส่งข้อความไทยมาเอง)
export function errorText(err) {
  const msg = String(err?.message ?? err ?? '');
  if (!msg) return 'เกิดข้อผิดพลาด กรุณาลองใหม่';
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
  }
  if (/jwt expired|invalid jwt|refresh token/i.test(msg)) return 'หมดเวลาการเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่';
  if (/row-level security|permission denied/i.test(msg)) return 'คุณไม่มีสิทธิ์ทำรายการนี้';
  if (/[฀-๿]/.test(msg)) return msg; // ข้อความไทยจากเซิร์ฟเวอร์
  return `เกิดข้อผิดพลาด: ${msg}`;
}

let toastTimer;
export function toast(message, kind = 'ok') {
  const box = document.getElementById('toast');
  if (!box) return;
  box.className = `toast show ${kind}`;
  box.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.className = 'toast';
  }, kind === 'error' ? 6000 : 3500);
}

export function errorBox(err) {
  return h('div', { class: 'alert error', role: 'alert' }, errorText(err));
}

export function loading(text = 'กำลังโหลด…') {
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
}

// กล่องโต้ตอบแบบ <dialog> คืนค่าเป็น Promise ของค่าที่ปุ่มส่งกลับ (หรือ null ถ้าปิด)
export function dialog({ title, body = [], actions = [{ label: 'ปิด', value: null }], onOpen }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog', 'aria-label': title });
    const footer = h('div', { class: 'dialog-actions' });
    const close = (value) => {
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    for (const a of actions) {
      footer.append(h('button', {
        type: 'button',
        class: `btn ${a.kind ?? (a.value ? 'primary' : 'ghost')}`,
        onclick: async () => {
          if (a.validate && !(await a.validate())) return;
          close(typeof a.value === 'function' ? a.value() : a.value);
        },
      }, a.label));
    }
    dlg.append(h('h2', { class: 'dialog-title' }, title), h('div', { class: 'dialog-body' }, body), footer);
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    document.body.append(dlg);
    dlg.showModal();
    onOpen?.(dlg);
  });
}

export function confirmDialog(title, message, { okText = 'ยืนยัน', danger = false } = {}) {
  return dialog({
    title,
    body: [h('p', {}, message)],
    actions: [
      { label: 'ยกเลิก', value: false },
      { label: okText, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  });
}

export function field(label, control, hint) {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    control,
    hint ? h('small', { class: 'hint' }, hint) : null);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('คัดลอกแล้ว');
  } catch {
    toast('คัดลอกไม่ได้ กรุณาจดด้วยตนเอง', 'error');
  }
}

// ป้ายสถานะใบลา
export const STATUS_LABEL = {
  pending_hr: 'รอหัวหน้าฝ่ายบุคลากร',
  pending_deputy: 'รอรองผู้อำนวยการ',
  pending_director: 'รอผู้อำนวยการ',
  approved: 'อนุญาตแล้ว',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิกแล้ว',
};

export function statusBadge(status) {
  const kind = status?.startsWith('pending') ? 'pending' : status;
  return h('span', { class: `badge ${kind}` }, STATUS_LABEL[status] ?? status);
}
