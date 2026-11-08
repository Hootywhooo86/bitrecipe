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
