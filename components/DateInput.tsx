import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  Platform,
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  TextStyle,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { isValidDateFR } from '@/lib/dateUtils';

interface DateInputProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  label?: string;
  optional?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  inputWrapStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  showValidationIcon?: boolean;
}

function parseFR(s: string): Date | null {
  if (!s || s === '—') return null;
  const parts = s.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y || y < 2000) return null;
  const date = new Date(y, m - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) return null;
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
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function DateInput({
  value,
  onChange,
  placeholder,
  label,
  optional,
  containerStyle,
  inputWrapStyle,
  inputStyle,
  showValidationIcon = true,
}: DateInputProps) {
  const { t, i18n } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const today = new Date();
  const selectedDate = parseFR(value);

  const [viewYear, setViewYear] = useState(
    selectedDate ? selectedDate.getFullYear() : today.getFullYear()
  );
  const [viewMonth, setViewMonth] = useState(
    selectedDate ? selectedDate.getMonth() : today.getMonth()
  );

  const weeks = useMemo(() => buildCalendar(viewYear, viewMonth), [viewYear, viewMonth]);
  const locale = i18n.language?.startsWith('es') ? 'es-ES' : i18n.language?.startsWith('en') ? 'en-GB' : 'fr-FR';
  const dayLabels = useMemo(() => {
    const monday = new Date(2021, 10, 1);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + index);
      return new Intl.DateTimeFormat(locale, { weekday: 'short' })
        .format(day)
        .replace(/\.$/, '')
        .slice(0, 2);
    });
  }, [locale]);
  const monthTitle = useMemo(() => {
    const label = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(viewYear, viewMonth, 1));
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [locale, viewMonth, viewYear]);

  const hasValue = Boolean(value && value !== '—' && value.length > 0);
  const isValid = !value || value === '—' || isValidDateFR(value);
  const showError = Boolean(hasValue && !isValid);

  const borderColor = focused || calendarOpen
    ? showError ? C.open : C.primary
    : showError ? C.open : C.border;

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }
  function openCalendar() {
    const d = parseFR(value);
    if (d) { setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); }
    else { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); }
    setCalendarOpen(true);
  }
  function selectDay(day: Date) {
    onChange(formatFR(day));
    setCalendarOpen(false);
  }
  function selectToday() {
    onChange(formatFR(today));
    setCalendarOpen(false);
  }

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text style={styles.label}>
          {label}
          {optional ? <Text style={styles.optional}> ({t('dateInput.optional')})</Text> : null}
        </Text>
      ) : null}

      <View style={[styles.inputWrap, { borderColor }, inputWrapStyle]}>
        <TouchableOpacity
          onPress={openCalendar}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons
            name="calendar-outline"
            size={18}
            color={calendarOpen ? C.primary : focused ? C.primary : C.textMuted}
            style={styles.icon}
          />
        </TouchableOpacity>
        <TextInput
          style={[styles.input, inputStyle]}
          value={value}
          onChangeText={raw => onChange(autoFormat(raw, value))}
          placeholder={placeholder ?? t('dateInput.placeholder')}
          placeholderTextColor={C.textMuted}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {hasValue ? (
          <TouchableOpacity
            onPress={() => onChange('')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-circle" size={16} color={C.textMuted} />
          </TouchableOpacity>
        ) : null}
        {showValidationIcon && hasValue && isValid ? (
          <Ionicons
            name="checkmark-circle"
            size={16}
            color={C.closed}
            style={{ marginLeft: 4 }}
          />
        ) : null}
      </View>

      {showError ? (
        <Text style={styles.errorText}>{t('dateInput.invalid')}</Text>
      ) : !hasValue ? (
        <Text style={styles.hint}>{t('dateInput.openCalendarHint')}</Text>
      ) : null}

      <Modal
        visible={calendarOpen}
        transparent
        // Sur web desktop, le calendrier est une boîte de dialogue centrée
        // (le slide + la feuille collée en bas est une ergonomie mobile).
        animationType={IS_WEB ? 'fade' : 'slide'}
        onRequestClose={() => setCalendarOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={[styles.overlay, IS_WEB && styles.overlayWeb]} onPress={() => setCalendarOpen(false)}>
          <Pressable style={[styles.modal, IS_WEB && styles.modalWeb]} onPress={e => e.stopPropagation()}>

            {!IS_WEB && <View style={styles.modalHandle} />}

            <Text style={styles.modalTitle}>{t('dateInput.chooseDate')}</Text>

            <View style={styles.modalHeader}>
              <TouchableOpacity
                onPress={prevMonth}
                style={styles.navBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="chevron-back" size={20} color={C.primary} />
              </TouchableOpacity>
              <Text style={styles.monthTitle}>
                {monthTitle}
              </Text>
              <TouchableOpacity
                onPress={nextMonth}
                style={styles.navBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="chevron-forward" size={20} color={C.primary} />
              </TouchableOpacity>
            </View>

            <View style={styles.dowRow}>
              {dayLabels.map(d => (
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
                      <Text
                        style={[
                          styles.dayText,
                          isSelected && styles.dayTextSelected,
                          !isSelected && isToday && styles.dayTextToday,
                        ]}
                      >
                        {day.getDate()}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}

            <TouchableOpacity
              style={styles.todayBtn}
              onPress={selectToday}
              activeOpacity={0.8}
            >
              <Ionicons
                name="today-outline"
                size={15}
                color={C.primary}
                style={{ marginRight: 6 }}
              />
              <Text style={styles.todayBtnText}>{t('dateInput.today')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setCalendarOpen(false)}
            >
              <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>

          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const CELL_SIZE = 42;
const IS_WEB = Platform.OS === 'web';

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
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  // Web desktop : dialogue centré et de largeur plafonnée au lieu d'une
  // feuille pleine largeur ancrée en bas (présentation mobile).
  overlayWeb: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modal: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 12,
  },
  modalWeb: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 24,
    paddingTop: 20,
    paddingBottom: 24,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
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
    marginBottom: 8,
  },
  dowLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
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
    borderRadius: 12,
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
    fontSize: 15,
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
    marginTop: 16,
    paddingVertical: 12,
    backgroundColor: C.primaryBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  todayBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  cancelBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
  },
});
