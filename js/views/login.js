import { mount, errorText } from '../ui.js';
import { signIn } from '../auth.js';
import { navigate } from '../router.js';
import { sb, getRemember } from '../supabase.js';
import { buildLoginCard } from '../lib/login-card.js';

export default async function login(el) {
  // ตั้งค่าหน้าล็อกอินจากแอดมิน (anon อ่านได้) ถ้าอ่านไม่ได้ใช้ค่าตั้งต้นของระบบ
  let cfg = null;
  try {
    const { data } = await sb.from('login_page').select('*').eq('id', 1).maybeSingle();
    cfg = data;
  } catch {
    cfg = null;
  }
  const notice = sessionStorage.getItem('leave.notice');
  sessionStorage.removeItem('leave.notice');

  const card = buildLoginCard(cfg, {
    remembered: getRemember(),
    onSubmit: async (e) => {
      e.preventDefault();
      const { code, remember, message, submit } = card;
      const label = submit.textContent;
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
        submit.textContent = label;
      }
    },
  });
  if (notice) {
    card.message.textContent = notice;
    card.message.hidden = false;
  }
  mount(el, card.root);
  card.code.focus();
}
