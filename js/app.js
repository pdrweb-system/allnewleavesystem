import { sb } from './supabase.js';
import { auth, loadSession, signOut, canFile, canViewAll, isApprover, hasHome, landingPath, ROLE_LABEL } from './auth.js';
import { route, matchRoute, navigate, startRouter, currentPath } from './router.js';
import { h, mount, errorBox, loading } from './ui.js';
import { clearCaches } from './api.js';
import { SITE_NAME } from './config.js';

// กันหน้าเว็บถูกฝังใน iframe ของเว็บอื่น (GitHub Pages ตั้ง header frame-ancestors ไม่ได้)
if (window.top !== window.self) {
  document.documentElement.replaceChildren();
  throw new Error('framed');
}

const view = (path) => () => import(path).then((m) => m.default);

route('/login', view('./views/login.js'), { public: true, title: 'เข้าสู่ระบบ' });
route('/', view('./views/home.js'), { title: 'หน้าหลัก' });
route('/leave/new', view('./views/leave-new.js'), { can: canFile, title: 'ยื่นใบลา' });
route('/leave/:id', view('./views/leave-detail.js'), { title: 'รายละเอียดใบลา' });
route('/leave/:id/form', view('./views/leave-form.js'), { title: 'ใบลา', printable: true });
route('/approvals', view('./views/approvals.js'), { can: canViewAll, title: 'อนุมัติใบลา' });
route('/summary', view('./views/summary.js'), { can: canViewAll, title: 'สรุปการลา' });
route('/admin/users', view('./views/admin-users.js'), { can: (p) => p.is_admin, title: 'จัดการผู้ใช้' });
route('/admin/leaves', view('./views/admin-leaves.js'), { can: (p) => p.is_admin, title: 'จัดการใบลา' });
route('/admin/login', view('./views/admin-login.js'), { can: (p) => p.is_admin, title: 'ปรับแต่งหน้าล็อกอิน' });
route('/admin/settings', view('./views/admin-settings.js'), { can: (p) => p.is_admin, title: 'ตั้งค่าระบบ' });

const app = document.getElementById('app');
const topbar = document.getElementById('topbar');
let sessionLoaded = false;
let renderSeq = 0;
let landed = false; // เข้าหน้าแรกของบทบาทแล้วหรือยัง (รีเซ็ตเมื่ออยู่หน้าล็อกอิน)
let cleanup = null;

function navLinks(p) {
  const links = [];
  if (isApprover(p)) links.push(['#/approvals', 'อนุมัติใบลา']); // ผู้อนุมัติเริ่มที่หน้าอนุมัติ
  if (hasHome(p)) links.push(['#/', 'หน้าหลัก']);
  if (canFile(p)) links.push(['#/leave/new', 'ยื่นใบลา']);
  if (!isApprover(p) && canViewAll(p)) links.push(['#/approvals', 'ใบลาทั้งหมด']);
  if (canViewAll(p)) links.push(['#/summary', 'สรุป']);
  if (p.is_admin) links.push(['#/admin/users', 'ผู้ใช้'], ['#/admin/leaves', 'จัดการใบลา'], ['#/admin/login', 'หน้าล็อกอิน'], ['#/admin/settings', 'ตั้งค่า']);
  return links;
}

function renderTopbar(path) {
  const p = auth.profile;
  if (!p || !p.active || p.must_change_password) {
    mount(topbar, h('a', { class: 'brand', href: '#/' }, SITE_NAME));
    return;
  }
  const menu = h('div', { class: 'menu', id: 'menu', hidden: true },
    h('div', { class: 'menu-user' },
      h('strong', {}, p.full_name),
      h('small', {}, [ROLE_LABEL[p.role], p.is_admin ? ' · แอดมิน' : ''].join(''))),
    navLinks(p).map(([href, label]) => h('a', {
      href, class: path === href.slice(1) ? 'active' : null,
      onclick: () => { menu.hidden = true; },
    }, label)),
    h('button', {
      type: 'button', class: 'menu-logout',
      onclick: async () => {
        await signOut();
        clearCaches();
        navigate('/login');
      },
    }, 'ออกจากระบบ'));
  const toggle = h('button', {
    type: 'button', class: 'menu-btn', 'aria-label': 'เมนู', 'aria-controls': 'menu',
    onclick: (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    },
  }, h('span', { 'aria-hidden': 'true' }, '☰'), h('span', { class: 'menu-btn-name' }, p.full_name));
  mount(topbar,
    h('a', { class: 'brand', href: `#${landingPath(p)}` }, SITE_NAME),
    h('nav', { class: 'nav-inline' }, navLinks(p).map(([href, label]) =>
      h('a', { href, class: path === href.slice(1) ? 'active' : null }, label))),
    toggle,
    menu);
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('menu');
  if (menu && !menu.hidden && !menu.contains(e.target)) menu.hidden = true;
});

function notice(title, message, actions = []) {
  return h('section', { class: 'card narrow center' }, h('h1', {}, title), h('p', {}, message), actions);
}

// หลังมีการอัปเดตเว็บ เบราว์เซอร์อาจยังถือไฟล์ .js ตัวเก่าบางไฟล์ในแคช (GitHub Pages แคชราว 10 นาที)
// จนโมดูลเก่า/ใหม่ไม่เข้ากัน: โหลดไฟล์ใหม่ทับแคชแล้วรีเฟรชให้เองหนึ่งครั้ง ถ้ายังไม่หายให้ผู้ใช้กดรีเฟรช
const STALE_ASSETS = /does not provide an export|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;
async function refreshAssets() {
  const urls = performance.getEntriesByType('resource').map((r) => r.name)
    .filter((u) => u.startsWith(location.origin) && /\.(js|css)(\?|$)/.test(u));
  await Promise.all([...new Set(urls)].map((u) => fetch(u, { cache: 'reload' }).catch(() => {})));
  location.reload();
}

async function onRoute(path) {
  const seq = ++renderSeq;
  const r = matchRoute(path);
  if (!r) {
    renderTopbar(path);
    mount(app, notice('ไม่พบหน้านี้', 'ลิงก์อาจไม่ถูกต้อง', h('a', { class: 'btn primary', href: '#/' }, 'กลับหน้าหลัก')));
    return;
  }
  document.title = `${r.options.title ?? ''} · ${SITE_NAME}`;
  if (r.options.public) landed = false;
  document.body.classList.toggle('printable', !!r.options.printable);

  try {
    if (!sessionLoaded) {
      mount(app, loading());
      await loadSession();
      sessionLoaded = true;
    }
  } catch (e) {
    mount(app, errorBox(e));
    return;
  }
  if (seq !== renderSeq) return;

  const p = auth.profile;
  if (!r.options.public) {
    if (!auth.user) {
      sessionStorage.setItem('leave.next', path);
      navigate('/login', { replace: true });
      return;
    }
    if (!p || !p.active) {
      renderTopbar(path);
      mount(app, notice(
        'บัญชีนี้ใช้งานไม่ได้',
        p ? 'บัญชีถูกปิดใช้งาน กรุณาติดต่อแอดมิน' : 'ไม่พบข้อมูลผู้ใช้ของบัญชีนี้ กรุณาติดต่อแอดมิน',
        h('button', { class: 'btn', onclick: async () => { await signOut(); navigate('/login'); } }, 'ออกจากระบบ')));
      return;
    }
    if (p.must_change_password) {
      // บัญชีจากระบบรหัสผ่านแบบเก่า: ฐานข้อมูลยังไม่ให้ใช้งานจนกว่าแอดมินตั้งรหัสเข้าใช้ใหม่
      renderTopbar(path);
      mount(app, notice('บัญชียังใช้งานไม่ได้', 'กรุณาให้แอดมินตั้งรหัสเข้าใช้ 8 หลักให้ใหม่',
        h('button', { class: 'btn', onclick: async () => { await signOut(); navigate('/login'); } }, 'ออกจากระบบ')));
      return;
    }
    if (path === '/' && (!hasHome(p) || !landed)) {
      // เปิดเว็บ/เข้าสู่ระบบครั้งแรกเข้าหน้าแรกของบทบาท (ผู้อนุมัติ = หน้าอนุมัติ) บัญชีที่ไม่มีหน้าหลักเข้า '/' ไม่ได้เลย
      landed = true;
      const to = landingPath(p);
      if (to !== '/') {
        navigate(to, { replace: true });
        return;
      }
    }
    landed = true;
    if (r.options.can && !r.options.can(p)) {
      renderTopbar(path);
      mount(app, notice('ไม่มีสิทธิ์เข้าหน้านี้', 'หน้านี้สำหรับผู้มีสิทธิ์เฉพาะเท่านั้น',
        h('a', { class: 'btn primary', href: '#/' }, 'กลับหน้าหลัก')));
      return;
    }
  }

  renderTopbar(path);
  const container = h('div', { class: 'view' });
  try {
    cleanup?.();
  } catch {
    // ignore
  }
  cleanup = null;
  mount(app, loading());
  try {
    const render = await r.view();
    if (seq !== renderSeq) return;
    mount(app, container);
    window.scrollTo(0, 0);
    const done = await render(container, r.params, { profile: auth.profile, path });
    if (typeof done === 'function') cleanup = done;
    app.focus({ preventScroll: true });
    sessionStorage.removeItem('leave.reloaded');
  } catch (e) {
    if (!e?.code) console.error(e); // error จากเซิร์ฟเวอร์ (มี code) แสดงในหน้าอยู่แล้ว
    if (STALE_ASSETS.test(e?.message ?? '')) {
      if (!sessionStorage.getItem('leave.reloaded')) {
        sessionStorage.setItem('leave.reloaded', '1');
        mount(container, loading('เว็บเพิ่งอัปเดต กำลังโหลดไฟล์ใหม่…'));
        await refreshAssets();
        return;
      }
      if (seq === renderSeq) {
        mount(container, notice('เว็บเพิ่งอัปเดต', 'กรุณารีเฟรชหน้า (Ctrl+F5 บนคอมพิวเตอร์ หรือปิดแล้วเปิดเว็บใหม่บนมือถือ)',
          h('button', { class: 'btn primary', onclick: () => { sessionStorage.removeItem('leave.reloaded'); refreshAssets(); } }, 'รีเฟรชตอนนี้')));
      }
      return;
    }
    if (seq === renderSeq) mount(container, errorBox(e));
  }
}

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && currentPath() !== '/login') {
    auth.user = null;
    auth.profile = null;
    clearCaches();
    navigate('/login');
  }
});

startRouter(onRoute);
