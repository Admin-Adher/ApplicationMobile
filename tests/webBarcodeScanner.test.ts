import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WEB_BARCODE_CAMERA_CONSTRAINTS,
  startWebBarcodeScanner,
  webBarcodeCameraErrorMessage,
} from '../lib/webBarcodeScanner';

afterEach(() => {
  vi.unstubAllGlobals();
});

function prepareBrowserGlobals() {
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });
}

describe('web barcode scanner', () => {
  it('decodes an EAN through ZXing with an environment-facing camera request', async () => {
    prepareBrowserGlobals();
    const stop = vi.fn();
    const onDetected = vi.fn();
    let receivedConstraints: MediaStreamConstraints | undefined;
    let receivedFormats: unknown[] = [];

    class FakeReader {
      set possibleFormats(formats: unknown[]) {
        receivedFormats = formats;
      }

      async decodeFromConstraints(
        constraints: MediaStreamConstraints,
        _video: HTMLVideoElement,
        callback: (result: any, error: any, controls: { stop: () => void }) => void,
      ) {
        receivedConstraints = constraints;
        callback({
          getText: () => '3017620422003',
          getBarcodeFormat: () => 7,
        }, undefined, { stop });
        return { stop };
      }
    }

    const video = { srcObject: null } as unknown as HTMLVideoElement;
    const controls = await startWebBarcodeScanner({
      video,
      loadZXing: async () => ({
        BrowserMultiFormatReader: FakeReader as any,
        BarcodeFormat: {
          7: 'EAN_13',
          EAN_13: 7,
          EAN_8: 8,
          QR_CODE: 11,
          UPC_A: 14,
        },
      }),
      onDetected,
    });

    expect(receivedConstraints).toEqual(WEB_BARCODE_CAMERA_CONSTRAINTS);
    expect((receivedConstraints?.video as MediaTrackConstraints).facingMode).toEqual({ ideal: 'environment' });
    expect(receivedFormats).toEqual(expect.arrayContaining([7, 8, 11, 14]));
    expect(onDetected).toHaveBeenCalledWith({ text: '3017620422003', format: 'EAN_13' });
    expect(stop).toHaveBeenCalled();
    controls.stop();
  });

  it('retries with the default webcam if facing-mode constraints are rejected', async () => {
    prepareBrowserGlobals();
    const constraints: MediaStreamConstraints[] = [];
    class FallbackReader {
      possibleFormats?: unknown[];
      async decodeFromConstraints(value: MediaStreamConstraints) {
        constraints.push(value);
        if (constraints.length === 1) throw Object.assign(new Error('constraint'), { name: 'OverconstrainedError' });
        return { stop: vi.fn() };
      }
    }

    await startWebBarcodeScanner({
      video: { srcObject: null } as unknown as HTMLVideoElement,
      loadZXing: async () => ({ BrowserMultiFormatReader: FallbackReader as any, BarcodeFormat: {} }),
      onDetected: vi.fn(),
    });

    expect(constraints).toHaveLength(2);
    expect(constraints[1]).toEqual({ audio: false, video: true });
  });

  it('returns an actionable message for denied camera permission', () => {
    expect(webBarcodeCameraErrorMessage({ name: 'NotAllowedError' }, 'fallback'))
      .toBe('L’accès à la caméra a été refusé.');
  });
});
