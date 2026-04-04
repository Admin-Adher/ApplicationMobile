import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  ScrollView, Platform, PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '@/constants/colors';

export interface MultiPickerOption {
  label: string;
  value: string;
  color?: string;
  secondaryLabel?: string;
}

interface Props {
  label: string;
  options: MultiPickerOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  noneLabel?: string;
}

export default function BottomSheetMultiPicker({
  label, options, values, onChange, placeholder, noneLabel = 'Aucun lot sélectionné',
}: Props) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();

  const handlePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && g.dy > Math.abs(g.dx),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 60 || g.vy > 0.5) setOpen(false);
      },
    })
  ).current;

  function toggle(v: string) {
    if (values.includes(v)) {
      onChange(values.filter(x => x !== v));
    } else {
      onChange([...values, v]);
    }
  }

  function clearAll() {
    onChange([]);
  }

  const bottomPad = Platform.OS === 'web' ? 24 : Math.max(insets.bottom + 16, 32);
  const selectedOptions = options.filter(o => values.includes(o.value));

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.trigger} onPress={() => setOpen(true)} activeOpacity={0.75}>
        <View style={styles.triggerLeft}>
          {selectedOptions.length === 0 ? (
            <Text style={styles.triggerPlaceholder}>{placeholder ?? noneLabel}</Text>
          ) : (
            <View style={styles.chipsRow}>
              {selectedOptions.map(opt => (
                <View
                  key={opt.value}
                  style={[styles.chip, opt.color ? { backgroundColor: opt.color + '22', borderColor: opt.color + '60' } : {}]}
                >
                  {opt.color && <View style={[styles.chipDot, { backgroundColor: opt.color }]} />}
                  <Text
                    style={[styles.chipText, opt.color ? { color: opt.color } : {}]}
                    numberOfLines={1}
                  >
                    {opt.label}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <Ionicons name="chevron-down" size={16} color={C.textMuted} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        />
        <View style={styles.sheet}>
          <View style={styles.handleHitArea} {...handlePan.panHandlers}>
            <View style={styles.handle} />
          </View>

          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <View style={styles.sheetHeaderRight}>
              {values.length > 0 && (
                <TouchableOpacity onPress={clearAll} style={styles.clearBtn}>
                  <Text style={styles.clearBtnText}>Tout effacer</Text>
                </TouchableOpacity>
              )}
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{values.length} sélectionné{values.length > 1 ? 's' : ''}</Text>
              </View>
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.list}
            contentContainerStyle={{ paddingBottom: bottomPad }}
          >
            {options.map(opt => {
              const isSel = values.includes(opt.value);
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.option, isSel && styles.optionSelected]}
                  onPress={() => toggle(opt.value)}
                  activeOpacity={0.7}
                >
                  <View style={styles.optionLeft}>
                    {opt.color && (
                      <View style={[styles.optionDot, { backgroundColor: opt.color }]} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionText, isSel && styles.optionTextSelected]}>
                        {opt.label}
                      </Text>
                      {opt.secondaryLabel ? (
                        <Text style={styles.optionSub}>{opt.secondaryLabel}</Text>
                      ) : null}
                    </View>
                  </View>
                  <View style={[styles.checkbox, isSel && styles.checkboxSelected]}>
                    {isSel && <Ionicons name="checkmark" size={13} color="#fff" />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity style={styles.doneBtn} onPress={() => setOpen(false)}>
            <Text style={styles.doneBtnText}>Confirmer la sélection</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 14 },
  label: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: C.textSub,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surface2,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.border,
    minHeight: 48,
  },
  triggerLeft: { flex: 1, marginRight: 8 },
  triggerPlaceholder: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: 8, borderWidth: 1,
    backgroundColor: C.primaryBg, borderColor: C.primary + '40',
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '75%',
    ...Platform.select({
      web: { boxShadow: '0 -4px 24px rgba(0,0,0,0.12)' } as any,
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 16,
      },
    }),
  },
  handleHitArea: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 4,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 12,
  },
  sheetTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  sheetHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  clearBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  clearBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  countBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: C.primaryBg },
  countBadgeText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  list: {},
  option: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  optionSelected: { backgroundColor: C.primaryBg, borderRadius: 10, paddingHorizontal: 10, marginHorizontal: -6 },
  optionLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  optionDot: { width: 12, height: 12, borderRadius: 6 },
  optionText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.text },
  optionTextSelected: { fontFamily: 'Inter_600SemiBold', color: C.primary },
  optionSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surface2,
  },
  checkboxSelected: { backgroundColor: C.primary, borderColor: C.primary },
  doneBtn: {
    marginTop: 14, marginBottom: 4,
    backgroundColor: C.primary, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  doneBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
