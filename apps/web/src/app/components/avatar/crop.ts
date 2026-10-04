/** #140: centre-crops an image file to a square and scales it to `size`, as WebP (PNG where WebP encoding is missing). */
export async function cropSquare(file: File, size = 400): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(size, side);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
  if (!blob) throw new Error('Could not encode the image');
  return blob;
}
