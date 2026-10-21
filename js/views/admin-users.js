import { h, mount, loading, toast, errorText, dialog, confirmDialog, field, copyText } from '../ui.js';
import { sb } from '../supabase.js';
import { query, adminUsers, upload, fileUrl } from '../api.js';
import { ROLE_LABEL, refreshProfile } from '../auth.js';
import { thDateTime } from '../lib/thai-date.js';
import { preparePng } from '../lib/image.js';

const collator = new Intl.Collator('th');
const COLUMNS = 'id, user_code, full_name, position, role, is_admin, signature_path, must_change_password, active, created_at';

function roleSelect(value) {
  return h('select', {}, Object.entries(ROLE_LABEL).map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
}

async function showTempPassword(userCode, password) {
  await dialog({
    title: 'รหัสผ่านชั่วคราว',
    body: [
      h('p', {}, 'แจ้งข้อมูลนี้ให้ผู้ใช้โดยตรง (อย่าส่งในกลุ่ม) ระบบจะบังคับให้ตั้งรหัสผ่านใหม่เมื่อเข้าใช้ครั้งแรก'),
      h('dl', { class: 'facts' },
        h('dt', {}, 'ชื่อผู้ใช้'), h('dd', {}, h('code', { class: 'big-code' }, userCode)),
        h('dt', {}, 'รหัสผ่านชั่วคราว'), h('dd', {}, h('code', { class: 'big-code' }, password))),
      h('button', { type: 'button', class: 'btn', onclick: () => copyText(`ชื่อผู้ใช้: ${userCode}\nรหัสผ่านชั่วคราว: ${password}`) }, 'คัดลอก'),
      h('p', { class: 'alert warn small' }, 'ปิดหน้าต่างนี้แล้วจะดูรหัสนี้อีกไม่ได้ (รีเซ็ตใหม่ได้เสมอ)'),
    ],
    actions: [{ label: 'จดแล้ว ปิดหน้าต่าง', value: true, kind: 'primary' }],
  });
}

async function addUser(onDone) {
  const code = h('input', { autocapitalize: 'none', spellcheck: 'false', maxlength: '32', placeholder: 'เช่น t01 หรือ somchai' });
  const name = h('input', { maxlength: '120', placeholder: 'เช่น นางสาวสมใจ ใจดี' });
  const position = h('input', { maxlength: '120', placeholder: 'เช่น ครู / ครูผู้ช่วย / ครูชำนาญการ' });
  const role = roleSelect('teacher');
  const isAdmin = h('input', { type: 'checkbox' });
  const msg = h('div', { class: 'alert error', role: 'alert', hidden: true });
  let created = null;
  const ok = await dialog({
    title: 'เพิ่มผู้ใช้',
    body: [
      field('ชื่อผู้ใช้ (ใช้ล็อกอิน)', code, 'a-z ตัวเลข . _ - เท่านั้น เปลี่ยนภายหลังไม่ได้'),
      field('ชื่อ-สกุล (พร้อมคำนำหน้า)', name),
      field('ตำแหน่ง', position),
      field('บทบาท', role, 'หัวหน้าฝ่ายบุคลากร / รอง ผอ. / ผอ. มีได้ตำแหน่งละ 1 คน'),
      h('label', { class: 'check' }, isAdmin, ' เป็นแอดมิน (จัดการผู้ใช้และตั้งค่าระบบได้)'),
      msg,
    ],
    actions: [
      { label: 'ยกเลิก', value: false },
      {
        label: 'สร้างบัญชี', value: true, kind: 'primary',
        validate: async () => {
          msg.hidden = true;
          try {
            created = await adminUsers({
              action: 'create', user_code: code.value, full_name: name.value, position: position.value,
              role: role.value, is_admin: isAdmin.checked,
            });
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
  if (ok && created) {
    await showTempPassword(created.user_code, created.temp_password);
    onDone();
  }
}

async function editUser(u, me, onDone) {
  const name = h('input', { maxlength: '120', value: u.full_name });
  const position = h('input', { maxlength: '120', value: u.position });
  const role = roleSelect(u.role);
  const isAdmin = h('input', { type: 'checkbox', checked: u.is_admin, disabled: u.id === me.id });
  const active = h('input', { type: 'checkbox', checked: u.active, disabled: u.id === me.id });
  const msg = h('div', { class: 'alert error', role: 'alert', hidden: true });
  const ok = await dialog({
    title: `แก้ไข ${u.user_code}`,
    body: [
      field('ชื่อ-สกุล', name),
      field('ตำแหน่ง', position),
      field('บทบาท', role),
      h('label', { class: 'check' }, isAdmin, ' เป็นแอดมิน'),
      h('label', { class: 'check' }, active, ' เปิดใช้งานบัญชี (ปิด = ล็อกอินไม่ได้ ข้อมูลเดิมยังอยู่)'),
      u.id === me.id ? h('p', { class: 'muted small' }, 'ปิดสิทธิ์แอดมินหรือปิดบัญชีของตัวเองไม่ได้') : null,
      msg,
    ],
    actions: [
      { label: 'ยกเลิก', value: false },
      {
        label: 'บันทึก', value: true, kind: 'primary',
        validate: async () => {
          msg.hidden = true;
          const patch = { action: 'update', user_id: u.id };
          if (name.value.trim() !== u.full_name) patch.full_name = name.value;
          if (position.value.trim() !== u.position) patch.position = position.value;
          if (role.value !== u.role) patch.role = role.value;
          if (isAdmin.checked !== u.is_admin) patch.is_admin = isAdmin.checked;
          if (active.checked !== u.active) patch.active = active.checked;
          if (Object.keys(patch).length === 2) return true;
          try {
            await adminUsers(patch);
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
    toast('บันทึกแล้ว');
    if (u.id === me.id) await refreshProfile();
    onDone();
  }
}

async function resetPassword(u) {
  if (!await confirmDialog('รีเซ็ตรหัสผ่าน', `ออกรหัสผ่านชั่วคราวใหม่ให้ ${u.full_name}? รหัสเดิมจะใช้ไม่ได้ทันที`, { okText: 'รีเซ็ต' })) return;
  try {
    const res = await adminUsers({ action: 'reset_password', user_id: u.id });
    await showTempPassword(u.user_code, res.temp_password);
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

async function signatureDialog(u, onDone) {
  const current = h('div', { class: 'sig-current' });
  if (u.signature_path) {
    fileUrl('approver-signatures', u.signature_path).then((url) => {
      mount(current, url ? h('img', { src: url, alt: `ลายเซ็น ${u.full_name}` }) : h('small', {}, 'เปิดไฟล์ไม่ได้'));
    });
  } else mount(current, h('p', { class: 'muted' }, 'ยังไม่มีลายเซ็น'));
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  const preview = h('div', { class: 'sig-current' });
  const msg = h('div', { class: 'alert error', role: 'alert', hidden: true });
  let blob = null;
  file.addEventListener('change', async () => {
    blob = null;
    msg.hidden = true;
    mount(preview);
    const f = file.files?.[0];
    if (!f) return;
    try {
      blob = await preparePng(f);
      mount(preview, h('img', { src: URL.createObjectURL(blob), alt: 'ลายเซ็นใหม่' }));
    } catch (e) {
      msg.textContent = errorText(e);
      msg.hidden = false;
    }
  });
  const ok = await dialog({
    title: `ลายเซ็นตายตัว: ${u.full_name}`,
    body: [
      h('p', { class: 'muted small' }, 'ใช้ไฟล์ PNG พื้นโปร่งใสจะสวยที่สุด ระบบตัดขอบว่างและย่อขนาดให้อัตโนมัติ '
        + 'ลายเซ็นนี้จะปรากฏบนใบลาเฉพาะเมื่อผู้นี้กดอนุมัติ'),
      h('h3', {}, 'ปัจจุบัน'), current,
      field('เลือกไฟล์ลายเซ็นใหม่', file), preview, msg,
    ],
    actions: [
      { label: 'ปิด', value: false },
      {
        label: 'บันทึกลายเซ็นใหม่', value: true, kind: 'primary',
        validate: async () => {
          if (!blob) {
            msg.textContent = 'กรุณาเลือกไฟล์ลายเซ็น';
            msg.hidden = false;
            return false;
          }
          try {
            const path = await upload('approver-signatures', u.id, blob, 'png');
            await adminUsers({ action: 'update', user_id: u.id, signature_path: path });
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
    toast('บันทึกลายเซ็นแล้ว');
    onDone();
  }
}

export default async function adminUsersView(el, _params, { profile }) {
  const load = async () => {
    mount(el, loading());
    const [users, audit] = await Promise.all([
      query(sb.from('profiles').select(COLUMNS)),
      query(sb.from('admin_audit').select('id, actor, action, target, detail, created_at')
        .order('created_at', { ascending: false }).limit(30)),
    ]);
    users.sort((a, b) => (b.active - a.active) || collator.compare(a.full_name, b.full_name));
    const nameOf = Object.fromEntries(users.map((u) => [u.id, u.full_name]));
    const missing = ['hr', 'deputy', 'director'].filter((r) => !users.some((u) => u.active && u.role === r));
    const noSig = users.filter((u) => u.active && u.role !== 'teacher' && !u.signature_path);

    const rows = users.map((u) => h('tr', { class: u.active ? null : 'inactive' },
      h('td', { 'data-label': 'ชื่อ' }, h('strong', {}, u.full_name), h('br'), h('small', { class: 'muted' }, u.position)),
      h('td', { 'data-label': 'ชื่อผู้ใช้' }, h('code', {}, u.user_code)),
      h('td', { 'data-label': 'บทบาท' },
        h('span', { class: `badge role-${u.role}` }, ROLE_LABEL[u.role]),
        u.is_admin ? h('span', { class: 'badge admin' }, 'แอดมิน') : null),
      h('td', { 'data-label': 'สถานะ' },
        !u.active ? h('span', { class: 'badge cancelled' }, 'ปิดบัญชี')
          : u.must_change_password ? h('span', { class: 'badge pending' }, 'ยังไม่เปลี่ยนรหัส')
            : h('span', { class: 'badge approved' }, 'ใช้งานได้'),
        u.role !== 'teacher' && u.active
          ? h('span', { class: `badge ${u.signature_path ? 'approved' : 'rejected'}` }, u.signature_path ? 'มีลายเซ็น' : 'ไม่มีลายเซ็น')
          : null),
      h('td', { class: 'actions', 'data-label': '' },
        h('button', { type: 'button', class: 'btn small', onclick: () => editUser(u, profile, load) }, 'แก้ไข'),
        u.active ? h('button', { type: 'button', class: 'btn small', onclick: () => resetPassword(u) }, 'รีเซ็ตรหัส') : null,
        u.role !== 'teacher'
          ? h('button', { type: 'button', class: 'btn small', onclick: () => signatureDialog(u, load) }, 'ลายเซ็น')
          : null)));

    const ACTION = { create: 'สร้างบัญชี', reset_password: 'รีเซ็ตรหัสผ่าน', update: 'แก้ไขข้อมูล' };
    mount(el,
      h('div', { class: 'row space wrap' },
        h('h1', {}, 'จัดการผู้ใช้'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => addUser(load) }, '+ เพิ่มผู้ใช้')),
      missing.length
        ? h('p', { class: 'alert warn' }, `ยังไม่มีผู้ใช้ในตำแหน่ง: ${missing.map((r) => ROLE_LABEL[r]).join(', ')} — ใบลาจะค้างที่ขั้นนั้นจนกว่าจะกำหนดผู้ใช้`)
        : null,
      noSig.length
        ? h('p', { class: 'alert warn' }, `ผู้อนุมัติที่ยังไม่มีลายเซ็น (อนุมัติไม่ได้): ${noSig.map((u) => u.full_name).join(', ')}`)
        : null,
      h('table', { class: 'table responsive' },
        h('thead', {}, h('tr', {}, ['ชื่อ', 'ชื่อผู้ใช้', 'บทบาท', 'สถานะ', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows)),
      h('section', { class: 'section' },
        h('h2', {}, 'ประวัติการจัดการบัญชีล่าสุด'),
        audit.length
          ? h('ul', { class: 'log' }, audit.map((a) => h('li', {},
            h('span', { class: 'muted small' }, thDateTime(a.created_at)), ' ',
            `${nameOf[a.actor] ?? 'ไม่ทราบ'} ${ACTION[a.action] ?? a.action} ${nameOf[a.target] ?? ''}`,
            a.action === 'update' ? h('small', { class: 'muted' }, ` (${Object.keys(a.detail ?? {}).join(', ')})`) : null)))
          : h('p', { class: 'empty' }, 'ยังไม่มีประวัติ')));
  };
  await load();
}
