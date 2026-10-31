// ส่งแจ้งเตือนใบลาเข้ากลุ่ม LINE (Messaging API push + Flex Message)
// ถูกเรียกจาก trigger ในฐานข้อมูลผ่าน pg_net ด้วย body { id, token } ของแถวใน line_notifications
// deploy แบบ verify_jwt = false: ผู้เรียกพิสูจน์ตัวด้วย token สุ่มของแถวนั้น (อยู่ในฐานข้อมูลเท่านั้น)
// และเนื้อหาข้อความอ่านจากฐานข้อมูลเสมอ ผู้เรียกกำหนดเนื้อหาเองไม่ได้
//
// secrets: LINE_CHANNEL_ACCESS_TOKEN, LINE_GROUP_MAIN, LINE_GROUP_FINAL (คั่นด้วย , ส่งเมื่อ ผอ. อนุญาต), SITE_URL
import { json, serviceClient } from '../_shared/supabase.ts';

type Payload = {
  leave_id: number;
  name: string;
  type_label: string;
  from_date: string;
  to_date: string;
  total_days: number;
  half_day: boolean;
  status: string;
  actor_step: 'hr' | 'deputy' | 'director' | null;
};

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const STEP_LABEL = { hr: 'หัวหน้าฝ่ายบุคลากร', deputy: 'รองผู้อำนวยการ', director: 'ผู้อำนวยการ' };
const WAITING: Record<string, string> = {
  pending_hr: 'รอหัวหน้าฝ่ายบุคลากรอนุมัติ',
  pending_deputy: 'รอรองผู้อำนวยการอนุมัติ',
  pending_director: 'รอผู้อำนวยการอนุมัติ',
};

function thDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y + 543}`;
}

function days(p: Payload): string {
  if (p.half_day) return 'ครึ่งวัน (0.5 วัน)';
  const n = Number(p.total_days);
  return `${Number.isInteger(n) ? n : n.toFixed(1)} วัน`;
}

function row(label: string, value: string) {
  return {
    type: 'box', layout: 'baseline', spacing: 'sm',
    borderWidth: '1px', borderColor: '#d0d5dd', cornerRadius: 'md', paddingAll: '8px',
    contents: [
      { type: 'text', text: label, color: '#000000', weight: 'bold', size: 'sm', flex: 2 },
      { type: 'text', text: value, color: '#222222', size: 'sm', flex: 5, wrap: true },
    ],
  };
}

// ผสมสีกับสีขาวให้อ่อนลง (t = สัดส่วนสีขาว) ใช้กับพื้นปุ่มเพื่อให้ตัวอักษรสีดำอ่านชัด
function lighten(hex: string, t: number): string {
  const c = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t) + 255 * t));
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function buildMessage(event: string, p: Payload, siteUrl: string) {
  const dateText = p.from_date === p.to_date
    ? thDate(p.from_date)
    : `${thDate(p.from_date)} – ${thDate(p.to_date)}`;

  let title: string;
  let color: string;
  let titleColor = '#ffffff';
  let subColor = '#ffffffcc';
  let status: string;
  let button: { label: string; uri: string } | null = null;
  if (event === 'approved') {
    title = 'ผู้อำนวยการอนุญาตแล้ว';
    color = '#1e8e3e';
    status = 'อนุญาตแล้ว';
    if (siteUrl) button = { label: 'เปิดใบลา', uri: `${siteUrl}/#/leave/${p.leave_id}/form` };
  } else if (event === 'rejected') {
    // ห้ามใส่เหตุผลการลาและเหตุผลที่ไม่อนุมัติลงกลุ่ม
    title = 'ใบลาไม่ได้รับอนุมัติ';
    color = '#c5221f';
    status = p.actor_step ? `ไม่อนุมัติโดย${STEP_LABEL[p.actor_step]}` : 'ไม่อนุมัติ';
    if (siteUrl) button = { label: 'ดูรายละเอียด', uri: `${siteUrl}/#/leave/${p.leave_id}` };
  } else {
    title = event === 'submitted'
      ? 'ใบลาใหม่'
      : `${p.actor_step ? STEP_LABEL[p.actor_step] : 'ผู้อนุมัติ'}อนุมัติแล้ว`;
    color = event === 'submitted' ? '#1a73e8' : '#e37400';
    if (event !== 'submitted' && p.actor_step === 'hr') {
      // หัวหน้าฝ่ายบุคลากรอนุมัติแล้ว = สีเหลือง (ตัวอักษรเข้มเพื่อให้อ่านชัด)
      color = '#f9c200';
      titleColor = '#202124';
      subColor = '#202124b3';
    }
    if (event !== 'submitted' && p.actor_step === 'deputy') color = '#8e24aa'; // รองผู้อำนวยการอนุมัติแล้ว = สีม่วง
    status = WAITING[p.status] ?? p.status;
    if (siteUrl) button = { label: 'เปิดหน้าอนุมัติ', uri: `${siteUrl}/#/approvals` };
  }

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '12px',
      contents: [
        { type: 'text', text: title, color: titleColor, weight: 'bold', size: 'md', wrap: true },
        { type: 'text', text: 'ระบบใบลาออนไลน์', color: subColor, size: 'xxs' },
      ],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
      contents: [
        row('ผู้ลา', p.name),
        row('ประเภท', p.type_label),
        row('วันที่', dateText),
        row('จำนวน', days(p)),
        row('สถานะ', status),
      ],
    },
  };
  if (button) {
    bubble.footer = {
      type: 'box', layout: 'vertical', paddingAll: '10px',
      // ปุ่มมาตรฐานของ LINE เปลี่ยนสีตัวอักษรไม่ได้ จึงใช้กล่องกดได้ที่มีตัวอักษรสีดำตัวหนาแทน (ทุกการ์ด)
      contents: [{
        type: 'box', layout: 'vertical', backgroundColor: lighten(color, 0.55), borderWidth: '2px', borderColor: color, cornerRadius: 'md', paddingAll: '10px',
        action: { type: 'uri', ...button },
        contents: [{ type: 'text', text: button.label, color: '#000000', weight: 'bold', align: 'center', size: 'md' }],
      }],
    };
  }
  return {
    type: 'flex',
    altText: `ใบลาของ ${p.name} (${p.type_label} ${dateText}) — ${status}`.slice(0, 400),
    contents: bubble,
  };
}

// X-Line-Retry-Key ต้องเป็น UUID: สร้างจาก token ของแถว + กลุ่มปลายทาง (ส่งซ้ำแล้วไม่เบิ้ล)
async function retryKey(seed: string): Promise<string> {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed))).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function push(accessToken: string, to: string, message: unknown, key: string): Promise<string> {
  const send = () =>
    fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Line-Retry-Key': key,
      },
      body: JSON.stringify({ to, messages: [message] }),
    });
  let res: Response;
  try {
    res = await send();
  } catch {
    res = await send(); // เครือข่ายสะดุดครั้งเดียว ลองใหม่ด้วย retry key เดิม
  }
  const masked = to.length > 8 ? `${to.slice(0, 4)}…${to.slice(-4)}` : '…';
  // 409 = LINE รับคำขอนี้ไปแล้ว (retry key ซ้ำ) ถือว่าส่งสำเร็จ
  if (res.ok || res.status === 409) return `${masked}:ok`;
  return `${masked}:${res.status} ${(await res.text()).slice(0, 200)}`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  let body: { id?: unknown; token?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad request' });
  }
  const id = Number(body.id);
  const token = typeof body.token === 'string' ? body.token : '';
  if (!Number.isSafeInteger(id) || !/^[0-9a-f-]{36}$/.test(token)) return json(400, { error: 'bad request' });

  const db = serviceClient();
  // จองแถว (queued → sending) แบบอะตอมมิก กันส่งซ้ำ
  const { data: claimed, error: claimErr } = await db.from('line_notifications')
    .update({ status: 'sending' })
    .eq('id', id).eq('token', token).eq('status', 'queued')
    .select('id, event, payload');
  if (claimErr) {
    console.error('claim failed', claimErr.code, claimErr.message);
    return json(500, { error: 'claim failed' });
  }
  if (!claimed?.length) return json(404, { error: 'not found' });
  const n = claimed[0] as { id: number; event: string; payload: Payload };

  const finish = (status: 'sent' | 'failed', result: string) =>
    db.from('line_notifications')
      .update({ status, result: result.slice(0, 1000), sent_at: status === 'sent' ? new Date().toISOString() : null })
      .eq('id', id);

  const accessToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? '';
  const mainGroup = (Deno.env.get('LINE_GROUP_MAIN') ?? '').trim();
  const finalGroups = (Deno.env.get('LINE_GROUP_FINAL') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').trim().replace(/\/+$/, '').replace(/\/#.*$/, '');
  if (!accessToken || !mainGroup) {
    await finish('failed', 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN / LINE_GROUP_MAIN');
    return json(200, { ok: false });
  }

  // ผอ. อนุญาตแล้ว → ส่งกลุ่มหลัก + ทุกกลุ่มใน LINE_GROUP_FINAL (กลุ่มที่ 2) โดยไม่ซ้ำกัน; อย่างอื่นส่งกลุ่มหลัก
  const targets = [...new Set(n.event === 'approved' ? [mainGroup, ...finalGroups] : [mainGroup])];
  const message = buildMessage(n.event, n.payload, siteUrl);
  const results: string[] = [];
  for (const to of targets) {
    try {
      results.push(await push(accessToken, to, message, await retryKey(`${token}:${to}`)));
    } catch (e) {
      results.push(`error ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
    }
  }
  const ok = results.every((r) => r.endsWith(':ok'));
  await finish(ok ? 'sent' : 'failed', results.join('; '));
  if (!ok) console.error('line push failed', id, results.join('; '));
  return json(200, { ok });
});
