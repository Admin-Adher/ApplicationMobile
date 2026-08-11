export type WebBarcodeResult = {
  text: string;
  format: string;
};

export type WebBarcodeScannerControls = {
  stop: () => void;
  switchTorch?: (enabled: boolean) => Promise<void>;
};

type ZXingResult = {
  getText: () => string;
  getBarcodeFormat: () => unknown;
};

type ZXingLiveControls = {
  stop: () => void;
  switchTorch?: (enabled: boolean) => Promise<void>;
};

type ZXingReader = {
  possibleFormats?: unknown[];
  decodeFromConstraints: (
    constraints: MediaStreamConstraints,
    preview: HTMLVideoElement,
    callback: (result?: ZXingResult, error?: { name?: string }, controls?: ZXingLiveControls) => void,
  ) => Promise<ZXingLiveControls>;
};

type ZXingModule = {
  BarcodeFormat: Record<string, unknown>;
  BrowserMultiFormatReader: new (
    hints?: any,
    options?: { delayBetweenScanAttempts?: number; delayBetweenScanSuccess?: number; tryPlayVideoTimeout?: number },
  ) => ZXingReader;
};

export type StartWebBarcodeScannerOptions = {
  video: HTMLVideoElement;
  loadZXing: () => Promise<ZXingModule>;
  onDetected: (result: WebBarcodeResult) => void;
  onDecodeError?: (error: unknown) => void;
};

const ZXING_FORMAT_KEYS = [
  'AZTEC',
  'CODABAR',
  'CODE_39',
  'CODE_93',
  'CODE_128',
  'DATA_MATRIX',
  'EAN_8',
  'EAN_13',
  'ITF',
  'PDF_417',
  'QR_CODE',
  'UPC_A',
  'UPC_E',
] as const;

export const WEB_BARCODE_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

function isRoutineDecodeMiss(error: unknown): boolean {
  const name = String((error as { name?: string } | null)?.name ?? '');
  return name === 'NotFoundException'
    || name === 'ChecksumException'
    || name === 'FormatException';
}

function scannerPrerequisiteError(): Error | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return new Error('camera_browser_only');
  }
  if (!window.isSecureContext) return new Error('camera_secure_context');
  if (!navigator.mediaDevices?.getUserMedia) return new Error('camera_not_supported');
  return null;
}

function stopVideo(video: HTMLVideoElement): void {
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach(track => track.stop());
  video.srcObject = null;
}

async function startDecode(
  reader: ZXingReader,
  constraints: MediaStreamConstraints,
  video: HTMLVideoElement,
  callback: (result?: ZXingResult, error?: { name?: string }, controls?: ZXingLiveControls) => void,
): Promise<ZXingLiveControls> {
  return reader.decodeFromConstraints(constraints, video, callback);
}

export async function startWebBarcodeScanner({
  video,
  loadZXing,
  onDetected,
  onDecodeError,
}: StartWebBarcodeScannerOptions): Promise<WebBarcodeScannerControls> {
  const prerequisiteError = scannerPrerequisiteError();
  if (prerequisiteError) throw prerequisiteError;

  const zxing = await loadZXing();
  const reader = new zxing.BrowserMultiFormatReader(undefined, {
    delayBetweenScanAttempts: 90,
    delayBetweenScanSuccess: 500,
    tryPlayVideoTimeout: 7_500,
  });
  reader.possibleFormats = ZXING_FORMAT_KEYS
    .map(key => zxing.BarcodeFormat[key])
    .filter(value => value != null);

  let detected = false;
  let liveControls: ZXingLiveControls | undefined;
  const callback = (result?: ZXingResult, error?: { name?: string }, controls?: ZXingLiveControls) => {
    if (detected) return;
    if (result) {
      const text = String(result.getText?.() ?? '').trim();
      if (!text) return;
      detected = true;
      (controls ?? liveControls)?.stop();
      stopVideo(video);
      const rawFormat = result.getBarcodeFormat?.() ?? 'unknown';
      const readableFormat = typeof rawFormat === 'number'
        ? zxing.BarcodeFormat[String(rawFormat)] ?? rawFormat
        : rawFormat;
      onDetected({
        text,
        format: String(readableFormat),
      });
      return;
    }
    if (error && !isRoutineDecodeMiss(error)) onDecodeError?.(error);
  };

  try {
    liveControls = await startDecode(reader, WEB_BARCODE_CAMERA_CONSTRAINTS, video, callback);
  } catch (firstError: any) {
    const retryWithoutFacingMode = firstError?.name === 'OverconstrainedError'
      || firstError?.name === 'ConstraintNotSatisfiedError';
    if (!retryWithoutFacingMode) throw firstError;
    liveControls = await startDecode(reader, { audio: false, video: true }, video, callback);
  }

  return {
    stop: () => {
      detected = true;
      liveControls?.stop();
      stopVideo(video);
    },
    switchTorch: liveControls.switchTorch
      ? async enabled => liveControls?.switchTorch?.(enabled)
      : undefined,
  };
}

export function webBarcodeCameraErrorMessage(error: unknown, fallback: string): string {
  const code = String((error as { message?: string } | null)?.message ?? '');
  const name = String((error as { name?: string } | null)?.name ?? '');
  if (code === 'camera_secure_context') return 'La caméra du navigateur nécessite une connexion HTTPS sécurisée.';
  if (code === 'camera_not_supported') return 'Ce navigateur ne permet pas d’utiliser la caméra.';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'L’accès à la caméra a été refusé.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'Aucune caméra utilisable n’a été détectée.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'La caméra est déjà utilisée par une autre application.';
  return fallback;
}
