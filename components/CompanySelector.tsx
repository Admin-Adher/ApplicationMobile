import { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { Company } from '@/constants/types';

type BaseProps = {
  companies: Company[];
  disabled?: boolean;
  emptyText?: string;
  searchPlaceholder?: string;
  maxListHeight?: number;
};

type MultiProps = BaseProps & {
  mode: 'multi';
  identifier?: 'id' | 'name';
  value: string[];
  onChange: (next: string[]) => void;
  showSelectAll?: boolean;
};

type SingleProps = BaseProps & {
  mode: 'single';
  identifier?: 'id' | 'name';
  value: string | null;
  onChange: (next: string | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
};

type Props = MultiProps | SingleProps;

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export default function CompanySelector(props: Props) {
  const {
    companies,
    disabled,
    emptyText = "Aucune entreprise configurée",
    searchPlaceholder = "Rechercher une entreprise…",
    maxListHeight = 280,
  } = props;
  const idKey: 'id' | 'name' = props.identifier ?? 'id';
  const [query, setQuery] = useState('');

  const keyOf = (c: Company) => (idKey === 'name' ? c.name : c.id);

  const selectedSet = useMemo(() => {
    if (props.mode === 'multi') return new Set(props.value);
    return new Set(props.value ? [props.value] : []);
  }, [props]);

  const selectedCompanies = useMemo(
    () => companies.filter(c => selectedSet.has(keyOf(c))),
    [companies, selectedSet, idKey]
  );

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return companies;
    return companies.filter(c =>
      norm(c.name).includes(q) || norm(c.shortName || '').includes(q)
    );
  }, [companies, query]);

  if (companies.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="alert-circle-outline" size={14} color={C.medium} />
        <Text style={styles.emptyText}>{emptyText}</Text>
      </View>
    );
  }

  const toggle = (c: Company) => {
    if (disabled) return;
    const k = keyOf(c);
    if (props.mode === 'multi') {
      const isSel = selectedSet.has(k);
      props.onChange(isSel ? props.value.filter(v => v !== k) : [...props.value, k]);
    } else {
      const isSel = props.value === k;
      props.onChange(isSel ? null : k);
    }
  };

  const isMulti = props.mode === 'multi';
  const showActions = isMulti && (props as MultiProps).showSelectAll !== false && companies.length > 5;

  return (
    <View>
      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={14} color={C.textMuted} style={{ marginRight: 6 }} />
        <TextInput
          style={styles.searchInput}
          placeholder={searchPlaceholder}
          placeholderTextColor={C.textMuted}
          value={query}
          onChangeText={setQuery}
          editable={!disabled}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={C.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Selected pills */}
      {selectedCompanies.length > 0 && (
        <View style={styles.selectedRow}>
          {selectedCompanies.map(co => (
            <TouchableOpacity
              key={co.id}
              style={[styles.pill, { borderColor: co.color, backgroundColor: co.color + '18' }]}
              onPress={() => toggle(co)}
              activeOpacity={0.7}
              disabled={disabled}
            >
              <View style={[styles.pillDot, { backgroundColor: co.color }]} />
              <Text style={[styles.pillText, { color: co.color }]} numberOfLines={1}>
                {co.shortName || co.name}
              </Text>
              {!disabled && <Ionicons name="close" size={12} color={co.color} />}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Bulk actions */}
      {showActions && (
        <View style={styles.actionsRow}>
          <Text style={styles.counterText}>
            {selectedCompanies.length}/{companies.length} sélectionnée{selectedCompanies.length > 1 ? 's' : ''}
            {query ? ` · ${filtered.length} résultat${filtered.length > 1 ? 's' : ''}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {filtered.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  if (!isMulti) return;
                  const keys = filtered.map(keyOf);
                  const merged = Array.from(new Set([...(props as MultiProps).value, ...keys]));
                  (props as MultiProps).onChange(merged);
                }}
                style={styles.actionBtn}
                disabled={disabled}
              >
                <Text style={styles.actionBtnText}>
                  {query ? 'Sélectionner ces résultats' : 'Tout sélectionner'}
                </Text>
              </TouchableOpacity>
            )}
            {selectedCompanies.length > 0 && (
              <TouchableOpacity
                onPress={() => isMulti && (props as MultiProps).onChange([])}
                style={[styles.actionBtn, styles.actionBtnDanger]}
                disabled={disabled}
              >
                <Text style={[styles.actionBtnText, { color: C.critical }]}>Effacer</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Single-select "Aucune" option */}
      {props.mode === 'single' && (props as SingleProps).allowNone && !query && (
        <TouchableOpacity
          style={[styles.row, props.value === null && styles.rowSelectedNeutral]}
          onPress={() => !disabled && props.onChange(null)}
          activeOpacity={0.7}
        >
          <View style={styles.dotPlaceholder} />
          <Text style={[styles.rowName, props.value === null && { fontFamily: 'Inter_600SemiBold' }]}>
            {(props as SingleProps).noneLabel || 'Aucune'}
          </Text>
          {props.value === null && <Ionicons name="checkmark-circle" size={16} color={C.primary} />}
        </TouchableOpacity>
      )}

      {/* List */}
      <ScrollView
        style={[styles.list, { maxHeight: maxListHeight }]}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        {filtered.length === 0 ? (
          <View style={styles.noResults}>
            <Ionicons name="search-outline" size={16} color={C.textMuted} />
            <Text style={styles.noResultsText}>Aucune entreprise ne correspond à "{query}"</Text>
          </View>
        ) : (
          filtered.map(co => {
            const sel = selectedSet.has(keyOf(co));
            return (
              <TouchableOpacity
                key={co.id}
                style={[styles.row, sel && { borderColor: co.color, backgroundColor: co.color + '12' }]}
                onPress={() => toggle(co)}
                activeOpacity={0.7}
                disabled={disabled}
              >
                <View style={[styles.dot, { backgroundColor: co.color }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={[styles.rowName, sel && { color: co.color, fontFamily: 'Inter_600SemiBold' }]}
                    numberOfLines={1}
                  >
                    {co.name}
                  </Text>
                  {co.shortName && co.shortName !== co.name && (
                    <Text style={styles.rowShort} numberOfLines={1}>{co.shortName}</Text>
                  )}
                </View>
                {isMulti ? (
                  <View style={[styles.checkbox, sel && { backgroundColor: co.color, borderColor: co.color }]}>
                    {sel && <Ionicons name="checkmark" size={12} color="#fff" />}
                  </View>
                ) : (
                  sel && <Ionicons name="checkmark-circle" size={18} color={co.color} />
                )}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, backgroundColor: C.surface2, borderRadius: 8 },
  emptyText: { fontSize: 12, color: C.textMuted, fontFamily: 'Inter_400Regular', flex: 1 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface2, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: C.border,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular',
    color: C.text, paddingVertical: 4,
  },

  selectedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 14, borderWidth: 1, maxWidth: '100%',
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', maxWidth: 120 },

  actionsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 6, gap: 8, flexWrap: 'wrap',
  },
  counterText: { fontSize: 11, color: C.textMuted, fontFamily: 'Inter_400Regular', flex: 1 },
  actionBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  actionBtnDanger: { borderColor: C.critical + '40' },
  actionBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.text },

  list: { borderRadius: 10 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9, paddingHorizontal: 10,
    borderRadius: 10, borderWidth: 1, borderColor: C.border,
    marginBottom: 5, backgroundColor: C.surface,
  },
  rowSelectedNeutral: { borderColor: C.primary, backgroundColor: C.primary + '10' },
  dot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  dotPlaceholder: { width: 10, height: 10, flexShrink: 0 },
  rowName: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  rowShort: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5,
    borderColor: C.border, backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },

  noResults: { alignItems: 'center', gap: 6, padding: 16 },
  noResultsText: { fontSize: 12, color: C.textMuted, fontFamily: 'Inter_400Regular', textAlign: 'center' },
});
