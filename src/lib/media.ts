import { LIMITS } from './config';
import type { MediaType } from './types';

export class MediaError extends Error {}

export function mediaTypeOf(file: File): MediaType | null {
  if (LIMITS.imageTypes.includes(file.type)) return 'image';
  if (LIMITS.videoTypes.includes(file.type)) return 'video';
  if (LIMITS.audioTypes.some((t) => file.type.startsWith(t.split(';')[0]))) return 'audio';
  return null;
}

/** Validates type & size. Throws MediaError with a user-facing message. */
export function validateMedia(file: File): MediaType {
  const type = mediaTypeOf(file);
  if (!type) throw new MediaError(`“${file.name}” isn’t a supported file. Use JPG, PNG, WebP or HEIC photos, MP4/WebM video, or a voice note.`);
  const max = type === 'image' ? LIMITS.maxImageBytes : type === 'video' ? LIMITS.maxVideoBytes : LIMITS.maxAudioBytes;
  if (file.size > max) throw new MediaError(`“${file.name}” is ${(file.size / 1048576).toFixed(1)} MB — the limit for ${type}s is ${max / 1048576} MB.`);
  if (file.size === 0) throw new MediaError(`“${file.name}” is empty.`);
  return type;
}

/** Checks magic bytes so a renamed file can't masquerade as an image. */
function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

export async function sniffImage(file: File): Promise<boolean> {
  const buf = new Uint8Array(await readBytes(file.slice(0, 12)));
  const hex = Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
  return (
    hex.startsWith('ffd8ff') || // jpeg
    hex.startsWith('89504e47') || // png
    (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') || // webp
    hex.slice(8, 16) === '66747970' // heic/heif (ftyp)
  );
}

export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

/** Compresses photos client-side (also strips EXIF incl. GPS of the original). */
export async function compressImage(file: File, onProgress?: (p: number) => void): Promise<File> {
  if (file.type === 'image/heic' || file.type === 'image/heif') return file;
  if (typeof createImageBitmap === 'undefined' || /jsdom/i.test(navigator.userAgent)) return file;
  try {
    const { default: imageCompression } = await import('browser-image-compression');
    const out = await withTimeout(imageCompression(file, {
      maxSizeMB: 1.2,
      maxWidthOrHeight: 2048,
      useWebWorker: true,
      fileType: 'image/jpeg',
      initialQuality: 0.82,
      onProgress,
    }), 20000, file);
    if (out === file) return file;
    return new File([out], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
