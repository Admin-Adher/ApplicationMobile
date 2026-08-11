export type InventoryWebBarcodeCameraHandle = {
  takePictureAsync: (options?: { quality?: number }) => Promise<{ uri: string; width: number; height: number }>;
};

export type InventoryWebBarcodeCameraProps = {
  active: boolean;
  torch: boolean;
  errorMessage: string;
  retryLabel: string;
  onDetected: (result: { data: string; type: string }) => void;
};
