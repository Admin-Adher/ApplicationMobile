import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '@/constants/colors';

export interface PickerOption {
  label: string;
  value: string;
  color?: string;
  secondaryLabel?: string;
}

interface Props {
  label: string;
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
}

export default function BottomSheetPicker({
  label, options, value, onChange, placeholder, allowNone, noneLabel = 'Aucun',
}: Props) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const selected = options.find(o => o.value === value);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  const bottomPad = Platform.OS === 'web' ? 24 : Math.max(insets.bottom + 16, 32);

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.trigger} onPress={() => setOpen(true)} activeOpacity={0.75}>
        <View style={styles.triggerLeft}>
          {selected?.color && (
            <View style={[styles.colorDot, { backgroundColor: selected.color }]} />
          )}
          <Text style={[styles.triggerText, !selected && styles.triggerPlaceholder]}>
            {selected?.label ?? placeholder ?? 'Sélectionner…'}
          </Text>
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
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{label}</Text>

          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.list}
            contentContainerStyle={{ paddingBottom: bottomPad }}
          >
            {allowNone && (
              <TouchableOpacity
                style={[styles.option, !value && styles.optionSelected]}
                onPress={() => pick('')}
                activeOpacity={0.7}
              >
                <Text style={[styles.optionText, !value && styles.optionTextSelected]}>
                  {noneLabel}
                </Text>
                {!value && <Ionicons name="checkmark" size={18} color={C.primary} />}
              </TouchableOpacity>
            )}
            {options.map(opt => {
              const isSel = opt.value === value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.option, isSel && styles.optionSelected]}
                  onPress={() => pick(opt.value)}
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
                  {isSel && <Ionicons name="checkmark" size={18} color={C.primary} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
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
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: C.border,
    minHeight: 48,
  },
  triggerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  colorDot: { width: 10, height: 10, borderRadius: 5 },
  triggerText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text, flex: 1 },
  triggerPlaceholder: { color: C.textMuted },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '70%',
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
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: C.text,
    marginBottom: 12,
  },
  list: {},
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  optionSelected: { backgroundColor: C.primaryBg, borderRadius: 10, paddingHorizontal: 10, marginHorizontal: -6 },
  optionLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  optionDot: { width: 12, height: 12, borderRadius: 6 },
  optionText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.text },
  optionTextSelected: { fontFamily: 'Inter_600SemiBold', color: C.primary },
  optionSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
});
