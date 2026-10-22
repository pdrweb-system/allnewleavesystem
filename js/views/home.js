import { h, mount, loading, fmtDays } from '../ui.js';
import { sb } from '../supabase.js';
import { rpc, query, typeLabels } from '../api.js';
import { canFile, isApprover, ROLE_LABEL } from '../auth.js';
import { thDate } from '../lib/thai-date.js';
import { leaveCard, LEAVE_COLUMNS } from './parts.js';

function balanceCard(t) {
  const used = Number(t.approved_days) + Number(t.pending_days);
  const quota = t.quota_days == null ? null : Number(t.quota_days);
  const pct = quota ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  return h('article', { class: 'balance' },
    h('h3', {}, t.label),
    h('p', { class: 'balance-main' },
      h('span', { class: 'num' }, t.approved_times), ' ครั้ง · ',
      h('span', { class: 'num' }, fmtDays(t.approved_days)), ' วัน'),
    Number(t.pending_times) > 0
      ? h('p', { class: 'small pending-text' }, `รออนุมัติ ${t.pending_times} ครั้ง · ${fmtDays(t.pending_days)} วัน`)
      : h('p', { class: 'small muted' }, 'ไม่มีใบที่รออนุมัติ'),
    quota
      ? h('div', { class: `quota ${used > quota ? 'over' : ''}` },
        h('div', { class: 'quota-bar' }, h('span', { class: 'quota-fill', dataset: { pct: String(pct) } })),
        h('small', {}, `ใช้ ${fmtDays(used)} / ${fmtDays(quota)} วัน${t.quota_mode === 'block' ? ' (เกินไม่ได้)' : ''}`))
      : null);
}

export default async function home(el, _params, { profile }) {
  mount(el, loading());
  const pendingForMe = isApprover(profile)
    ? sb.from('leaves').select('id', { count: 'exact', head: true }).eq('status', `pending_${profile.role}`)
    : null;
  const [balances, mine, labels, pending] = await Promise.all([
    rpc('my_balances'),
    query(sb.from('leaves').select(LEAVE_COLUMNS).eq('user_id', profile.id)
      .order('from_date', { ascending: false }).order('id', { ascending: false }).limit(60)),
    typeLabels(),
    pendingForMe,
  ]);

  const round = balances.round;
  const cards = h('div', { class: 'balances' }, (balances.types ?? []).map(balanceCard));
  // ความกว้างแถบโควตาตั้งผ่าน CSSOM (CSP ไม่อนุญาต style attribute)
  cards.querySelectorAll('.quota-fill').forEach((s) => { s.style.width = `${s.dataset.pct}%`; });

  mount(el,
    h('section', { class: 'hero' },
      h('div', {},
        profile.role !== 'teacher' || profile.is_admin
          ? h('p', { class: 'muted small' }, `${ROLE_LABEL[profile.role]}${profile.is_admin ? ' · แอดมิน' : ''}`)
          : null,
        h('h1', {}, `สวัสดี ${profile.full_name}`),
        h('p', { class: 'muted' }, profile.position)),
      canFile(profile) ? h('a', { class: 'btn primary big', href: '#/leave/new' }, '+ ยื่นใบลา') : null),

    pending && pending.count > 0
      ? h('a', { class: 'callout', href: '#/approvals' },
        h('strong', {}, `มีใบลารอคุณพิจารณา ${pending.count} ใบ`), h('span', {}, 'เปิดกล่องอนุมัติ →'))
      : null,

    h('section', { class: 'section' },
      h('div', { class: 'section-head' },
        h('h2', {}, 'ยอดการลาของฉัน'),
        round
          ? h('span', { class: 'muted small' },
            `รอบ ${round.label} (${thDate(round.start_date, { short: true })} – ${thDate(round.end_date, { short: true })})`)
          : h('span', { class: 'alert warn small' }, 'ยังไม่มีรอบการลาที่ครอบคลุมวันนี้ กรุณาแจ้งแอดมิน')),
      cards,
      h('p', { class: 'muted small' }, 'นับเฉพาะใบที่ผู้อำนวยการอนุญาตแล้ว ส่วนใบที่รออนุมัติแสดงแยกไว้')),

    profile.role === 'director'
      ? h('p', { class: 'alert info' }, 'ใบลาของผู้อำนวยการไม่ได้ยื่นผ่านระบบนี้')
      : h('section', { class: 'section' },
        h('h2', {}, 'ใบลาของฉัน'),
        mine.length
          ? h('div', { class: 'list' }, mine.map((l) => leaveCard(l, labels)))
          : h('p', { class: 'empty' }, 'ยังไม่มีใบลา')));
}
