// บีบรูปฝั่งเบราว์เซอร์ก่อนอัปโหลด (ประหยัดพื้นที่ Storage 1 GB ของแพ็กเกจ Free)

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('แปลงรูปไม่สำเร็จ'))), type, quality);
  });
}

async function decode(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // ตกไปใช้ <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('เปิดไฟล์รูปนี้ไม่ได้ กรุณาเลือกรูปแบบ JPG หรือ PNG');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// รูปถ่าย/สแกน → JPEG ด้านยาวไม่เกิน maxSide พยายามให้ไม่เกิน maxBytes
export async function compressPhoto(file, { maxSide = 1600, maxBytes = 300_000 } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('กรุณาเลือกไฟล์รูปภาพ');
  const img = await decode(file);
  const w = img.width;
  const hgt = img.height;
  let scale = Math.min(1, maxSide / Math.max(w, hgt));
  let blob;
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(hgt * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // JPEG ไม่มีพื้นโปร่งใส
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    blob = await canvasToBlob(canvas, 'image/jpeg', attempt < 3 ? 0.82 - attempt * 0.1 : 0.6);
    if (blob.size <= maxBytes) break;
    if (attempt >= 2) scale *= 0.8;
  }
  img.close?.();
  return blob;
}

// ลายเซ็นผู้อนุมัติที่แอดมินอัปโหลด → PNG (คงพื้นโปร่งใส) กว้างไม่เกิน maxSide
export async function preparePng(file, { maxSide = 900 } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('กรุณาเลือกไฟล์รูปภาพ');
  const img = await decode(file);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close?.();
  return canvasToBlob(trimCanvas(canvas, 6), 'image/png');
}

// ตัดขอบว่าง/โปร่งใสรอบลายเซ็น เพื่อวางบนใบลาได้พอดีเส้น
export function trimCanvas(src, pad = 8) {
  const ctx = src.getContext('2d');
  const { width, height } = src;
  const { data } = ctx.getImageData(0, 0, width, height);
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      // นับเป็นหมึกถ้าไม่โปร่งใสและไม่ใช่สีขาว
      if (a > 20 && !(data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245)) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return src;
  const x0 = Math.max(0, left - pad);
  const y0 = Math.max(0, top - pad);
  const w = Math.min(width, right + pad + 1) - x0;
  const hgt = Math.min(height, bottom + pad + 1) - y0;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = hgt;
  out.getContext('2d').drawImage(src, x0, y0, w, hgt, 0, 0, w, hgt);
  return out;
}

export function canvasPng(canvas) {
  return canvasToBlob(canvas, 'image/png');
}
