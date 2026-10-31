import { h, mount, loading, toast, errorText, fmtDays, dialog, STATUS_LABEL } from '../ui.js';
import { sb } from '../supabase.js';
import { rpc, query, leaveTypes, upload } from '../api.js';
import { navigate } from '../router.js';
import { thDate, thRange, todayISO } from '../lib/thai-date.js';
import { daysText } from './parts.js';
import { compressPhoto } from '../lib/image.js';
import { signatureField } from '../lib/signature.js';

export default async function leaveNew(el, _params, { profile }) {
  mount(el, loading());
  const [types, last, balances, approved] = await Promise.all([
    leaveTypes(),
    query(sb.from('leaves').select('contact_phone').eq('user_id', profile.id)
      .order('created_at', { ascending: false }).limit(1)),
    rpc('my_balances'),
    query(sb.from('leaves').select('leave_type, from_date, to_date, total_days, half_day').eq('user_id', profile.id)
      .eq('status', 'approved').order('from_date', { ascending: false }).order('id', { ascending: false }).limit(300)),
  ]);

  // การลาล่าสุดของตัวเองทุกประเภท: ใบที่อนุญาตแล้วล่าสุด + ยอดที่ลามาแล้วในรอบปัจจุบัน (ครั้ง / วัน)
  const lastByType = {};
  for (const l of approved) lastByType[l.leave_type] ??= l;
  const countByType = Object.fromEntries((balances.types ?? []).map((t) => [t.code, t]));
  const history = h('section', { class: 'card stack' },
    h('h2', {}, 'การลาล่าสุดของฉัน'),
    h('table', { class: 'table responsive type-table' },
      h('thead', {}, h('tr', {}, ['ประเภทการลา', 'ลาล่าสุด', balances.round ? `ลามาแล้วในรอบ ${balances.round.label} (ครั้ง / วัน)` : 'ลามาแล้ว (ครั้ง / วัน)']
        .map((t) => h('th', {}, t)))),
      h('tbody', {}, types.map((t, i) => {
        const l = lastByType[t.code];
        const c = countByType[t.code];
        const times = Number(c?.approved_times ?? 0);
        return h('tr', { class: `tc-${i % 6}` }, // กรอบสีประจำประเภท ไม่ซ้ำกัน (เรียงตามลำดับประเภท)
          h('td', { 'data-label': 'ประเภทการลา' }, h('strong', {}, t.label)),
          h('td', { 'data-label': 'ลาล่าสุด' }, l ? `${thRange(l.from_date, l.to_date)} (${daysText(l)})` : '-'),
          h('td', { 'data-label': 'ครั้ง / วัน' }, times ? `${times} / ${fmtDays(c.approved_days)}` : '-'));
      }))),
    h('small', { class: 'muted' }, 'นับเฉพาะใบที่ผู้อำนวยการอนุญาตแล้ว'));
  const today = todayISO();

  // ---------- ช่องกรอก ----------
  const typeSelect = h('select', { id: 'leave-type', name: 'leave_type', required: true },
    h('option', { value: '' }, '— เลือกประเภทการลา —'),
    types.map((t) => h('option', { value: t.code }, t.label)));
  const typeGroup = h('div', { class: 'field' }, h('label', { for: 'leave-type' }, 'ประเภทการลา'), typeSelect);

  const from = h('input', { type: 'date', id: 'from', required: true, value: today });
  const to = h('input', { type: 'date', id: 'to', required: true, value: today });
  const fromText = h('small', { class: 'hint' });
  const toText = h('small', { class: 'hint' });
  const full = h('input', { type: 'radio', name: 'portion', value: 'full', checked: true });
  const half = h('input', { type: 'radio', name: 'portion', value: 'half' });
  const portion = h('fieldset', { class: 'field choices inline' },
    h('legend', {}, 'ลา 1 วัน'),
    h('label', { class: 'choice' }, full, h('span', {}, 'เต็มวัน')),
    h('label', { class: 'choice' }, half, h('span', {}, 'ครึ่งวัน')));

  const preview = h('div', { class: 'preview', 'aria-live': 'polite' });
  const reason = h('textarea', { id: 'reason', rows: '3', maxlength: '1000', required: true });
  const contact = h('input', {
    id: 'contact', type: 'text', inputmode: 'tel', maxlength: '200', required: true,
    autocomplete: 'tel', value: last[0]?.contact_phone ?? '',
  });

  const certInput = h('input', { type: 'file', id: 'cert', accept: 'image/*' });
  const certPreview = h('div', { class: 'cert-preview' });
  const certHint = h('small', { class: 'hint' }, 'ไม่บังคับ — รูปถูกย่อขนาดอัตโนมัติก่อนส่ง');
  let certBlob = null;

  const sig = signatureField();
  const formError = h('div', { class: 'alert error', role: 'alert', hidden: true });
  const progress = h('p', { class: 'muted small center', 'aria-live': 'polite' });
  const submitBtn = h('button', { type: 'submit', class: 'btn primary block big' }, 'ส่งใบลา');

  // ---------- จำนวนวันจากเซิร์ฟเวอร์ (เซิร์ฟเวอร์เป็นผู้ตัดสิน) ----------
  let previewSeq = 0;
  let lastPreview = null;
  let timer;
  const selectedType = () => typeSelect.value || null;
  const isHalf = () => from.value && from.value === to.value && half.checked;

  function showPreview(res) {
    const items = [];
    if (res.ok) {
      items.push(h('p', { class: 'preview-days' },
        'นับเป็น ', h('strong', {}, fmtDays(res.total_days)), ' วัน',
        isHalf() ? ' (ครึ่งวัน)' : ''));
      const calendar = types.find((t) => t.code === selectedType())?.count_calendar_days;
      items.push(h('p', { class: 'muted small' }, calendar
        ? 'ประเภทนี้นับทุกวันรวมวันหยุด'
        : 'ไม่นับวันเสาร์-อาทิตย์และวันหยุดที่ตั้งไว้ในระบบ'));
    }
    for (const e of res.errors ?? []) items.push(h('p', { class: 'alert error small' }, e));
    for (const w of res.warnings ?? []) items.push(h('p', { class: 'alert warn small' }, `คำเตือน: ${w}`));
    mount(preview, items);
  }

  async function refreshPreview() {
    fromText.textContent = from.value ? thDate(from.value, { weekday: true }) : '';
    toText.textContent = to.value ? thDate(to.value, { weekday: true }) : '';
    portion.hidden = !(from.value && from.value === to.value);
    const type = selectedType();
    const t = types.find((x) => x.code === type);
    certHint.textContent = t?.requires_cert
      ? 'การลาประเภทนี้ต้องแนบใบรับรองแพทย์'
      : 'ไม่บังคับ — รูปถูกย่อขนาดอัตโนมัติก่อนส่ง';
    if (!type || !from.value || !to.value) {
      lastPreview = null;
      mount(preview, h('p', { class: 'muted small' }, 'เลือกประเภทและวันที่ลาเพื่อดูจำนวนวัน'));
      return;
    }
    const seq = ++previewSeq;
    mount(preview, h('p', { class: 'muted small' }, 'กำลังคำนวณจำนวนวัน…'));
    try {
      const res = await rpc('preview_leave', {
        p_leave_type: type, p_from: from.value, p_to: to.value, p_half_day: isHalf(),
      });
      if (seq !== previewSeq) return;
      lastPreview = res;
      showPreview(res);
    } catch (e) {
      if (seq !== previewSeq) return;
      lastPreview = null;
      mount(preview, h('p', { class: 'alert error small' }, errorText(e)));
    }
  }
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(refreshPreview, 300);
  };

  from.addEventListener('change', () => {
    if (to.value && from.value && to.value < from.value) to.value = from.value;
    schedule();
  });
  to.addEventListener('change', schedule);
  for (const i of [typeSelect, full, half]) i.addEventListener('change', schedule);

  certInput.addEventListener('change', async () => {
    const file = certInput.files?.[0];
    certBlob = null;
    mount(certPreview);
    if (!file) return;
    mount(certPreview, h('small', { class: 'muted' }, 'กำลังย่อรูป…'));
    try {
      certBlob = await compressPhoto(file);
      const url = URL.createObjectURL(certBlob);
      mount(certPreview,
        h('img', { src: url, alt: 'ใบรับรองแพทย์ที่เลือก' }),
        h('div', { class: 'row' },
          h('small', { class: 'muted' }, `${Math.round(certBlob.size / 1024)} KB`),
          h('button', {
            type: 'button', class: 'btn ghost small',
            onclick: () => {
              certBlob = null;
              certInput.value = '';
              URL.revokeObjectURL(url);
              mount(certPreview);
            },
          }, 'เอารูปออก')));
    } catch (e) {
      certInput.value = '';
      mount(certPreview, h('p', { class: 'alert error small' }, errorText(e)));
    }
  });

  // ---------- ส่งใบลา ----------
  async function onSubmit(e) {
    e.preventDefault();
    const fail = (msg) => {
      formError.textContent = msg;
      formError.hidden = false;
      formError.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    formError.hidden = true;
    const type = selectedType();
    if (!type) return fail('กรุณาเลือกประเภทการลา');
    if (!from.value || !to.value) return fail('กรุณาเลือกวันที่ลา');
    if (!reason.value.trim()) return fail('กรุณากรอกเหตุผลการลา');
    if (!contact.value.trim()) return fail('กรุณากรอกเบอร์โทรหรือช่องทางติดต่อระหว่างลา');
    if (types.find((t) => t.code === type)?.requires_cert && !certBlob) {
      return fail('การลาประเภทนี้ต้องแนบใบรับรองแพทย์');
    }
    if (sig.isEmpty()) return fail('กรุณาเซ็นชื่อในช่องลายเซ็น');
    clearTimeout(timer);
    await refreshPreview();
    if (!lastPreview?.ok) return fail(lastPreview?.errors?.[0] ?? 'ตรวจสอบวันที่ลาอีกครั้ง');
    if (lastPreview.warnings?.length) {
      const go = await dialog({
        title: 'ยืนยันส่งใบลา',
        body: [...lastPreview.warnings.map((w) => h('p', { class: 'alert warn' }, w)), h('p', {}, 'ต้องการส่งใบลาต่อหรือไม่')],
        actions: [{ label: 'กลับไปแก้ไข', value: false }, { label: 'ส่งต่อ', value: true }],
      });
      if (!go) return;
    }

    submitBtn.disabled = true;
    try {
      progress.textContent = 'กำลังอัปโหลดลายเซ็น…';
      const sigPath = await upload('leave-signatures', profile.id, await sig.toBlob(), 'png');
      let certPath = null;
      if (certBlob) {
        progress.textContent = 'กำลังอัปโหลดใบรับรองแพทย์…';
        certPath = await upload('leave-certs', profile.id, certBlob, 'jpg');
      }
      progress.textContent = 'กำลังส่งใบลา…';
      const res = await rpc('submit_leave', {
        p_leave_type: type,
        p_from: from.value,
        p_to: to.value,
        p_half_day: isHalf(),
        p_reason: reason.value,
        p_contact_phone: contact.value,
        p_signature_path: sigPath,
        p_cert_path: certPath,
      });
      toast(`ส่งใบลาแล้ว (${fmtDays(res.total_days)} วัน) · ${STATUS_LABEL[res.status] ?? ''}`);
      navigate(`/leave/${res.id}`);
    } catch (err) {
      fail(errorText(err));
    } finally {
      submitBtn.disabled = false;
      progress.textContent = '';
    }
  }

  mount(el,
    h('h1', {}, 'ยื่นใบลา'),
    history,
    h('form', { class: 'card stack', onsubmit: onSubmit, novalidate: true },
      h('div', { class: 'readonly-grid' },
        h('div', {}, h('small', { class: 'muted' }, 'ชื่อ-สกุล'), h('div', {}, profile.full_name)),
        h('div', {}, h('small', { class: 'muted' }, 'ตำแหน่ง'), h('div', {}, profile.position)),
        h('div', {}, h('small', { class: 'muted' }, 'วันที่ยื่น'), h('div', {}, thDate(today)))),
      typeGroup,
      h('div', { class: 'grid-2' },
        h('div', { class: 'field' }, h('label', { for: 'from' }, 'ลาตั้งแต่วันที่'), from, fromText),
        h('div', { class: 'field' }, h('label', { for: 'to' }, 'ถึงวันที่'), to, toText)),
      portion,
      preview,
      h('div', { class: 'field' }, h('label', { for: 'reason' }, 'เนื่องจาก'), reason),
      h('div', { class: 'field' }, h('label', { for: 'contact' }, 'ระหว่างลาติดต่อได้ที่ (เบอร์โทร)'), contact),
      h('div', { class: 'field' }, h('label', { for: 'cert' }, 'แนบใบรับรองแพทย์'), certInput, certHint, certPreview),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'ลายเซ็นผู้ลา'), sig.el),
      formError,
      submitBtn,
      progress));

  refreshPreview();
  return () => sig.destroy();
}
