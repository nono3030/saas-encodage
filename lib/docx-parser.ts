import { createHash } from 'crypto';
import mammoth from 'mammoth';
import type { ScanResult, ImageMap } from './types';

export async function extractDocxContent(buffer: Buffer): Promise<ScanResult> {
  const images: ImageMap = {};

  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const base64 = await image.read('base64') as string;
        const mimeType = image.contentType || 'image/jpeg';
        const ext = mimeType.split('/')[1]?.split('+')[0] || 'jpg';
        const hash = createHash('md5').update(base64.substring(0, 500)).digest('hex').substring(0, 12);
        const token = `{{IMG_${hash}}}`;
        if (!images[token]) {
          images[token] = { base64, name: `image_${hash}.${ext}`, mimeType, hash };
        }
        return { src: token };
      }),
    }
  );

  return { htmlRaw: result.value, images };
}
