import { Platform } from 'react-native';
import { extractInventoryLabelFields, type InventoryLabelFields } from '@/lib/inventoryOcrParser';

/** Runs Latin-script OCR locally on the device. Web keeps the manual fallback. */
export async function recognizeInventoryLabel(imageUri: string): Promise<InventoryLabelFields> {
  if (Platform.OS === 'web' || !imageUri) return {};
  const { recognizeText } = await import('@infinitered/react-native-mlkit-text-recognition');
  const result = await recognizeText(imageUri);
  return extractInventoryLabelFields(result.text ?? '');
}
