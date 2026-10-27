/**
 * Client-side image compression for the Admin Portal.
 *
 * Compresses uploaded site photos to strictly UP TO 500KB (max 500KB)
 * at 1920px max dimension, drastically speeding up multi-photo uploads
 * and saving network bandwidth.
 */

export interface CompressionResult {
  file: File;
  previewUrl: string;
}

const MAX_PHOTO_BYTES = 500 * 1024; // 500KB ceiling

export async function compressAdminImage(
  file: File,
  maxDimension: number = 1920,
  initialQuality: number = 0.82,
  maxSizeBytes: number = MAX_PHOTO_BYTES
): Promise<CompressionResult> {
  // If already under 500KB and JPEG, keep as is
  if (file.size <= maxSizeBytes && file.type === 'image/jpeg') {
    return {
      file,
      previewUrl: URL.createObjectURL(file),
    };
  }

  // 1. Use hardware-accelerated createImageBitmap if available
  if (typeof window !== 'undefined' && 'createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
      } as ImageBitmapOptions);

      let { width, height } = bitmap;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        bitmap.close();
        throw new Error('Canvas context unavailable');
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();

      let currentQuality = initialQuality;
      let blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to create blob'))),
          'image/jpeg',
          currentQuality
        );
      });

      // Adaptive quality adjustment: ensure image strictly does not exceed 500KB
      while (blob.size > maxSizeBytes && currentQuality > 0.45) {
        currentQuality -= 0.08;
        blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Failed to create blob'))),
            'image/jpeg',
            currentQuality
          );
        });
      }

      if (blob.size > maxSizeBytes) {
        const scale = Math.sqrt(maxSizeBytes / blob.size) * 0.95;
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
              (b) => (b ? resolve(b) : reject(new Error('Failed to create blob'))),
              'image/jpeg',
              0.75
            );
          });
        }
      }

      const cleanName = file.name.replace(/\.[^/.]+$/, '') + '.jpg';
      const compressedFile = new File([blob], cleanName, { type: 'image/jpeg' });
      const previewUrl = URL.createObjectURL(compressedFile);

      return { file: compressedFile, previewUrl };
    } catch (e) {
      console.warn('createImageBitmap failed in admin compression, falling back to Image():', e);
    }
  }

  // 2. Standard Image() fallback
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = async () => {
      URL.revokeObjectURL(objectUrl);

      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      let currentQuality = initialQuality;
      let blob = await new Promise<Blob>((resBlob, rejBlob) => {
        canvas.toBlob(
          (b) => (b ? resBlob(b) : rejBlob(new Error('Compression failed'))),
          'image/jpeg',
          currentQuality
        );
      });

      while (blob.size > maxSizeBytes && currentQuality > 0.45) {
        currentQuality -= 0.08;
        blob = await new Promise<Blob>((resBlob, rejBlob) => {
          canvas.toBlob(
            (b) => (b ? resBlob(b) : rejBlob(new Error('Compression failed'))),
            'image/jpeg',
            currentQuality
          );
        });
      }

      if (blob.size > maxSizeBytes) {
        const scale = Math.sqrt(maxSizeBytes / blob.size) * 0.95;
        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = Math.round(width * scale);
        scaledCanvas.height = Math.round(height * scale);
        const sCtx = scaledCanvas.getContext('2d');
        if (sCtx) {
          sCtx.imageSmoothingEnabled = true;
          sCtx.imageSmoothingQuality = 'high';
          sCtx.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
          blob = await new Promise<Blob>((resBlob, rejBlob) => {
            scaledCanvas.toBlob(
              (b) => (b ? resBlob(b) : rejBlob(new Error('Compression failed'))),
              'image/jpeg',
              0.75
            );
          });
        }
      }

      const cleanName = file.name.replace(/\.[^/.]+$/, '') + '.jpg';
      const compressedFile = new File([blob], cleanName, { type: 'image/jpeg' });
      const previewUrl = URL.createObjectURL(compressedFile);
      resolve({ file: compressedFile, previewUrl });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };

    img.src = objectUrl;
  });
}
