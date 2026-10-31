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

// ช่องรหัสเข้าใช้ 6 หลัก เว้นว่าง = ระบบสุ่มให้
function codeInput() {
  return h('input', { maxlength: '72', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'เว้นว่างให้ระบบสุ่ม' });
}
const CODE_HINT = 'ครู: ตัวเลข 6 หลัก ห้ามเลขซ้ำหรือเลขเรียง (เช่น 123456) · หัวหน้าฝ่าย/รองฯ/ผอ.: ตั้งแบบไหนก็ได้ · ห้ามซ้ำกับผู้อื่น — แนะนำให้ระบบสุ่ม';

async function showLoginCode(fullName, code) {
  await dialog({
    title: 'รหัสเข้าใช้',
    body: [
      h('p', {}, `แจ้งรหัสนี้ให้ ${fullName} โดยตรง (อย่าส่งในกลุ่ม) ใช้รหัสนี้อย่างเดียวเข้าสู่ระบบ`),
      h('p', { class: 'center' }, h('code', { class: 'big-code' }, code)),
      h('button', { type: 'button', class: 'btn', onclick: () => copyText(`${fullName}\tรหัสเข้าใช้: ${code}`) }, 'คัดลอก'),
      h('p', { class: 'alert warn small' }, 'ปิดหน้าต่างนี้แล้วจะดูรหัสนี้อีกไม่ได้ (ตั้งรหัสใหม่ได้เสมอ)'),
    ],
    actions: [{ label: 'จดแล้ว ปิดหน้าต่าง', value: true, kind: 'primary' }],
  });
}

async function addUser(onDone) {
  const name = h('input', { maxlength: '120', placeholder: 'เช่น นางสาวสมใจ ใจดี' });
  const position = h('input', { maxlength: '120', placeholder: 'เช่น ครู / ครูผู้ช่วย / ครูชำนาญการ' });
  const role = roleSelect('teacher');
  const isAdmin = h('input', { type: 'checkbox' });
  const code = codeInput();
  const msg = h('div', { class: 'alert error', role: 'alert', hidden: true });
  let created = null;
  const ok = await dialog({
    title: 'เพิ่มผู้ใช้',
    body: [
      field('ชื่อ-สกุล (พร้อมคำนำหน้า)', name),
      field('ตำแหน่ง', position),
      field('บทบาท', role, 'หัวหน้าฝ่ายบุคลากร / รอง ผอ. / ผอ. มีได้ตำแหน่งละ 1 คน'),
      h('label', { class: 'check' }, isAdmin, ' เป็นแอดมิน (จัดการผู้ใช้และตั้งค่าระบบได้)'),
      field('รหัสเข้าใช้', code, CODE_HINT),
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
              action: 'create', full_name: name.value, position: position.value,
              role: role.value, is_admin: isAdmin.checked, login_code: code.value,
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
    await showLoginCode(name.value.trim(), created.login_code);
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
    title: `แก้ไข ${u.full_name}`,
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

// นำเข้าหลายคนพร้อมกัน: บรรทัดละคน คั่นด้วย , หรือ Tab
// รหัสอ้างอิง(เว้นว่างได้), ชื่อ-สกุล, ตำแหน่ง, บทบาท(teacher/hr/deputy/director), แอดมิน(ใช่/yes/1), รหัสเข้าใช้(เว้นว่าง = สุ่ม)
// คอลัมน์แรกตรงกับ users_plan.csv ของสคริปต์ย้ายข้อมูล ซึ่งใช้รหัสอ้างอิงจับคู่ใบลาเดิมกับบัญชี
const ROLE_ALIASES = {
  teacher: 'teacher', 'ครู': 'teacher', hr: 'hr', 'หัวหน้าฝ่ายบุคลากร': 'hr',
  deputy: 'deputy', 'รองผู้อำนวยการ': 'deputy', director: 'director', 'ผู้อำนวยการ': 'director',
};

function parseBulk(text) {
  const rows = [];
  const errors = [];
  text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim()).forEach((line, i) => {
    const cells = line.split(line.includes('\t') ? '\t' : ',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (i === 0 && /user_code|full_name|ชื่อ-สกุล/i.test(cells.join(' '))) return; // แถวหัวตาราง
    // คอลัมน์แรกคือรหัสอ้างอิง (เว้นว่างได้) ถ้าไม่ใช่รูปแบบรหัส (เช่น เป็นชื่อคน) แปลว่าแถวนี้ไม่มีคอลัมน์รหัสอ้างอิง
    if (cells[0] && !/^[a-z0-9][a-z0-9._-]{0,31}$/i.test(cells[0])) cells.unshift('');
    const [ref = '', name, position, role = 'teacher', admin = '', code = ''] = cells;
    const r = ROLE_ALIASES[role.toLowerCase()] ?? ROLE_ALIASES[role || 'teacher'];
    if (!name || !position || !r || (code && code.length > 72)) errors.push(`บรรทัด ${i + 1}: ${line.trim()}`);
    else {
      rows.push({
        user_code: ref.toLowerCase(), full_name: name, position, role: r,
        is_admin: /^(ใช่|yes|y|1|true)$/i.test(admin), login_code: code,
      });
    }
  });
  return { rows, errors };
}

async function bulkImport(onDone) {
  const text = h('textarea', { rows: '10', placeholder: ', นางสาวสมใจ ใจดี, ครู, teacher\n, นายสมชาย ..., ครูชำนาญการ, hr, ใช่' });
  const msg = h('div', { class: 'alert error', role: 'alert', hidden: true });
  let parsed = null;
  const ok = await dialog({
    title: 'นำเข้าผู้ใช้หลายคน',
    body: [
      h('p', { class: 'muted small' }, 'บรรทัดละคน: รหัสอ้างอิง (เว้นว่างได้), ชื่อ-สกุล, ตำแหน่ง, บทบาท (teacher/hr/deputy/director), '
        + 'แอดมิน (ใช่/เว้นว่าง), รหัสเข้าใช้ 6 หลัก (เว้นว่าง = ระบบสุ่ม) — คัดลอกจาก Excel มาวางได้เลย ไม่ต้องใส่ comma '
        + '(ข้อความสีเทาในช่องเป็นแค่ตัวอย่าง ต้องวางหรือพิมพ์รายชื่อจริง)'),
      field('รายชื่อ', text),
      msg,
    ],
    actions: [
      { label: 'ยกเลิก', value: false },
      {
        label: 'ตรวจและนำเข้า', value: true, kind: 'primary',
        validate: () => {
          parsed = parseBulk(text.value);
          msg.hidden = !parsed.errors.length && parsed.rows.length > 0;
          msg.textContent = parsed.errors.length ? `อ่านไม่ได้ ${parsed.errors.length} บรรทัด — ${parsed.errors[0]}` : 'ยังไม่มีรายชื่อ';
          return msg.hidden;
        },
      },
    ],
  });
  if (!ok) return;

  const results = [];
  const status = h('p', { class: 'muted' });
  const table = h('tbody');
  const done = dialog({
    title: 'ผลการนำเข้า',
    body: [
      status,
      h('table', { class: 'table print-list' },
        h('thead', {}, h('tr', {}, ['ชื่อ-สกุล', 'รหัสเข้าใช้ / ผล'].map((t) => h('th', {}, t)))),
        table),
      h('p', { class: 'alert warn small' }, 'จดหรือพิมพ์รายการนี้ก่อนปิด — ปิดแล้วจะดูรหัสเข้าใช้อีกไม่ได้ (ตั้งรหัสใหม่ได้)'),
      h('div', { class: 'row gap' },
        h('button', {
          type: 'button', class: 'btn',
          onclick: () => copyText(results.map((r) => `${r.full_name}\t${r.login_code ?? r.error}`).join('\n')),
        }, 'คัดลอกทั้งหมด'),
        h('button', { type: 'button', class: 'btn', onclick: () => window.print() }, 'พิมพ์')),
    ],
    actions: [{ label: 'ปิด', value: true, kind: 'primary' }],
  });
  for (const [i, row] of parsed.rows.entries()) {
    status.textContent = `กำลังสร้างบัญชี ${i + 1}/${parsed.rows.length}…`;
    try {
      const res = await adminUsers({ action: 'create', ...row });
      results.push({ ...row, login_code: res.login_code });
      table.append(h('tr', {}, h('td', {}, row.full_name), h('td', {}, h('code', { class: 'big-code' }, res.login_code))));
    } catch (e) {
      results.push({ ...row, login_code: null, error: errorText(e) });
      table.append(h('tr', { class: 'inactive' }, h('td', {}, row.full_name),
        h('td', {}, h('span', { class: 'reason' }, errorText(e)))));
    }
  }
  const okCount = results.filter((r) => r.login_code).length;
  status.textContent = `สร้างสำเร็จ ${okCount} จาก ${results.length} บัญชี`;
  await done;
  onDone();
}

async function setLoginCode(u, me) {
  const code = codeInput();
  const msg = h('div', { class: 'alert error', role: 'alert', hidden: true });
  let res = null;
  const ok = await dialog({
    title: `ตั้งรหัสเข้าใช้ใหม่: ${u.full_name}`,
    body: [
      h('p', {}, 'รหัสเดิมจะใช้ไม่ได้ทันทีหลังบันทึก'),
      field('รหัสเข้าใช้ใหม่', code, CODE_HINT),
      msg,
    ],
    actions: [
      { label: 'ยกเลิก', value: false },
      {
        label: 'บันทึกรหัสใหม่', value: true, kind: 'primary',
        validate: async () => {
          msg.hidden = true;
          try {
            res = await adminUsers({ action: 'reset_password', user_id: u.id, login_code: code.value });
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
  if (ok && res) {
    await showLoginCode(u.full_name, res.login_code);
    if (u.id === me.id) {
      // เปลี่ยนรหัสของตัวเอง ล็อกอินเดิมใช้ไม่ได้แล้ว ให้เข้าสู่ระบบใหม่ด้วยรหัสใหม่
      sessionStorage.setItem('leave.notice', 'เปลี่ยนรหัสของคุณแล้ว กรุณาเข้าสู่ระบบใหม่ด้วยรหัสใหม่');
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    }
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
  let first = true;
  const load = async () => {
    if (first) mount(el, loading());
    first = false;
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
      h('td', { 'data-label': 'บทบาท' },
        h('span', { class: `badge role-${u.role}` }, ROLE_LABEL[u.role]),
        u.is_admin ? h('span', { class: 'badge admin' }, 'แอดมิน') : null),
      h('td', { 'data-label': 'สถานะ' },
        !u.active ? h('span', { class: 'badge cancelled' }, 'ปิดบัญชี')
          : u.must_change_password ? h('span', { class: 'badge pending' }, 'ต้องตั้งรหัสใหม่')
            : h('span', { class: 'badge approved' }, 'ใช้งานได้'),
        u.role !== 'teacher' && u.active
          ? h('span', { class: `badge ${u.signature_path ? 'approved' : 'rejected'}` }, u.signature_path ? 'มีลายเซ็น' : 'ไม่มีลายเซ็น')
          : null),
      h('td', { class: 'actions', 'data-label': '' },
        h('button', { type: 'button', class: 'btn small', onclick: () => editUser(u, profile, load) }, 'แก้ไข'),
        u.active ? h('button', { type: 'button', class: 'btn small', onclick: () => setLoginCode(u, profile).then(() => { if (u.id !== profile.id) load(); }) }, 'ตั้งรหัสใหม่') : null,
        u.role !== 'teacher'
          ? h('button', { type: 'button', class: 'btn small', onclick: () => signatureDialog(u, load) }, 'ลายเซ็น')
          : null)));

    const ACTION = { create: 'สร้างบัญชี', reset_password: 'ตั้งรหัสเข้าใช้ใหม่ให้', update: 'แก้ไขข้อมูล' };
    mount(el,
      h('div', { class: 'row space wrap' },
        h('h1', {}, 'จัดการผู้ใช้'),
        h('div', { class: 'row gap' },
          h('button', { type: 'button', class: 'btn', onclick: () => bulkImport(load) }, 'นำเข้าหลายคน'),
          h('button', { type: 'button', class: 'btn primary', onclick: () => addUser(load) }, '+ เพิ่มผู้ใช้'))),
      missing.length
        ? h('p', { class: 'alert warn' }, `ยังไม่มีผู้ใช้ในตำแหน่ง: ${missing.map((r) => ROLE_LABEL[r]).join(', ')} — ใบลาจะค้างที่ขั้นนั้นจนกว่าจะกำหนดผู้ใช้`)
        : null,
      noSig.length
        ? h('p', { class: 'alert warn' }, `ผู้อนุมัติที่ยังไม่มีลายเซ็น (อนุมัติไม่ได้): ${noSig.map((u) => u.full_name).join(', ')}`)
        : null,
      h('table', { class: 'table responsive' },
        h('thead', {}, h('tr', {}, ['ชื่อ', 'บทบาท', 'สถานะ', ''].map((t) => h('th', {}, t)))),
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
