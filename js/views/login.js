import { h, mount, errorText } from '../ui.js';
import { signIn } from '../auth.js';
import { getRemember } from '../supabase.js';
import { navigate } from '../router.js';
import { SITE_NAME, SCHOOL_NAME } from '../config.js';

export default function login(el) {
  const code = h('input', {
    name: 'password', type: 'password', autocomplete: 'current-password', inputmode: 'numeric',
    pattern: '[0-9]{6,8}', maxlength: '8', required: true,
  });
  const remember = h('input', { type: 'checkbox', checked: getRemember() });
  const message = h('div', { class: 'alert error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn primary block' }, 'เข้าสู่ระบบ');

  const form = h('form', {
    class: 'stack',
    onsubmit: async (e) => {
      e.preventDefault();
      message.hidden = true;
      submit.disabled = true;
      submit.textContent = 'กำลังเข้าสู่ระบบ…';
      try {
        await signIn(code.value, remember.checked);
        const next = sessionStorage.getItem('leave.next');
        sessionStorage.removeItem('leave.next');
        navigate(next && next !== '/login' ? next : '/', { replace: true });
      } catch (err) {
        message.textContent = errorText(err);
        message.hidden = false;
        code.value = '';
        code.focus();
      } finally {
        submit.disabled = false;
        submit.textContent = 'เข้าสู่ระบบ';
      }
    },
  },
  h('div', { class: 'field' }, h('label', { for: 'login-code' }, 'รหัสเข้าใช้ (ตัวเลข 6 หลัก)'), Object.assign(code, { id: 'login-code' })),
  h('label', { class: 'check' }, remember, ' จดจำการเข้าสู่ระบบในเครื่องนี้'),
  h('small', { class: 'hint' }, 'ถ้าใช้เครื่องร่วมกับผู้อื่น อย่าติ๊กช่องนี้'),
  message,
  submit);

  mount(el, h('section', { class: 'card narrow login' },
    h('div', { class: 'login-head' },
      h('div', { class: 'logo', 'aria-hidden': 'true' }, 'ลา'),
      h('h1', {}, SITE_NAME),
      h('p', { class: 'muted' }, SCHOOL_NAME)),
    form,
    h('p', { class: 'muted small center' }, 'ลืมรหัส? ติดต่อแอดมิน (ฝ่ายบริหารงานบุคคล) เพื่อตั้งรหัสใหม่')));
  code.focus();
}
