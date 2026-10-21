// ช่องเซ็นชื่อบนจอ (signature_pad จาก vendor/) พร้อมปรับขนาดตามจอและความละเอียดหน้าจอ
import { h } from '../ui.js';
import { trimCanvas, canvasPng } from './image.js';

export function signatureField() {
  const canvas = h('canvas', { class: 'sig-canvas', 'aria-label': 'ช่องเซ็นชื่อ' });
  const pad = new window.SignaturePad(canvas, {
    penColor: '#10265c',
    minWidth: 0.9,
    maxWidth: 2.6,
    backgroundColor: 'rgba(0,0,0,0)',
  });

  const resize = () => {
    if (!canvas.offsetWidth) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const data = pad.toData();
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d').scale(ratio, ratio);
    pad.clear();
    pad.fromData(data);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const clear = h('button', { type: 'button', class: 'btn ghost small', onclick: () => pad.clear() }, 'ล้างลายเซ็น');
  const el = h('div', { class: 'sig-box' }, canvas, h('div', { class: 'sig-tools' },
    h('small', { class: 'muted' }, 'ใช้นิ้วหรือปากกาเซ็นชื่อในกรอบ'), clear));

  return {
    el,
    isEmpty: () => pad.isEmpty() || pad.toData().reduce((n, s) => n + s.points.length, 0) < 8,
    toBlob() {
      let c = trimCanvas(canvas, 10);
      if (c.width > 900) { // จอความละเอียดสูงได้รูปใหญ่เกินจำเป็น
        const out = document.createElement('canvas');
        out.width = 900;
        out.height = Math.max(1, Math.round(c.height * (900 / c.width)));
        out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
        c = out;
      }
      return canvasPng(c);
    },
    destroy() {
      ro.disconnect();
      pad.off();
    },
  };
}
