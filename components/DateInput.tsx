import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { validateDeadline } from '@/lib/reserveUtils';

interface DateInputProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  label?: string;
  optional?: boolean;
}

function autoFormat(raw: string, prev: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return '';
  let out = '';
  if (digits.length <= 2) {
    out = digits;
  } else if (digits.length <= 4) {
    out = digits.slice(0, 2) + '/' + digits.slice(2);
  } else {
    out = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);
  }
  if (raw.length < prev.length && raw.endsWith('/')) {
    return out.slice(0, out.lastIndexOf('/'));
  }
  return out;
}

export default function DateInput({ value, onChange, placeholder, label, optional }: DateInputProps) {
  const [focused, setFocused] = useState(false);

  const hasValue = Boolean(value && value !== '—' && value.length > 0);
  const isValid = !value || value === '—' || validateDeadline(value);
  const showError = Boolean(hasValue && !isValid);

  function handleChange(raw: string) {
    const formatted = autoFormat(raw, value);
    onChange(formatted);
  }

  const borderColor = focused
    ? (showError ? C.open : C.primary)
    : (showError ? C.open : C.border);

  return (
    <View style={styles.container}>
      {label ? (
        <Text style={styles.label}>
          {label}
          {optional ? <Text style={styles.optional}> (optionnel)</Text> : null}
        </Text>
      ) : null}
      <View style={[styles.inputWrap, { borderColor }]}>
        <Ionicons
          name="calendar-outline"
          size={16}
          color={showError ? C.open : focused ? C.primary : C.textMuted}
          style={styles.icon}
        />
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={handleChange}
          placeholder={placeholder ?? 'JJ/MM/AAAA'}
          placeholderTextColor={C.textMuted}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {hasValue ? (
          <TouchableOpacity onPress={() => onChange('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={16} color={C.textMuted} />
          </TouchableOpacity>
        ) : null}
        {hasValue && isValid ? (
          <Ionicons name="checkmark-circle" size={16} color={C.closed} style={{ marginLeft: 4 }} />
        ) : null}
      </View>
      {showError ? (
        <Text style={styles.errorText}>Date invalide — utilisez le format JJ/MM/AAAA</Text>
      ) : null}
      {!showError && !hasValue ? (
        <Text style={styles.hint}>Ex : 30/04/2026 — laisser vide si aucune échéance</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 2 },
  label: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: C.textSub,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  optional: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
    textTransform: 'none',
    letterSpacing: 0,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface2,
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  icon: { marginRight: 8 },
  input: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.text,
  },
  hint: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
    marginTop: 5,
  },
  errorText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.open,
    marginTop: 5,
  },
});
