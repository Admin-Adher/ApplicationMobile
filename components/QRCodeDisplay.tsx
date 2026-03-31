import { View, Text, StyleSheet, Image, TouchableOpacity, Platform, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';

export interface QRPositionData {
  planId: string;
  planName?: string;
  building?: string;
  level?: string;
  x?: number;
  y?: number;
}

function encodeQRPayload(data: QRPositionData): string {
  return `bt://plan?id=${data.planId}` +
    (data.building ? `&b=${encodeURIComponent(data.building)}` : '') +
    (data.level ? `&l=${encodeURIComponent(data.level)}` : '') +
    (data.x !== undefined ? `&x=${data.x.toFixed(1)}` : '') +
    (data.y !== undefined ? `&y=${data.y.toFixed(1)}` : '');
}

export function parseQRPayload(raw: string): QRPositionData | null {
  try {
    if (!raw.startsWith('bt://plan')) return null;
    const url = new URL(raw.replace('bt://', 'https://bt.app/'));
    const params = url.searchParams;
    const planId = params.get('id');
    if (!planId) return null;
    return {
      planId,
      building: params.get('b') ?? undefined,
      level: params.get('l') ?? undefined,
      x: params.get('x') ? parseFloat(params.get('x')!) : undefined,
      y: params.get('y') ? parseFloat(params.get('y')!) : undefined,
    };
  } catch {
    return null;
  }
}

interface QRCodeDisplayProps {
  data: QRPositionData;
  size?: number;
  showCopy?: boolean;
}

export default function QRCodeDisplay({ data, size = 160, showCopy = true }: QRCodeDisplayProps) {
  const payload = encodeQRPayload(data);
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size * 2}x${size * 2}&data=${encodeURIComponent(payload)}&color=1E3A5F&bgcolor=0F172A&format=png&margin=4`;

  async function handleCopy() {
    await Clipboard.setStringAsync(payload);
    Alert.alert('Copié', 'Code QR copié dans le presse-papier');
  }

  return (
    <View style={styles.container}>
      <View style={[styles.qrWrap, { width: size, height: size }]}>
        <Image
          source={{ uri: qrImageUrl }}
          style={{ width: size, height: size, borderRadius: 8 }}
          resizeMode="contain"
        />
      </View>

      {data.planName && (
        <Text style={styles.planName} numberOfLines={1}>{data.planName}</Text>
      )}

      <View style={styles.meta}>
        {data.building && (
          <View style={styles.chip}>
            <Ionicons name="business-outline" size={11} color={C.primary} />
            <Text style={styles.chipText}>Bât. {data.building}</Text>
          </View>
        )}
        {data.level && (
          <View style={styles.chip}>
            <Ionicons name="layers-outline" size={11} color={C.primary} />
            <Text style={styles.chipText}>{data.level}</Text>
          </View>
        )}
        {data.x !== undefined && data.y !== undefined && (
          <View style={styles.chip}>
            <Ionicons name="locate-outline" size={11} color={C.primary} />
            <Text style={styles.chipText}>{data.x.toFixed(0)}%, {data.y.toFixed(0)}%</Text>
          </View>
        )}
      </View>

      {showCopy && (
        <TouchableOpacity style={styles.copyBtn} onPress={handleCopy}>
          <Ionicons name="copy-outline" size={14} color={C.primary} />
          <Text style={styles.copyText}>Copier le code</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 10,
  },
  qrWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  planName: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.primaryBg,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: C.primary,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  copyText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: C.primary,
  },
});
