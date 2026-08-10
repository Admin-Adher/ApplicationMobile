import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const imageSize = require('image-size') as (input: Uint8Array) => { width: number; height: number; type?: string };
const { findBox } = require('image-size/dist/types/utils') as {
  findBox: (input: Uint8Array, name: string, offset: number) => unknown;
};

function writeUint32BE(target: Uint8Array, offset: number, value: number) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

describe('BuildTrack image-size fork', () => {
  it('keeps the CommonJS callable API and dimensions Metro relies on', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    png.set([0x49, 0x48, 0x44, 0x52], 12);
    writeUint32BE(png, 16, 320);
    writeUint32BE(png, 20, 180);

    expect(imageSize(png)).toMatchObject({ width: 320, height: 180, type: 'png' });
  });

  it('rejects a zero-length ICNS entry instead of looping forever', () => {
    const icns = new Uint8Array(16);
    icns.set([0x69, 0x63, 0x6e, 0x73], 0);
    writeUint32BE(icns, 4, 16);
    icns.set([0x69, 0x63, 0x30, 0x37], 8);
    writeUint32BE(icns, 12, 0);

    expect(() => imageSize(icns)).toThrow('Invalid ICNS image entry length');
  });

  it('rejects zero-length JXL/HEIF-style boxes without looping', () => {
    const zeroLengthBox = new Uint8Array(8);
    zeroLengthBox.set([0x6a, 0x78, 0x6c, 0x63], 4);

    expect(findBox(zeroLengthBox, 'jxlp', 0)).toBeUndefined();
  });
});
