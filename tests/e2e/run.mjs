// ทดสอบหน้าเว็บจริงด้วย Chromium กับ Supabase จำลองในเครื่อง (ใช้ migration ชุดเดียวกับโปรเจกต์)
// ต้องมี: Postgres 16 (socket /var/run/postgresql:54329), postgrest, deno, python3, node_modules (pg, playwright-core)
// ใช้:   E2E_TOOLS=<โฟลเดอร์ที่มี postgrest + node_modules> DENO=<path deno> node tests/e2e/run.mjs
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const TOOLS = process.env.E2E_TOOLS;
const OUT = process.env.E2E_OUT ?? path.join(TOOLS, 'out');
const DENO = process.env.DENO ?? 'deno';
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DB = 'leave_e2e';
const PROJECT = 'https://oqlgytbaihfjqhsriiyb.supabase.co';
const SITE = 'http://127.0.0.1:8088';
const require = createRequire(path.join(TOOLS, 'package.json'));
const { chromium } = require('playwright-core');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'storage'), { recursive: true });

process.env.JWT_SECRET = crypto.randomBytes(24).toString('hex');
process.env.STORAGE_DIR = path.join(OUT, 'storage');
process.env.PUBLISHABLE_KEY = 'sb_publishable_8gvjnN5p5symcplZCY8SDQ_ojm1h0DI';
process.env.PGDATABASE = DB;
process.env.PGHOST = '/var/run/postgresql';
process.env.PGPORT = '54329';

// ---------------- ฐานข้อมูล ----------------
function psql(user, db, args) {
  const r = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', db, ...args], {
    encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' },
  });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return r.stdout;
}
psql('supabase_admin', 'postgres', ['-c', `drop database if exists ${DB}`, '-c', `create database ${DB}`]);
psql('supabase_admin', DB, ['-f', path.join(ROOT, 'supabase/tests/local/supabase_shim.sql')]);
psql('supabase_admin', DB, ['-c', 'create extension if not exists pgcrypto with schema extensions']);
for (const f of fs.readdirSync(path.join(ROOT, 'supabase/migrations')).sort()) {
  psql('postgres', DB, ['-f', path.join(ROOT, 'supabase/migrations', f)]);
}
// แอดมินแบบบัญชีเก่า (ชื่อผู้ใช้ + ติดธงเปลี่ยนรหัส) แล้วตั้งรหัสเข้าใช้ด้วย supabase/seed/set_login_code.sql
// เหมือนที่ต้องทำกับบัญชีจริงที่สร้างไว้ก่อนเปลี่ยนมาใช้รหัส 8 หลัก
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_CODE = '73915820';
psql('postgres', DB, ['-c', `
  insert into auth.users (id, email, encrypted_password, email_confirmed_at)
  values ('${ADMIN_ID}', 'ben@leave.pdr.invalid', extensions.crypt('Admin-pass-1', extensions.gen_salt('bf')), now());
  insert into auth.identities (user_id, provider, provider_id, identity_data)
  values ('${ADMIN_ID}', 'email', '${ADMIN_ID}', '{"email": "ben@leave.pdr.invalid"}');
  insert into public.profiles (id, user_code, full_name, position, role, is_admin, must_change_password)
  values ('${ADMIN_ID}', 'ben', 'นายเบ็น ทดสอบระบบ', 'ครูชำนาญการ', 'hr', true, true);`]);
psql('postgres', DB, ['-c', fs.readFileSync(path.join(ROOT, 'supabase/seed/set_login_code.sql'), 'utf8')
  .replace("v_code      text := '00000000'", `v_code      text := '${ADMIN_CODE}'`)]);

// ---------------- บริการ ----------------
const procs = [];
function start(cmd, args, env = {}, cwd = ROOT) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(OUT, `${path.basename(cmd)}.log`), { flags: 'a' });
  p.stdout.pipe(log);
  p.stderr.pipe(log);
  procs.push(p);
  return p;
}
fs.writeFileSync(path.join(OUT, 'postgrest.conf'), [
  `db-uri = "postgres://authenticator@/${DB}?host=/var/run/postgresql&port=54329"`,
  'db-schemas = "public"', 'db-anon-role = "anon"', `jwt-secret = "${process.env.JWT_SECRET}"`,
  'server-host = "127.0.0.1"', 'server-port = 54330', 'db-pool = 5', 'log-level = "error"',
].join('\n'));
start(path.join(TOOLS, 'postgrest'), [path.join(OUT, 'postgrest.conf')]);
const gateway = await import('./gateway.mjs');
await gateway.listen();
start(DENO, ['run', '--allow-net', '--allow-env', '--allow-read', 'supabase/functions/admin-users/index.ts'], {
  SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: gateway.SERVICE_JWT(),
});
start('python3', ['-m', 'http.server', '8088', '--bind', '127.0.0.1', '--directory', ROOT]);

async function waitFor(url, ok = (r) => r.status < 500) {
  for (let i = 0; i < 120; i++) {
    try {
      if (ok(await fetch(url, { method: 'GET' }))) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for ${url}`);
}
await waitFor('http://127.0.0.1:54330/');
await waitFor('http://127.0.0.1:8000/', () => true);
await waitFor(`${SITE}/index.html`);

// ---------------- รูปทดสอบ (PNG สร้างเอง) ----------------
function png(w, hgt, paint) {
  const raw = Buffer.alloc((w * 4 + 1) * hgt);
  for (let y = 0; y < hgt; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = paint(x, y);
      raw.set([r, g, b, a], y * (w * 4 + 1) + 1 + x * 4);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(hgt, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// ลายเส้นคล้ายลายเซ็น (พื้นโปร่งใส)
const sigPng = (seed) => png(420, 140, (x, y) => {
  const yy = 70 + 38 * Math.sin((x + seed * 13) / 23) * Math.cos(x / (51 + seed));
  return Math.abs(y - yy) < 2.6 && x > 20 && x < 400 ? [20, 30, 110, 255] : [0, 0, 0, 0];
});
const certPng = png(900, 1200, (x, y) => (y % 60 < 3 || (x > 80 && x < 820 && y > 100 && y < 140)
  ? [60, 60, 60, 255] : [250, 250, 245, 255]));

// ---------------- ตัวช่วยทดสอบ ----------------
const results = [];
const problems = [];
let step = '';
const check = (cond, name, detail = '') => {
  results.push({ ok: !!cond, name: `${step}: ${name}`, detail });
  if (!cond) console.error(`FAIL ${step}: ${name} ${detail}`);
};

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
async function newPage(label, mobile) {
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH', timezoneId: 'Asia/Bangkok', acceptDownloads: true }
    : { viewport: { width: 1280, height: 900 }, locale: 'th-TH', timezoneId: 'Asia/Bangkok', acceptDownloads: true });
  await ctx.route(`${PROJECT}/**`, async (route) => {
    const url = route.request().url().replace(PROJECT, 'http://127.0.0.1:54321');
    try {
      const resp = await route.fetch({ url });
      await route.fulfill({ response: resp });
    } catch (e) {
      await route.abort();
      problems.push(`${label}: proxy error ${e.message}`);
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${label}: pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of (400|401|403|404|406|409)/.test(m.text())) {
      problems.push(`${label}: console ${m.text()}`);
    }
  });
  page.on('dialog', async (d) => {
    problems.push(`${label}: native dialog "${d.message()}" (อาจเป็น XSS)`);
    await d.dismiss();
  });
  return page;
}
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true, ...opts });
const toastText = async (page, re) => (await page.locator('#toast.show', re ? { hasText: re } : {}).textContent({ timeout: 8000 }).catch(() => '')) ?? '';
// isVisible()/textContent() ของ Playwright ไม่รอ จึงรอให้มองเห็นก่อนเสมอ
const visible = (loc, timeout = 10000) => loc.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);
const textOf = async (loc, timeout = 10000) => ((await visible(loc, timeout)) ? (await loc.first().textContent()) ?? '' : '');

async function login(page, code) {
  await page.goto(`${SITE}/#/login`);
  await page.getByLabel('รหัสเข้าใช้').fill(code);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
}
async function loginOk(page, code) {
  await login(page, code);
  await page.waitForURL(/#\/$/);
}
async function confirmInDialog(page, label) {
  await page.locator('dialog[open]').getByRole('button', { name: label, exact: true }).click();
}

const users = {};
let leaveId;
try {
  // ===== 1. แอดมินสร้างผู้ใช้ ลายเซ็น วันหยุด =====
  step = 'admin';
  const admin = await newPage('admin', false);
  await admin.goto(SITE);
  await admin.waitForURL(/#\/login/);
  await shot(admin, '01-login-desktop');
  check(await admin.locator('input[autocomplete="username"]').count() === 0, 'หน้าล็อกอินไม่มีช่องชื่อผู้ใช้');
  await login(admin, '1234');
  check(await admin.locator('#login-code').evaluate((i) => !i.checkValidity()) && /#\/login/.test(admin.url()),
    'รหัสไม่ครบ 8 หลักส่งไม่ได้ (เบราว์เซอร์แจ้งเตือน)');
  await login(admin, '73915821');
  check(/ไม่ถูกต้อง/.test(await textOf(admin.locator('.alert.error'))), 'รหัสผิดแสดงข้อความภาษาไทย');
  await loginOk(admin, ADMIN_CODE);
  check(await visible(admin.getByText('สวัสดี นายเบ็น ทดสอบระบบ')), 'บัญชีเก่าที่ตั้งรหัสด้วย set_login_code.sql เข้าหน้าหลักได้');

  await admin.goto(`${SITE}/#/admin/users`);
  // t2 แอดมินกำหนดรหัสเอง คนอื่นให้ระบบสุ่ม
  for (const [key, name, pos, role, wanted] of [
    ['t1', 'นางสาวครูหนึ่ง ใจดี', 'ครู', 'teacher', ''],
    ['t2', 'นายครูสอง ทดสอบ', 'ครูผู้ช่วย', 'teacher', '58204716'],
    ['dep', 'นางรอง ผู้อำนวยการ', 'รองผู้อำนวยการ', 'deputy', ''],
    ['dir', 'นายผู้อำนวยการ ทดสอบ', 'ผู้อำนวยการ', 'director', ''],
  ]) {
    await admin.getByRole('button', { name: '+ เพิ่มผู้ใช้' }).click();
    const dlg = admin.locator('dialog[open]');
    await dlg.getByLabel('ชื่อ-สกุล (พร้อมคำนำหน้า)').fill(name);
    await dlg.getByLabel('ตำแหน่ง').fill(pos);
    await dlg.getByLabel('บทบาท').selectOption(role);
    await dlg.getByLabel('รหัสเข้าใช้').fill(wanted);
    await dlg.getByRole('button', { name: 'สร้างบัญชี' }).click();
    await admin.locator('dialog[open] .big-code').first().waitFor();
    const got = (await admin.locator('dialog[open] .big-code').first().textContent()).trim();
    users[key] = { code: got, name };
    check(/^[0-9]{8}$/.test(got) && (!wanted || got === wanted), `สร้างบัญชี ${key} ได้รหัส 8 หลัก${wanted ? 'ตามที่กำหนด' : 'แบบสุ่ม'}`, got);
    await confirmInDialog(admin, 'จดแล้ว ปิดหน้าต่าง');
    await admin.locator('dialog[open]').waitFor({ state: 'detached' });
  }
  // รหัสเดาง่าย / ดูเหมือนวันเกิด / ซ้ำกับคนอื่น ต้องไม่ได้
  await admin.getByRole('button', { name: '+ เพิ่มผู้ใช้' }).click();
  let dlg = admin.locator('dialog[open]');
  await dlg.getByLabel('ชื่อ-สกุล (พร้อมคำนำหน้า)').fill('ครูรหัสไม่ดี');
  await dlg.getByLabel('ตำแหน่ง').fill('ครู');
  for (const [bad, want, label] of [
    ['12345678', /เดาง่าย/, 'เลขเรียง'], ['15012530', /วันที่/, 'วันเกิด พ.ศ.'], [users.t2.code, /ใช้ไม่ได้/, 'รหัสซ้ำกับคนอื่น'],
  ]) {
    await dlg.getByLabel('รหัสเข้าใช้').fill(bad);
    await dlg.getByRole('button', { name: 'สร้างบัญชี' }).click();
    check(want.test(await textOf(dlg.locator('.alert.error:not([hidden])'))), `ห้ามรหัส${label}`);
  }
  await confirmInDialog(admin, 'ยกเลิก');
  // ผู้อนุมัติซ้ำตำแหน่งต้องไม่ได้
  await admin.getByRole('button', { name: '+ เพิ่มผู้ใช้' }).click();
  dlg = admin.locator('dialog[open]');
  await dlg.getByLabel('ชื่อ-สกุล (พร้อมคำนำหน้า)').fill('รองคนที่สอง');
  await dlg.getByLabel('ตำแหน่ง').fill('รอง');
  await dlg.getByLabel('บทบาท').selectOption('deputy');
  await dlg.getByRole('button', { name: 'สร้างบัญชี' }).click();
  check(/มีผู้ใช้อยู่แล้ว/.test(await textOf(dlg.locator('.alert.error'))), 'ห้ามมีรองผู้อำนวยการ 2 คน');
  await confirmInDialog(admin, 'ยกเลิก');

  // นำเข้าหลายคน (รูปแบบเดียวกับ users_plan.csv ของสคริปต์ย้ายข้อมูล)
  await admin.getByRole('button', { name: 'นำเข้าหลายคน' }).click();
  dlg = admin.locator('dialog[open]');
  await dlg.getByLabel('รายชื่อ').fill('user_code,full_name,position,role,is_admin,login_code\nt3, นายครูสาม ทดสอบ, ครู, teacher,\nบรรทัดเสีย');
  await dlg.getByRole('button', { name: 'ตรวจและนำเข้า' }).click();
  check(/อ่านไม่ได้ 1 บรรทัด/.test(await textOf(dlg.locator('.alert.error'))), 'นำเข้าหลายคน: แจ้งบรรทัดที่อ่านไม่ได้');
  await dlg.getByLabel('รายชื่อ').fill('t3, นายครูสาม ทดสอบ, ครู, teacher\nt4\tนางครูสี่ ทดสอบ\tครู\tครู\n, นายครูห้า ทดสอบ, ครู, teacher, , 61803394');
  await dlg.getByRole('button', { name: 'ตรวจและนำเข้า' }).click();
  await admin.locator('dialog[open]', { hasText: 'สร้างสำเร็จ 3 จาก 3 บัญชี' }).waitFor({ timeout: 20000 });
  const bulkCodes = await admin.locator('dialog[open] .big-code').allTextContents();
  check(bulkCodes.length === 3 && bulkCodes.every((c) => /^[0-9]{8}$/.test(c)) && bulkCodes[2] === '61803394',
    'นำเข้าหลายคน: ได้รหัสเข้าใช้ 3 บัญชี (สุ่ม 2 กำหนดเอง 1)', bulkCodes.join(' '));
  check(psql('postgres', DB, ['-tAc', "select string_agg(user_code, ',' order by user_code) from public.profiles where full_name like 'นายครูสาม%' or full_name like 'นางครูสี่%'"]).trim() === 't3,t4',
    'นำเข้าหลายคน: เก็บรหัสอ้างอิงจากไฟล์ย้ายข้อมูล');
  await confirmInDialog(admin, 'ปิด');
  await admin.locator('tr', { hasText: 'นางครูสี่ ทดสอบ' }).waitFor();

  for (const [i, who] of [['1', 'นายเบ็น ทดสอบระบบ'], ['2', 'นางรอง ผู้อำนวยการ'], ['3', 'นายผู้อำนวยการ ทดสอบ']]) {
    await admin.locator('tr', { hasText: who }).getByRole('button', { name: 'ลายเซ็น' }).click();
    dlg = admin.locator('dialog[open]');
    await dlg.locator('input[type=file]').setInputFiles({ name: `sig${i}.png`, mimeType: 'image/png', buffer: sigPng(Number(i)) });
    await dlg.locator('img[alt="ลายเซ็นใหม่"]').waitFor();
    await dlg.getByRole('button', { name: 'บันทึกลายเซ็นใหม่' }).click();
    check(/บันทึกลายเซ็น/.test(await toastText(admin, /บันทึกลายเซ็น/)), `อัปโหลดลายเซ็น ${who}`);
    await admin.locator('tr', { hasText: who }).getByText('มีลายเซ็น').waitFor();
  }
  await admin.locator('table.table').waitFor();
  await shot(admin, '02-admin-users');

  await admin.goto(`${SITE}/#/admin/settings`);
  await admin.getByText('เพิ่มหลายวันพร้อมกัน').click();
  await admin.getByLabel(/วางรายการ/).fill('23/10/2569 วันปิยมหาราช\n2026-12-05 วันพ่อแห่งชาติ');
  await admin.getByRole('button', { name: 'เพิ่มทั้งหมด' }).click();
  check(/เพิ่ม\/แก้ไข 2 วัน/.test(await toastText(admin, /เพิ่ม\/แก้ไข/)), 'เพิ่มวันหยุดแบบหลายบรรทัด');
  await admin.getByText('วันศุกร์ที่ 23 ตุลาคม 2569').waitFor();
  await shot(admin, '03-admin-settings');

  // ===== 2. ครู 1 ล็อกอินครั้งแรก + ยื่นใบลา =====
  step = 'teacher1';
  const t1 = await newPage('t1', true);
  await loginOk(t1, users.t1.code);
  check(await visible(t1.getByText('ยอดการลาของฉัน')), 'ครูเข้าด้วยรหัส 8 หลักได้ทันที');
  check(await t1.getByText('เปลี่ยนรหัสผ่าน').count() === 0, 'ไม่มีเมนูเปลี่ยนรหัสผ่าน');
  await shot(t1, '04-home-mobile');
  await t1.getByRole('link', { name: '+ ยื่นใบลา' }).click();
  await t1.waitForURL(/#\/leave\/new/);
  await t1.getByText('ลาป่วย', { exact: true }).click();
  await t1.locator('#from').fill('2026-10-22');
  await t1.locator('#to').fill('2026-10-26');
  await t1.locator('.preview-days').waitFor();
  const previewText = await t1.locator('.preview').textContent();
  check(/นับเป็น 2 วัน/.test(previewText), 'ตัดวันหยุดและเสาร์-อาทิตย์ (22–26 ต.ค. = 2 วัน)', previewText);
  const xss = '<img src=x onerror=alert(1)>ไข้หวัด "ทดสอบ" & <b>ตัวหนา</b>';
  await t1.locator('#reason').fill(xss);
  await t1.locator('#contact').fill('081-234-5678');
  await t1.locator('#cert').setInputFiles({ name: 'cert.png', mimeType: 'image/png', buffer: certPng });
  await t1.locator('.cert-preview img').waitFor();
  const sizeText = await t1.locator('.cert-preview small').textContent();
  check(parseInt(sizeText, 10) <= 300, 'ย่อรูปใบรับรองแพทย์ไม่เกิน 300 KB', sizeText);
  await t1.locator('.sig-canvas').scrollIntoViewIfNeeded();
  const box = await t1.locator('.sig-canvas').boundingBox();
  await t1.mouse.move(box.x + 30, box.y + 120);
  await t1.mouse.down();
  for (let i = 0; i <= 40; i++) await t1.mouse.move(box.x + 30 + i * 7, box.y + 100 + 40 * Math.sin(i / 3));
  await t1.mouse.up();
  await shot(t1, '05-leave-new-mobile');
  await t1.getByRole('button', { name: 'ส่งใบลา' }).click();
  await t1.waitForURL(/#\/leave\/\d+$/, { timeout: 20000 });
  leaveId = Number(/#\/leave\/(\d+)/.exec(t1.url())[1]);
  await t1.getByText('ขั้นการอนุมัติ').waitFor();
  check(await visible(t1.getByText(xss, { exact: true })), 'เหตุผลที่มี HTML แสดงเป็นข้อความธรรมดา');
  check((await t1.locator('img[src="x"]').count()) === 0, 'ไม่มี <img> จากข้อความผู้ใช้');
  check(await visible(t1.locator('.badge', { hasText: 'รอหัวหน้าฝ่ายบุคลากร' }).first()), 'สถานะเริ่มต้นรอหัวหน้าฝ่าย');
  await shot(t1, '06-leave-detail-mobile');

  // วันซ้อนต้องยื่นไม่ได้
  await t1.goto(`${SITE}/#/leave/new`);
  await t1.getByText('ลากิจ', { exact: true }).click();
  await t1.locator('#from').fill('2026-10-26');
  await t1.locator('#to').fill('2026-10-26');
  await t1.locator('.preview .alert.error').waitFor();
  check(/ซ้อน/.test(await t1.locator('.preview').textContent()), 'เตือนวันลาซ้อนตั้งแต่ตอนกรอก');

  // ===== 3. ครู 2 เปิดใบลาของครู 1 ไม่ได้ / ยื่นแล้วยกเลิก / ยื่นแล้วถูกไม่อนุมัติ =====
  step = 'teacher2';
  const t2 = await newPage('t2', true);
  await loginOk(t2, users.t2.code);
  await t2.goto(`${SITE}/#/leave/${leaveId}`);
  check(await visible(t2.getByText('ไม่พบใบลา')), 'ครู 2 เปิดใบลาครู 1 ไม่ได้');
  await t2.goto(`${SITE}/#/leave/${leaveId}/form`);
  await t2.locator('.alert.error').waitFor();
  check(await t2.locator('.a4').count() === 0, 'ครู 2 เปิดใบลา A4 ของครู 1 ไม่ได้');
  await t2.goto(`${SITE}/#/admin/users`);
  check(await visible(t2.getByText('ไม่มีสิทธิ์เข้าหน้านี้')), 'ครูเข้าหน้าแอดมินไม่ได้');

  const submitSimple = async (page, type, day, reason) => {
    await page.goto(`${SITE}/#/leave/new`);
    await page.getByText(type, { exact: true }).click();
    await page.locator('#from').fill(day);
    await page.locator('#to').fill(day);
    await page.locator('.preview-days').waitFor();
    await page.locator('#reason').fill(reason);
    await page.locator('#contact').fill('089-000-0000');
    await page.locator('.sig-canvas').scrollIntoViewIfNeeded();
    const b = await page.locator('.sig-canvas').boundingBox();
    await page.mouse.move(b.x + 40, b.y + 80);
    await page.mouse.down();
    for (let i = 0; i <= 30; i++) await page.mouse.move(b.x + 40 + i * 8, b.y + 80 + 25 * Math.cos(i / 2));
    await page.mouse.up();
    await page.getByRole('button', { name: 'ส่งใบลา' }).click();
    await page.waitForURL(/#\/leave\/\d+$/, { timeout: 20000 });
    return Number(/#\/leave\/(\d+)/.exec(page.url())[1]);
  };
  const cancelId = await submitSimple(t2, 'ลากิจ', '2026-10-27', 'ธุระส่วนตัว');
  await t2.getByRole('button', { name: 'ยกเลิกใบลา' }).click();
  await confirmInDialog(t2, 'ยกเลิกใบลา');
  await t2.locator('.badge', { hasText: 'ยกเลิกแล้ว' }).first().waitFor();
  check(true, `ยกเลิกใบลา #${cancelId}`);
  const rejectId = await submitSimple(t2, 'ลากิจ', '2026-10-28', 'ไปต่างจังหวัด');

  // ===== 4. หัวหน้าฝ่าย → รองฯ → ผอ. =====
  step = 'hr';
  await admin.goto(`${SITE}/#/approvals`);
  await admin.locator('.leave-card').first().waitFor();
  check(await admin.locator('.leave-card').count() === 2, 'กล่อง "รอฉัน" มี 2 ใบ (ไม่รวมใบที่ยกเลิก)');
  await shot(admin, '07-approvals-desktop');
  await admin.goto(`${SITE}/#/leave/${rejectId}`);
  await admin.getByRole('button', { name: 'ไม่อนุมัติ' }).click();
  check(/กรุณาระบุเหตุผล/.test(await textOf(admin.locator('.decision .alert.error'))), 'ไม่อนุมัติต้องมีเหตุผล');
  await admin.getByLabel('เหตุผล / ความเห็น').fill('ช่วงสอบกลางภาค');
  await admin.getByRole('button', { name: 'ไม่อนุมัติ' }).click();
  await confirmInDialog(admin, 'ไม่อนุมัติ');
  await admin.locator('.badge', { hasText: 'ไม่อนุมัติ' }).first().waitFor();
  check(true, 'หัวหน้าฝ่ายไม่อนุมัติใบของครู 2');

  await admin.goto(`${SITE}/#/leave/${leaveId}`);
  await admin.getByRole('button', { name: 'ดูใบรับรองแพทย์' }).click();
  await admin.locator('dialog[open] img.cert-full').waitFor();
  check(await admin.locator('dialog[open] img.cert-full').evaluate((i) => i.naturalWidth > 0), 'ผู้อนุมัติเปิดใบรับรองแพทย์ได้');
  await confirmInDialog(admin, 'ปิด');
  await admin.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
  await confirmInDialog(admin, 'อนุมัติ');
  await admin.locator('.badge', { hasText: 'รอรองผู้อำนวยการ' }).first().waitFor();
  check(true, 'หัวหน้าฝ่ายอนุมัติ → รอรองฯ');

  step = 'deputy';
  const dep = await newPage('dep', true);
  await loginOk(dep, users.dep.code);
  await dep.goto(`${SITE}/#/approvals`);
  await dep.locator('.leave-card').first().click();
  await dep.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
  await confirmInDialog(dep, 'อนุมัติ');
  await dep.locator('.badge', { hasText: 'รอผู้อำนวยการ' }).first().waitFor();
  check(true, 'รองฯ อนุมัติ → รอ ผอ.');

  step = 'director';
  const dir = await newPage('dir', false);
  await loginOk(dir, users.dir.code);
  check(await dir.getByRole('link', { name: '+ ยื่นใบลา' }).count() === 0, 'ผอ. ไม่มีปุ่มยื่นใบลา');
  await dir.goto(`${SITE}/#/leave/${leaveId}`);
  check(await visible(dir.getByLabel('วันที่อนุญาต')), 'ผอ. เลือกวันที่อนุญาตได้');
  await dir.getByRole('button', { name: 'อนุญาต', exact: true }).click();
  await confirmInDialog(dir, 'อนุมัติ');
  await dir.locator('.badge', { hasText: 'อนุญาตแล้ว' }).first().waitFor();
  check(true, 'ผอ. อนุญาต → อนุญาตแล้ว');

  // ===== 5. ใบลา A4 =====
  step = 'form';
  await t1.goto(`${SITE}/#/leave/${leaveId}/form`);
  await t1.locator('.a4').waitFor();
  await t1.waitForFunction(() => [...document.querySelectorAll('img.sig')].length === 4
    && [...document.querySelectorAll('img.sig')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
  check(true, 'ใบลามีลายเซ็นครบ 4 (ผู้ลา + หัวหน้าฝ่าย + รองฯ + ผอ.)');
  const formText = await t1.locator('.a4').textContent();
  for (const want of ['☑ ป่วย', 'มีกำหนด 2 วัน', '22 ตุลาคม 2569', '26 ตุลาคม 2569', 'นางสาวครูหนึ่ง ใจดี', '☑ อนุญาต', 'เห็นควรอนุญาตดำเนินการตามคำขอ']) {
    check(formText.includes(want), `ใบลามี "${want}"`);
  }
  await t1.setViewportSize({ width: 900, height: 1300 });
  await t1.locator('.a4').screenshot({ path: path.join(OUT, '08-form-a4.png') });
  await t1.emulateMedia({ media: 'print' });
  await t1.pdf({ path: path.join(OUT, 'leave-form.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
  await t1.emulateMedia({ media: 'screen' });
  // ใบที่ไม่อนุมัติ: ไม่มีลายเซ็นหัวหน้าฝ่าย
  await admin.goto(`${SITE}/#/leave/${rejectId}/form`);
  await admin.locator('.a4').waitFor();
  await admin.waitForTimeout(800);
  check(await admin.locator('img.sig').count() === 1, 'ใบที่ไม่อนุมัติมีแค่ลายเซ็นผู้ลา');
  check((await admin.locator('.a4').textContent()).includes('ไม่ผ่านการตรวจสอบ: ช่วงสอบกลางภาค'), 'ใบที่ไม่อนุมัติแสดงเหตุผล');

  // ===== 6. สรุป + Excel + ยอดลาของครู =====
  step = 'summary';
  await admin.goto(`${SITE}/#/summary`);
  await admin.locator('.stats').waitFor();
  const stats = await admin.locator('.stat').allTextContents();
  check(stats[0].startsWith('2') && stats[4].startsWith('2'), 'การ์ดสรุป: ทั้งหมด 2 ใบ เสร็จแล้ว 2', stats.join(' | '));
  const [download] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('button', { name: 'ส่งออก Excel' }).click()]);
  await download.saveAs(path.join(OUT, 'summary.xlsx'));
  check(true, `ดาวน์โหลด ${download.suggestedFilename()}`);
  await shot(admin, '09-summary-desktop');
  const sumMobile = await newPage('sum-mobile', true);
  await loginOk(sumMobile, ADMIN_CODE);
  await sumMobile.goto(`${SITE}/#/summary`);
  await sumMobile.locator('.stats').waitFor();
  await shot(sumMobile, '10-summary-mobile');

  await t1.goto(`${SITE}/#/`);
  await t1.locator('.balance').first().waitFor();
  const sick = await t1.locator('.balance', { hasText: 'ลาป่วย' }).textContent();
  check(/1 ครั้ง · 2 วัน/.test(sick), 'ยอดลาป่วยของครู 1 = 1 ครั้ง 2 วัน', sick);
  await shot(t1, '11-home-after-mobile');

  // ===== 7. ตั้งรหัสใหม่ / ปิดบัญชีแล้วล็อกอินไม่ได้ =====
  step = 'set-code';
  await admin.goto(`${SITE}/#/admin/users`);
  await admin.locator('tr', { hasText: 'นางสาวครูหนึ่ง ใจดี' }).getByRole('button', { name: 'ตั้งรหัสใหม่' }).click();
  await confirmInDialog(admin, 'บันทึกรหัสใหม่');
  await admin.locator('dialog[open] .big-code').waitFor();
  const newT1 = (await admin.locator('dialog[open] .big-code').textContent()).trim();
  await confirmInDialog(admin, 'จดแล้ว ปิดหน้าต่าง');
  const t1b = await newPage('t1b', true);
  await login(t1b, users.t1.code);
  check(/ไม่ถูกต้อง/.test(await textOf(t1b.locator('.alert.error'))), 'ตั้งรหัสใหม่แล้วรหัสเดิมใช้ไม่ได้');
  await loginOk(t1b, newT1);
  check(await visible(t1b.getByText('ยอดการลาของฉัน')), 'รหัสใหม่เข้าใช้ได้ ข้อมูลเดิมอยู่ครบ');

  step = 'deactivate';
  await admin.goto(`${SITE}/#/admin/users`);
  await admin.locator('tr', { hasText: 'นายครูสอง ทดสอบ' }).getByRole('button', { name: 'แก้ไข' }).click();
  await admin.locator('dialog[open]').getByText(/เปิดใช้งานบัญชี/).click();
  await confirmInDialog(admin, 'บันทึก');
  await admin.locator('tr', { hasText: 'นายครูสอง ทดสอบ' }).getByText('ปิดบัญชี').waitFor();
  const t2b = await newPage('t2b', true);
  await login(t2b, users.t2.code);
  check(/ถูกปิดใช้งาน/.test(await textOf(t2b.locator('.alert.error'))), 'บัญชีที่ปิดแล้วล็อกอินไม่ได้');
} catch (e) {
  check(false, 'ข้อผิดพลาดระหว่างทดสอบ', e.stack);
  for (const [i, ctx] of browser.contexts().entries()) {
    for (const [j, pg] of ctx.pages().entries()) await shot(pg, `zz-failure-${i}-${j}`).catch(() => {});
  }
} finally {
  await browser.close().catch(() => {});
  for (const p of procs) p.kill();
  await gateway.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, problems }, null, 2));
console.log(`E2E: ${results.length - failed.length}/${results.length} ผ่าน, ปัญหาจากเบราว์เซอร์ ${problems.length} รายการ`);
for (const f of failed) console.log(`  ✗ ${f.name} ${f.detail ?? ''}`);
for (const p of problems) console.log(`  ! ${p}`);
process.exit(failed.length || problems.length ? 1 : 0);
