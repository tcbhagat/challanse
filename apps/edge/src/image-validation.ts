export const MAX_WEB_IMAGE_BYTES = 5_000_000;
export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export type ValidatedImage = {
  mimeType: SupportedImageType;
  extension: 'jpg' | 'png' | 'webp';
  width: number;
  height: number;
};

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function pngDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

function jpegDimensions(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + length + 2 > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return [(bytes[offset + 7] << 8) | bytes[offset + 8], (bytes[offset + 5] << 8) | bytes[offset + 6]];
    }
    offset += length + 2;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): [number, number] | null {
  const text = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  if (bytes.length < 30 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WEBP') return null;
  const kind = text(12, 4);
  if (kind === 'VP8X') return [readUint24LE(bytes, 24) + 1, readUint24LE(bytes, 27) + 1];
  if (kind === 'VP8L' && bytes[20] === 0x2f) {
    return [1 + (((bytes[22] & 0x3f) << 8) | bytes[21]), 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | (bytes[22] >> 6))];
  }
  if (kind === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return [((bytes[27] << 8) | bytes[26]) & 0x3fff, ((bytes[29] << 8) | bytes[28]) & 0x3fff];
  }
  return null;
}

export function validateImage(bytes: Uint8Array, declaredMimeType: string): ValidatedImage {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_WEB_IMAGE_BYTES) throw new Error('IMAGE_SIZE_INVALID');
  const mimeType = declaredMimeType.toLowerCase().split(';', 1)[0].trim();
  if (!SUPPORTED_IMAGE_TYPES.includes(mimeType as SupportedImageType)) throw new Error('IMAGE_TYPE_UNSUPPORTED');

  let dimensions: [number, number] | null = null;
  let detected: SupportedImageType;
  let extension: ValidatedImage['extension'];
  if ((dimensions = pngDimensions(bytes))) {
    detected = 'image/png'; extension = 'png';
  } else if ((dimensions = jpegDimensions(bytes))) {
    detected = 'image/jpeg'; extension = 'jpg';
  } else if ((dimensions = webpDimensions(bytes))) {
    detected = 'image/webp'; extension = 'webp';
  } else {
    throw new Error('IMAGE_DECODE_INVALID');
  }
  if (detected !== mimeType) throw new Error('IMAGE_MIME_MISMATCH');
  const [width, height] = dimensions;
  if (width < 64 || height < 64 || width > 12_000 || height > 12_000 || width * height > 40_000_000) {
    throw new Error('IMAGE_DIMENSIONS_INVALID');
  }
  return { mimeType: detected, extension, width, height };
}
