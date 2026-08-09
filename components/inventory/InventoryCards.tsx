import React from 'react';
import { Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import type { InventoryMovement, InventoryProduct } from '@/constants/types';
import { formatDateTimeFR } from '@/lib/utils';
import { useInventoryCopy } from '@/lib/inventoryI18n';

export function InventorySearch({
  value,
  onChangeText,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const copy = useInventoryCopy();
  return (
    <View style={styles.search}>
      <Ionicons name="search-outline" size={19} color={C.textMuted} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? copy.searchReference}
        placeholderTextColor={C.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus={autoFocus}
        returnKeyType="search"
      />
      {!!value && (
        <TouchableOpacity onPress={() => onChangeText('')} hitSlop={8}>
          <Ionicons name="close-circle" size={19} color={C.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

export function InventoryProductCard({
  product,
  onPress,
  compact = false,
}: {
  product: InventoryProduct;
  onPress?: () => void;
  compact?: boolean;
}) {
  const copy = useInventoryCopy();
  const low = product.minStock > 0 && product.currentStock <= product.minStock;
  const content = (
    <>
      <View style={styles.productMain}>
        {product.photoUrl ? (
          <Image source={{ uri: product.photoUrl }} style={[styles.productPhoto, compact && styles.productPhotoCompact]} />
        ) : (
          <View style={[styles.productPhoto, styles.photoPlaceholder, compact && styles.productPhotoCompact]}>
            <Ionicons name="cube-outline" size={compact ? 18 : 24} color={C.textMuted} />
          </View>
        )}
        <View style={styles.productBody}>
          <View style={styles.referenceRow}>
            <Text style={styles.reference} numberOfLines={1}>{product.reference}</Text>
            {product.pendingSync && <Ionicons name="cloud-upload-outline" size={15} color={C.waiting} />}
          </View>
          <Text style={styles.designation} numberOfLines={compact ? 1 : 2}>{product.designation}</Text>
        </View>
        <View style={[styles.stockBox, low && styles.stockBoxLow]}>
          <Text style={[styles.stockValue, low && styles.stockValueLow]}>{product.currentStock}</Text>
          <Text style={[styles.stockLabel, low && styles.stockValueLow]}>{low ? copy.lowStock : copy.stock}</Text>
        </View>
        {!!onPress && <Ionicons name="chevron-forward" size={18} color={C.textMuted} />}
      </View>
      {!compact && (
        <View style={styles.productStats}>
          <View style={styles.productStat}>
            <Text style={styles.productStatLabel}>{copy.entries}</Text>
            <Text style={[styles.productStatValue, { color: C.closed }]}>+{product.totalEntries}</Text>
          </View>
          <View style={styles.productStatDivider} />
          <View style={styles.productStat}>
            <Text style={styles.productStatLabel}>{copy.exits}</Text>
            <Text style={[styles.productStatValue, { color: C.open }]}>−{product.totalExits}</Text>
          </View>
          <View style={styles.productStatDivider} />
          <View style={[styles.productStat, styles.productLocationStat]}>
            <Text style={styles.productStatLabel}>{copy.location}</Text>
            <Text style={styles.productLocation} numberOfLines={1}>{product.location || '—'}</Text>
          </View>
        </View>
      )}
    </>
  );
  if (!onPress) return <View style={[styles.productCard, compact && styles.productCardCompact]}>{content}</View>;
  return <TouchableOpacity style={[styles.productCard, compact && styles.productCardCompact]} onPress={onPress} activeOpacity={0.75}>{content}</TouchableOpacity>;
}

export function InventoryMovementCard({
  movement,
  onPress,
}: {
  movement: InventoryMovement;
  onPress?: () => void;
}) {
  const copy = useInventoryCopy();
  const incoming = movement.movementType === 'in';
  const destination = [movement.buildingName, movement.zoneName].filter(Boolean).join(' · ')
    || movement.supplier
    || movement.companyName;
  const content = (
    <>
      <View style={[styles.movementIcon, { backgroundColor: incoming ? C.closedBg : C.openBg }]}>
        <Ionicons name={incoming ? 'arrow-down-outline' : 'arrow-up-outline'} size={20} color={incoming ? C.closed : C.open} />
      </View>
      <View style={styles.movementBody}>
        <View style={styles.referenceRow}>
          <Text style={styles.movementReference} numberOfLines={1}>{movement.reference}</Text>
          {movement.pendingSync && <Text style={styles.pending}>{copy.pending}</Text>}
        </View>
        <Text style={styles.movementDesignation} numberOfLines={1}>{movement.designation}</Text>
        <Text style={styles.movementMeta} numberOfLines={1}>
          {formatDateTimeFR(movement.createdAt)}{destination ? ` · ${destination}` : ''}
        </Text>
      </View>
      <View style={styles.quantityWrap}>
        <Text style={[styles.quantity, { color: incoming ? C.closed : C.open }]}>{incoming ? '+' : '−'}{movement.quantity}</Text>
        <Text style={styles.afterStock}>{movement.stockAfter}</Text>
      </View>
      {!!onPress && <Ionicons name="chevron-forward" size={16} color={C.textMuted} />}
    </>
  );
  if (!onPress) return <View style={styles.movementCard}>{content}</View>;
  return <TouchableOpacity style={styles.movementCard} onPress={onPress} activeOpacity={0.75}>{content}</TouchableOpacity>;
}

export function InventoryEmpty({ icon = 'cube-outline', title, subtitle }: { icon?: string; title: string; subtitle?: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Ionicons name={icon as any} size={32} color={C.textMuted} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {!!subtitle && <Text style={styles.emptySubtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14 },
  searchInput: { flex: 1, color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14, paddingVertical: 0 },
  productCard: { padding: 12, backgroundColor: C.surface, borderRadius: 15, borderWidth: 1, borderColor: C.border },
  productCardCompact: { padding: 9, borderRadius: 12 },
  productMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  productPhoto: { width: 54, height: 54, borderRadius: 11, backgroundColor: C.surface2 },
  productPhotoCompact: { width: 40, height: 40, borderRadius: 9 },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  productBody: { flex: 1, minWidth: 0 },
  referenceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reference: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 14, flexShrink: 1 },
  designation: { color: C.text, fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 5 },
  meta: { color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 11, flex: 1 },
  stockBox: { minWidth: 58, alignItems: 'center', paddingVertical: 7, paddingHorizontal: 8, borderRadius: 11, backgroundColor: C.primaryBg },
  stockBoxLow: { backgroundColor: C.openBg },
  stockValue: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 18 },
  stockValueLow: { color: C.open },
  stockLabel: { color: C.textSub, fontFamily: 'Inter_500Medium', fontSize: 9, textTransform: 'uppercase' },
  productStats: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 9, borderTopWidth: 1, borderTopColor: C.border },
  productStat: { minWidth: 64 },
  productLocationStat: { flex: 1, minWidth: 0 },
  productStatDivider: { width: 1, height: 27, backgroundColor: C.border, marginHorizontal: 10 },
  productStatLabel: { color: C.textMuted, fontFamily: 'Inter_500Medium', fontSize: 9, textTransform: 'uppercase' },
  productStatValue: { fontFamily: 'Inter_700Bold', fontSize: 13, marginTop: 2 },
  productLocation: { color: C.textSub, fontFamily: 'Inter_600SemiBold', fontSize: 11, marginTop: 3 },
  movementCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border },
  movementIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  movementBody: { flex: 1, minWidth: 0 },
  movementReference: { color: C.text, fontFamily: 'Inter_700Bold', fontSize: 13, flexShrink: 1 },
  movementDesignation: { color: C.textSub, fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 1 },
  movementMeta: { color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 4 },
  pending: { color: C.waiting, backgroundColor: C.waitingBg, fontFamily: 'Inter_600SemiBold', fontSize: 8, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2 },
  quantityWrap: { alignItems: 'flex-end' },
  quantity: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  afterStock: { color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 10 },
  empty: { alignItems: 'center', paddingVertical: 42, paddingHorizontal: 24 },
  emptyIcon: { width: 64, height: 64, borderRadius: 22, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { color: C.text, fontFamily: 'Inter_600SemiBold', fontSize: 15, textAlign: 'center' },
  emptySubtitle: { color: C.textSub, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 5 },
});
