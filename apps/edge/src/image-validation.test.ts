import { describe, expect, it } from 'vitest';
import { validateImage } from './image-validation';

function png(width = 100, height = 80) {
  const bytes = new Uint8Array(36);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  bytes.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0], 24);
  return bytes;
}

describe('validateImage', () => {
  it('accepts a bounded PNG with matching MIME', () => {
    expect(validateImage(png(), 'image/png')).toMatchObject({ mimeType: 'image/png', extension: 'png', width: 100, height: 80 });
  });

  it('rejects MIME spoofing', () => {
    expect(() => validateImage(png(), 'image/jpeg')).toThrow('IMAGE_MIME_MISMATCH');
  });

  it('rejects unsafe dimensions and unknown bytes', () => {
    expect(() => validateImage(png(20, 20), 'image/png')).toThrow('IMAGE_DIMENSIONS_INVALID');
    expect(() => validateImage(new Uint8Array(100), 'image/png')).toThrow('IMAGE_DECODE_INVALID');
  });

  it('rejects a truncated PNG even when its header contains dimensions', () => {
    expect(() => validateImage(png().slice(0, 24), 'image/png')).toThrow('IMAGE_DECODE_INVALID');
  });
});
