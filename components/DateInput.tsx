import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
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

const DAYS_FR = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];
const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

function parseFR(s: string): Date | null {
  if (!s || s === '—') return null;
  const parts = s.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y || y < 2000) return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

function formatFR(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
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

function buildCalendar(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  let startDow = first.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;
  const days: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));
  while (days.length % 7 !== 0) days.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function CalendarModal({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: string;
  onSelect: (val: string) => void;
  onClose: () => void;
}) {
  const today = new Date();
  const selectedDate = parseFR(value);

  const [viewYear, setViewYear] = useState(() => {
    if (selectedDate) return selectedDate.getFullYear();
    return today.getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    if (selectedDate) return selectedDate.getMonth();
    return today.getMonth();
  });

  const weeks = useMemo(() => buildCalendar(viewYear, viewMonth), [viewYear, viewMonth]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }
  function selectDay(day: Date) {
    onSelect(formatFR(day));
    onClose();
  }
  function selectToday() {
    onSelect(formatFR(today));
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.modal} onPress={() => {}}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={prevMonth} style={styles.navBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="chevron-back" size={20} color={C.primary} />
            </TouchableOpacity>
            <Text style={styles.monthTitle}>{MONTHS_FR[viewMonth]} {viewYear}</Text>
            <TouchableOpacity onPress={nextMonth} style={styles.navBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="chevron-forward" size={20} color={C.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.dowRow}>
            {DAYS_FR.map(d => (
              <Text key={d} style={styles.dowLabel}>{d}</Text>
            ))}
          </View>

          {weeks.map((week, wi) => (
            <View key={wi} style={styles.weekRow}>
              {week.map((day, di) => {
                if (!day) return <View key={di} style={styles.dayCell} />;
                const isToday = isSameDay(day, today);
                const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
                return (
                  <TouchableOpacity
                    key={di}
                    style={[
                      styles.dayCell,
                      isSelected && styles.dayCellSelected,
                      !isSelected && isToday && styles.dayCellToday,
                    ]}
                    onPress={() => selectDay(day)}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.dayText,
                      isSelected && styles.dayTextSelected,
                      !isSelected && isToday && styles.dayTextToday,
                    ]}>
                      {day.getDate()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          <TouchableOpacity style={styles.todayBtn} onPress={selectToday} activeOpacity={0.8}>
            <Ionicons name="today-outline" size={15} color={C.primary} style={{ marginRight: 6 }} />
            <Text style={styles.todayBtnText}>Aujourd'hui</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function DateInput({ value, onChange, placeholder, label, optional }: DateInputProps) {
  const [focused, setFocused] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const hasValue = Boolean(value && value !== '—' && value.length > 0);
  const isValid = !value || value === '—' || validateDeadline(value);
  const showError = Boolean(hasValue && !isValid);

  function handleChange(raw: string) {
    onChange(autoFormat(raw, value));
  }

  const borderColor = focused || calendarOpen
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
        <TouchableOpacity onPress={() => setCalendarOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
          <Ionicons
            name="calendar-outline"
            size={18}
            color={calendarOpen ? C.primary : showError ? C.open : focused ? C.primary : C.textMuted}
            style={styles.icon}
          />
        </TouchableOpacity>
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
        <Text style={styles.hint}>Tapez ou appuyez sur l'icône pour choisir</Text>
      ) : null}

      <CalendarModal
        visible={calendarOpen}
        value={value}
        onSelect={onChange}
        onClose={() => setCalendarOpen(false)}
      />
    </View>
  );
}

const CELL_SIZE = 40;

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
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modal: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: 360,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.surface2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  dowRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  dowLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  dayCell: {
    flex: 1,
    height: CELL_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  dayCellSelected: {
    backgroundColor: C.primary,
  },
  dayCellToday: {
    backgroundColor: C.accentBg,
    borderWidth: 1.5,
    borderColor: C.accent,
  },
  dayText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.text,
  },
  dayTextSelected: {
    color: '#FFFFFF',
    fontFamily: 'Inter_600SemiBold',
  },
  dayTextToday: {
    color: C.primary,
    fontFamily: 'Inter_600SemiBold',
  },
  todayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 10,
    backgroundColor: C.primaryBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  todayBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },
});
