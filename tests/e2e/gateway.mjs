// ใช้ทดสอบในเครื่องเท่านั้น: เกตเวย์จำลอง Supabase (Auth + Storage) หน้า PostgREST และ Edge Function
// - /rest/v1      → PostgREST ตัวจริง (RLS ของฐานข้อมูลทำงานเหมือนบนโปรเจกต์)
// - /auth/v1      → จำลอง GoTrue เท่าที่หน้าเว็บและ admin-users ใช้ (รหัสผ่านตรวจด้วย crypt ใน auth.users)
// - /storage/v1   → จำลอง Storage: insert/select storage.objects ด้วยบทบาทผู้ใช้ เพื่อให้ policy จริงตัดสิน
// - /functions/v1 → Edge Function ที่รันด้วย Deno ในเครื่อง
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

// node_modules (pg) อยู่ในโฟลเดอร์เครื่องมือทดสอบ ไม่ได้อยู่ใน repo
const pg = createRequire(path.join(process.env.E2E_TOOLS ?? '.', 'package.json'))('pg');

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const POSTGREST = process.env.POSTGREST_URL ?? 'http://127.0.0.1:54330';
const FUNCTIONS = {
  'admin-users': process.env.ADMIN_USERS_URL ?? 'http://127.0.0.1:8000',
  'holidays-import': process.env.HOLIDAYS_IMPORT_URL ?? 'http://127.0.0.1:8001',
};
const SECRET = process.env.JWT_SECRET;
const STORAGE_DIR = process.env.STORAGE_DIR;
const PUBLISHABLE = process.env.PUBLISHABLE_KEY;

const pool = new pg.Pool({
  host: process.env.PGHOST ?? '/var/run/postgresql',
  port: Number(process.env.PGPORT ?? 54329),
  database: process.env.PGDATABASE,
  user: 'postgres',
  max: 8,
});

const b64url = (buf) => Buffer.from(buf).toString('base64url');
export function sign(payload) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (expect.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(parts[2]))) return null;
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}

const now = () => Math.floor(Date.now() / 1000);
export const SERVICE_JWT = () => sign({ iss: 'supabase', role: 'service_role', iat: now(), exp: now() + 86400 * 365 });
const ANON_JWT = sign({ iss: 'supabase', role: 'anon', iat: now(), exp: now() + 86400 * 365 });

function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
  return m ? m[1] : null;
}
// แปลง API key/JWT ของคำขอเป็น claims (publishable key = anon)
function claims(req) {
  for (const t of [bearer(req), req.headers.apikey]) {
    if (!t) continue;
    const p = verify(t);
    if (p) return p;
    if (t === PUBLISHABLE) return { role: 'anon' };
  }
  return null;
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function send(res, status, data, headers = {}) {
  const isBuf = Buffer.isBuffer(data);
  res.writeHead(status, {
    'content-type': isBuf ? headers['content-type'] ?? 'application/octet-stream' : 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(isBuf ? data : data === undefined ? '' : JSON.stringify(data));
}

// ---------------- Auth ----------------
const refreshTokens = new Map();

function userJson(u) {
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, phone: '',
    email_confirmed_at: u.email_confirmed_at ?? u.created_at, confirmed_at: u.created_at,
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [],
    created_at: u.created_at, updated_at: u.updated_at, is_anonymous: false,
  };
}

function session(u) {
  const iat = now();
  const sessionId = crypto.randomUUID();
  const access = sign({
    aud: 'authenticated', iss: `http://127.0.0.1:${PORT}/auth/v1`, sub: u.id, email: u.email, phone: '',
    role: 'authenticated', aal: 'aal1', session_id: sessionId, iat, exp: iat + 3600,
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
    amr: [{ method: 'password', timestamp: iat }], is_anonymous: false,
  });
  const refresh = crypto.randomBytes(16).toString('hex');
  refreshTokens.set(refresh, u.id);
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: iat + 3600, refresh_token: refresh, user: userJson(u) };
}

const USER_COLS = 'id, email, banned_until, created_at, updated_at, email_confirmed_at';
const authError = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg });

async function handleAuth(req, res, url) {
  const p = url.pathname.replace(/^\/auth\/v1/, '');
  const c = claims(req);
  if (p === '/token' && req.method === 'POST') {
    const b = JSON.parse((await body(req)).toString() || '{}');
    let row;
    if (url.searchParams.get('grant_type') === 'password') {
      const { rows } = await pool.query(
        `select ${USER_COLS}, encrypted_password = extensions.crypt($2, encrypted_password) as ok
         from auth.users where email = lower($1)`, [b.email ?? '', b.password ?? '']);
      row = rows[0];
      if (!row || !row.ok) return authError(res, 400, 'invalid_credentials', 'Invalid login credentials');
    } else {
      const id = refreshTokens.get(b.refresh_token);
      if (!id) return authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      refreshTokens.delete(b.refresh_token);
      ({ rows: [row] } = await pool.query(`select ${USER_COLS} from auth.users where id = $1`, [id]));
    }
    if (row.banned_until && new Date(row.banned_until) > new Date()) return authError(res, 400, 'user_banned', 'User is banned');
    return send(res, 200, session(row));
  }
  if (p === '/user' && (req.method === 'GET' || req.method === 'PUT')) {
    if (!c?.sub) return authError(res, 401, 'bad_jwt', 'invalid JWT');
    if (req.method === 'PUT') {
      const b = JSON.parse((await body(req)).toString() || '{}');
      if (b.password) {
        if (b.password.length < 8) return authError(res, 422, 'weak_password', 'Password should be at least 8 characters.');
        const { rows } = await pool.query(
          'select encrypted_password = extensions.crypt($2, encrypted_password) as same from auth.users where id = $1', [c.sub, b.password]);
        if (rows[0]?.same) return authError(res, 422, 'same_password', 'New password should be different from the old password.');
        await pool.query(
          "update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')), updated_at = now() where id = $1",
          [c.sub, b.password]);
      }
    }
    const { rows } = await pool.query(`select ${USER_COLS} from auth.users where id = $1`, [c.sub]);
    if (!rows[0]) return authError(res, 404, 'user_not_found', 'User not found');
    return send(res, 200, userJson(rows[0]));
  }
  if (p === '/logout') return send(res, 204);
  if (p.startsWith('/admin/users')) {
    if (c?.role !== 'service_role') return authError(res, 403, 'not_admin', 'User not allowed');
    const id = p.split('/')[3];
    if (req.method === 'POST' && !id) {
      const b = JSON.parse((await body(req)).toString() || '{}');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email ?? '')) return authError(res, 400, 'validation_failed', 'Unable to validate email address: invalid format');
      try {
        const { rows } = await pool.query(
          `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
           values (gen_random_uuid(), lower($1), extensions.crypt($2, extensions.gen_salt('bf')), now(), '{}', '{}')
           returning ${USER_COLS}`, [b.email, b.password]);
        return send(res, 200, userJson(rows[0]));
      } catch (e) {
        if (e.code === '23505') return authError(res, 422, 'email_exists', 'A user with this email address has already been registered');
        throw e;
      }
    }
    if (req.method === 'PUT' && id) {
      const b = JSON.parse((await body(req)).toString() || '{}');
      if (b.email) {
        try {
          await pool.query('update auth.users set email = lower($2), updated_at = now() where id = $1', [id, b.email]);
        } catch (e) {
          if (e.code === '23505') return authError(res, 422, 'email_exists', 'A user with this email address has already been registered');
          throw e;
        }
      }
      if (b.password) {
        await pool.query("update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')), updated_at = now() where id = $1", [id, b.password]);
      }
      if (b.ban_duration) {
        await pool.query(
          `update auth.users set banned_until = case when $2 = 'none' then null else now() + ($2)::interval end where id = $1`,
          [id, b.ban_duration.replace(/h$/, ' hours')]);
      }
      const { rows } = await pool.query(`select ${USER_COLS} from auth.users where id = $1`, [id]);
      return rows[0] ? send(res, 200, userJson(rows[0])) : authError(res, 404, 'user_not_found', 'User not found');
    }
    if (req.method === 'DELETE' && id) {
      await pool.query('delete from auth.users where id = $1', [id]);
      return send(res, 200, {});
    }
  }
  return authError(res, 404, 'not_found', `auth endpoint not emulated: ${req.method} ${p}`);
}

// ---------------- Storage ----------------
async function asCaller(c, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (c?.role !== 'service_role') {
      await client.query(`set local role ${c?.sub ? 'authenticated' : 'anon'}`);
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(c ?? { role: 'anon' })]);
    }
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const storageError = (res, status, error, message) => send(res, status === 404 ? 400 : status, { statusCode: String(status), error, message });

async function handleStorage(req, res, url) {
  const c = claims(req);
  if (!c) return storageError(res, 400, 'invalid_jwt', 'invalid JWT');
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ''));
  let m = /^\/object\/list\/([^/]+)$/.exec(p);
  if (m && req.method === 'POST') {
    const b = JSON.parse((await body(req)).toString() || '{}');
    const prefix = (b.prefix ?? '').replace(/\/$/, '');
    const rows = await asCaller(c, (db) => db.query(
      `select name, id, created_at, updated_at, metadata from storage.objects
       where bucket_id = $1 and name like $2 and name like $3 order by name limit $4`,
      [m[1], prefix ? `${prefix}/%` : '%', `%${b.search ?? ''}%`, b.limit ?? 100]).then((r) => r.rows));
    return send(res, 200, rows.map((r) => ({ ...r, name: prefix ? r.name.slice(prefix.length + 1) : r.name })));
  }
  m = /^\/object\/([^/]+)\/(.+)$/.exec(p);
  if (!m) return storageError(res, 404, 'not_found', 'route not emulated');
  const [, bucket, name] = m;
  const file = path.join(STORAGE_DIR, bucket, name);
  if (!file.startsWith(path.join(STORAGE_DIR, bucket) + path.sep)) return storageError(res, 400, 'invalid_key', 'bad key');

  if (req.method === 'POST' || req.method === 'PUT') {
    const raw = await body(req);
    const form = await new Request('http://local/', {
      method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: raw,
    }).formData();
    const blob = form.get('');
    if (!blob || typeof blob === 'string') return storageError(res, 400, 'invalid_body', 'no file');
    const bytes = Buffer.from(await blob.arrayBuffer());
    const { rows: [b] } = await pool.query('select file_size_limit, allowed_mime_types from storage.buckets where id = $1', [bucket]);
    if (!b) return storageError(res, 404, 'not_found', 'Bucket not found');
    if (b.file_size_limit && bytes.length > Number(b.file_size_limit)) return storageError(res, 413, 'Payload too large', 'The object exceeded the maximum allowed size');
    if (b.allowed_mime_types && !b.allowed_mime_types.includes(blob.type)) return storageError(res, 415, 'invalid_mime_type', `mime type ${blob.type} is not supported`);
    try {
      const id = await asCaller(c, (db) => db.query(
        `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
         values ($1, $2, $3::uuid, $4::text, jsonb_build_object('mimetype', $5::text, 'size', $6::int)) returning id`,
        [bucket, name, c.sub ?? null, c.sub ?? null, blob.type, bytes.length]).then((r) => r.rows[0].id));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
      return send(res, 200, { Key: `${bucket}/${name}`, Id: id });
    } catch (e) {
      if (e.code === '42501') return storageError(res, 403, 'Unauthorized', 'new row violates row-level security policy');
      if (e.code === '23505') return storageError(res, 409, 'Duplicate', 'The resource already exists');
      throw e;
    }
  }
  if (req.method === 'GET') {
    const rows = await asCaller(c, (db) => db.query(
      'select metadata from storage.objects where bucket_id = $1 and name = $2', [bucket, name]).then((r) => r.rows));
    if (!rows.length) return storageError(res, 404, 'not_found', 'Object not found');
    const data = await fs.readFile(file).catch(() => null);
    if (!data) return storageError(res, 404, 'not_found', 'Object not found');
    return send(res, 200, data, { 'content-type': rows[0].metadata?.mimetype ?? 'application/octet-stream' });
  }
  return storageError(res, 405, 'method', 'method not emulated');
}

// ---------------- proxy ----------------
async function proxy(req, res, target, rewriteAuth) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  if (rewriteAuth) {
    const c = claims(req);
    const token = bearer(req);
    headers.authorization = `Bearer ${token && verify(token) ? token : c?.role === 'anon' || !c ? ANON_JWT : token}`;
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const r = await fetch(target, { method: req.method, headers, body: hasBody ? await body(req) : undefined });
  const out = Buffer.from(await r.arrayBuffer());
  const pass = {};
  for (const [k, v] of r.headers) if (['content-type', 'content-range', 'preference-applied', 'location'].includes(k)) pass[k] = v;
  res.writeHead(r.status, pass);
  res.end(out);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type, x-upsert, prefer, range, accept-profile, content-profile, x-supabase-api-version, x-retry-count');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'content-range, content-type');
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname.startsWith('/rest/v1/')) return await proxy(req, res, POSTGREST + url.pathname.slice(8) + url.search, true);
    if (url.pathname.startsWith('/auth/v1/')) return await handleAuth(req, res, url);
    if (url.pathname.startsWith('/storage/v1/')) return await handleStorage(req, res, url);
    const fm = /^\/functions\/v1\/([\w-]+)/.exec(url.pathname);
    if (fm && FUNCTIONS[fm[1]]) return await proxy(req, res, FUNCTIONS[fm[1]] + url.search, false);
    return send(res, 404, { message: 'not emulated' });
  } catch (e) {
    console.error('gateway error', req.method, url.pathname, e);
    return send(res, 500, { message: String(e?.message ?? e) });
  }
});

export function listen() {
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
}

export function close() {
  server.close();
  return pool.end();
}
