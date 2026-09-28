import { LIMITS } from '../../shared/constants';

export interface PreparedImage {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  data: string; // base64 without the data: prefix
  width: number;
  height: number;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Kunne ikke lese bildet. Velg en JPG-, PNG- eller WebP-fil.'));
    };
    img.src = url;
  });
}

/**
 * Scales an image down on the device (max `maxSide` px) and re-encodes it as JPEG, so uploads stay
 * small and any metadata (GPS position etc.) is stripped before it leaves the phone.
 */
export async function prepareImage(file: File, maxSide = 1600): Promise<PreparedImage> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) {
    throw new Error('Velg et bilde (JPG, PNG eller WebP).');
  }
  if (file.size > 25 * 1024 * 1024) throw new Error('Bildet er for stort (maks 25 MB før komprimering).');
  const img = await loadImage(file);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(16, Math.round(img.naturalWidth * scale));
  const height = Math.max(16, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Nettleseren kan ikke behandle bildet.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  for (const quality of [0.86, 0.78, 0.68, 0.55]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bytes = Math.floor((data.length * 3) / 4);
    if (bytes <= LIMITS.imageMaxBytes) return { mime: 'image/jpeg', data, width, height };
  }
  throw new Error('Bildet er for stort selv etter komprimering. Prøv et mindre bilde.');
}
