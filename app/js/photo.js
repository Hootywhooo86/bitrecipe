// Recipe photos: the real picture, resized to 640px wide and saved as a
// JPEG (~30 KB) inside the recipe, so it keeps working after the original
// link expires and still syncs quickly between devices.

const MAX_W = 640, MAX_H = 480, QUALITY = 0.72;
export const PHOTO_VERSION = 2; // 1 = old pixel-art photos

async function loadBitmap(url) {
  // Native app: CapacitorHttp fetch gives same-origin bytes (no canvas taint).
  try {
    const res = await fetch(url);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size && /^image\//.test(blob.type || 'image/')) return await createImageBitmap(blob);
    }
  } catch { /* fall back to a CORS image */ }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export async function makePhoto(url) {
  if (!url) return null;
  try {
    const src = await loadBitmap(url);
    const sw = src.width, sh = src.height;
    // centre-crop very tall images (TikTok covers are 9:16) to 4:3, then shrink
    const cropH = Math.min(sh, sw * 0.75);
    const scale = Math.min(1, MAX_W / sw, MAX_H / cropH);
    const c = document.createElement('canvas');
    c.width = Math.round(sw * scale); c.height = Math.round(cropH * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, (sh - cropH) / 2, sw, cropH, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', QUALITY);
  } catch {
    return null; // unreadable image: the card just shows no photo
  }
}

// A photo of a recipe page for the AI to read: up to 1600 px on the long side,
// JPEG, as base64 (no data: prefix). Big enough to read small print.
export async function imageForAI(file) {
  const url = URL.createObjectURL(file);
  try {
    const src = await loadBitmap(url);
    const scale = Math.min(1, 1600 / Math.max(src.width, src.height));
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return { mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.82).split(',')[1], preview: c.toDataURL('image/jpeg', 0.5) };
  } finally { URL.revokeObjectURL(url); }
}
