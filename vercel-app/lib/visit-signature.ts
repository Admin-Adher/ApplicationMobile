/** The Android app stores raw SVG, while the browser stores image data URLs. */
export function visitSignatureImageSource(value: unknown): string {
  if (typeof value !== 'string') return '';
  const signature = value.trim();
  if (/^<svg[\s>]/i.test(signature)) return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(signature);
  return /^data:image\/(?:png|jpe?g|webp|svg\+xml)[;,]/i.test(signature) ? signature : '';
}

export async function visitSignatureHasInk(value: unknown): Promise<boolean> {
  const source = visitSignatureImageSource(value);
  if (!source) return false;
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 520 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.ceil(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.ceil(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return false;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0 && Math.min(data[i], data[i + 1], data[i + 2]) < 250) return true;
    }
    return false;
  } catch {
    return false;
  }
}
