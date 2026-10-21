import { h, mount, errorText, toast } from '../ui.js';
import { auth, changePassword } from '../auth.js';
import { navigate } from '../router.js';

function problem(pw, confirm, userCode) {
  if (pw.length < 8) return 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร';
  if (pw.length > 72) return 'รหัสผ่านต้องยาวไม่เกิน 72 ตัวอักษร';
  if (pw.toLowerCase() === userCode.toLowerCase()) return 'ห้ามใช้ชื่อผู้ใช้เป็นรหัสผ่าน';
  if (/^(.)\1+$/.test(pw)) return 'รหัสผ่านคาดเดาง่ายเกินไป';
  if (!/[a-zA-Z฀-๿]/.test(pw) || !/\d/.test(pw)) return 'รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข';
  if (pw !== confirm) return 'ยืนยันรหัสผ่านไม่ตรงกัน';
  return null;
}

export default function changePasswordView(el) {
  const p = auth.profile;
  const pw = h('input', { id: 'new-password', type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
  const confirm = h('input', { id: 'confirm-password', type: 'password', autocomplete: 'new-password', required: true });
  const message = h('div', { class: 'alert error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn primary block' }, 'บันทึกรหัสผ่านใหม่');

  const form = h('form', {
    class: 'stack',
    onsubmit: async (e) => {
      e.preventDefault();
      const err = problem(pw.value, confirm.value, p.user_code);
      message.hidden = !err;
      message.textContent = err ?? '';
      if (err) return;
      submit.disabled = true;
      try {
        const updated = await changePassword(pw.value);
        if (updated?.must_change_password) throw new Error('บันทึกรหัสผ่านแล้ว แต่ระบบยังไม่ปลดล็อก กรุณาลองใหม่อีกครั้ง');
        toast('เปลี่ยนรหัสผ่านเรียบร้อย');
        navigate('/', { replace: true });
      } catch (e2) {
        message.textContent = errorText(e2);
        message.hidden = false;
      } finally {
        submit.disabled = false;
      }
    },
  },
  h('div', { class: 'field' }, h('label', { for: 'new-password' }, 'รหัสผ่านใหม่'), pw,
    h('small', { class: 'hint' }, 'อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข ห้ามใช้วันเกิดหรือชื่อผู้ใช้')),
  h('div', { class: 'field' }, h('label', { for: 'confirm-password' }, 'ยืนยันรหัสผ่านใหม่'), confirm),
  message,
  submit);

  mount(el, h('section', { class: 'card narrow' },
    h('h1', {}, p.must_change_password ? 'ตั้งรหัสผ่านใหม่ก่อนเข้าใช้งาน' : 'เปลี่ยนรหัสผ่าน'),
    p.must_change_password
      ? h('p', { class: 'muted' }, 'รหัสผ่านที่ได้รับจากแอดมินเป็นรหัสชั่วคราว กรุณาตั้งรหัสผ่านของคุณเอง')
      : null,
    h('p', { class: 'muted small' }, `ชื่อผู้ใช้: ${p.user_code}`),
    form));
  pw.focus();
}
