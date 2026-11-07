// Recipe photos, 128-bit style: the image is shrunk to a small pixel grid,
// limited to a chunky palette, and stored as a tiny PNG (a few KB) so it
// lasts even when the original link expires and never fills storage.

const W = 96, H = 64;

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

export async function pixelPhoto(url) {
  if (!url) return null;
  try {
    const src = await loadBitmap(url);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const sw = src.width, sh = src.height;
    const scale = Math.max(W / sw, H / sh); // cover-crop
    const cw = W / scale, ch = H / scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H);
    // posterize to 6 levels per channel for that console palette feel
    for (let i = 0; i < d.data.length; i += 4) for (let k = 0; k < 3; k++) d.data[i + k] = Math.round(d.data[i + k] / 51) * 51;
    ctx.putImageData(d, 0, 0);
    return c.toDataURL('image/png');
  } catch {
    return null; // unreadable image: the card just shows no photo
  }
}
