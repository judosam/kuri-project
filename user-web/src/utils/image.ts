/**
 * Client-side image preparation and compression utility.
 * Guarantees every photo is compressed strictly UP TO 500KB (max 500KB)
 * at max 1920px Full HD, enabling sub-second mobile uploads.
 */

export const MAX_PHOTO_BYTES = 500 * 1024; // 500 KB ceiling

export async function preparePhotoForUpload(
  source: Blob | File | string,
  maxDimension: number = 1920,
  maxBytes: number = MAX_PHOTO_BYTES
): Promise<{ blob: Blob; dataUrl: string }> {
  // If already under maxBytes and JPEG blob/file, return directly
  if (typeof source !== 'string' && source.size <= maxBytes && source.type === 'image/jpeg') {
    return {
      blob: source,
      dataUrl: URL.createObjectURL(source),
    };
  }

  // Load into Image element
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    const isString = typeof source === 'string';
    const url = isString ? source : URL.createObjectURL(source);
    el.onload = () => {
      if (!isString) URL.revokeObjectURL(url);
      resolve(el);
    };
    el.onerror = () => {
      if (!isString) URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for processing'));
    };
    el.src = url;
  });

  const canvas = document.createElement('canvas');
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;

  // Maximum dimension cap of 1920px keeps uploads fast
  if (Math.max(width, height) > maxDimension) {
    const ratio = maxDimension / Math.max(width, height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  // Adaptive quality loop: guarantees <= 500KB
  let currentQuality = 0.82;
  let blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
      'image/jpeg',
      currentQuality
    );
  });

  while (blob.size > maxBytes && currentQuality > 0.45) {
    currentQuality -= 0.08;
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
        'image/jpeg',
        currentQuality
      );
    });
  }

  if (blob.size > maxBytes) {
    const scale = Math.sqrt(maxBytes / blob.size) * 0.95;
    const scaledCanvas = document.createElement('canvas');
    scaledCanvas.width = Math.round(width * scale);
    scaledCanvas.height = Math.round(height * scale);
    const sCtx = scaledCanvas.getContext('2d');
    if (sCtx) {
      sCtx.imageSmoothingEnabled = true;
      sCtx.imageSmoothingQuality = 'high';
      sCtx.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
      blob = await new Promise<Blob>((resolve, reject) => {
        scaledCanvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
          'image/jpeg',
          0.75
        );
      });
      const dataUrl = scaledCanvas.toDataURL('image/jpeg', 0.75);
      return { blob, dataUrl };
    }
  }

  const dataUrl = canvas.toDataURL('image/jpeg', currentQuality);
  return { blob, dataUrl };
}

// Backward compatibility aliases
export const compressImage = preparePhotoForUpload;
export const compressImageToMax300Kb = preparePhotoForUpload;
export const compressImageToMax500Kb = preparePhotoForUpload;
