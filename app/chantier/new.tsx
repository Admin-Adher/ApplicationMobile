import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import LocationTreeEditor from '@/components/LocationTreeEditor';
import CompanySelector from '@/components/CompanySelector';
import { Chantier, ChantierBuilding } from '@/constants/types';
import { genId, formatDateFR } from '@/lib/utils';

export default function NewChantierScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { addChantier, chantiers, companies, setActiveChantier } = useApp();
  const { user, permissions } = useAuth();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [buildings, setBuildings] = useState<ChantierBuilding[]>([
    { id: genId(), name: t('chantierForm.defaultBuilding'), levels: [{ id: genId(), name: 'RDC', zones: [] }] },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!permissions.canCreate) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F1117', padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color="#6B7280" />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#F9FAFB', marginTop: 16, textAlign: 'center' }}>
          {t('chantierForm.accessDenied')}
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 8, textAlign: 'center' }}>
          {t('chantierForm.createDenied')}
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#1D4ED8', borderRadius: 10 }}
        >
          <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>{t('chantierForm.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function toggleChantierCompany(id: string) {
    setSelectedCompanyIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function handleSubmit() {
    if (isSubmitting) return;
    if (!name.trim()) {
      Alert.alert(t('chantierForm.requiredField'), t('chantierForm.nameRequired'));
      return;
    }
    if (buildings.length === 0) {
      Alert.alert(t('chantierForm.structureRequired'), t('chantierForm.structureRequiredMessage'));
      return;
    }
    const emptyBuilding = buildings.find(b => !b.name.trim());
    if (emptyBuilding) {
      Alert.alert(t('chantierForm.missingName'), t('chantierForm.missingNameMessage'));
      return;
    }
    const buildingWithoutLevel = buildings.find(b => b.levels.length === 0);
    if (buildingWithoutLevel) {
      Alert.alert(
        t('chantierForm.missingLevel'),
        t('chantierForm.missingLevelMessage', { building: buildingWithoutLevel.name })
      );
      return;
    }

    setIsSubmitting(true);
    const chantierId = genId();
    const todayFr = formatDateFR(new Date());

    const newChantier: Chantier = {
      id: chantierId,
      name: name.trim(),
      address: address.trim() || undefined,
      description: description.trim() || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      status: 'active',
      createdAt: todayFr,
      createdBy: user?.name ?? t('chantierForm.unknownUser'),
      companyIds: selectedCompanyIds.length > 0 ? selectedCompanyIds : undefined,
      buildings,
    };

    try {
      await addChantier(newChantier, []);
      // Fix 14: set the new chantier as active immediately after creation
      setActiveChantier(chantierId);
      Alert.alert(
        t('chantierForm.createdTitle'),
        t('chantierForm.createdMessage', { name: name.trim() }),
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch {
      // Fix 5: reset isSubmitting so the button isn't stuck disabled
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Header title={t('chantierForm.newTitle')} showBack rightLabel={t('chantierForm.create')} onRightPress={handleSubmit} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        <View style={styles.card}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('chantierForm.nameLabel')} *</Text>
            <TextInput
              style={styles.input}
              placeholder={t('chantierForm.namePlaceholder')}
              placeholderTextColor={C.textMuted}
              value={name}
              onChangeText={setName}
              autoFocus
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('chantierForm.addressLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('chantierForm.addressPlaceholder')}
              placeholderTextColor={C.textMuted}
              value={address}
              onChangeText={setAddress}
            />
          </View>
          <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
            <Text style={styles.label}>{t('chantierForm.descriptionLabel')}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder={t('chantierForm.descriptionPlaceholder')}
              placeholderTextColor={C.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
            />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.dateRow}>
            <View style={{ flex: 1 }}>
              <DateInput label={t('chantierForm.startDate')} value={startDate} onChange={setStartDate} optional />
            </View>
            <View style={{ flex: 1 }}>
              <DateInput label={t('chantierForm.endDate')} value={endDate} onChange={setEndDate} optional />
            </View>
          </View>
        </View>

        {companies.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.label}>{t('chantierForm.associatedCompanies')}</Text>
            <Text style={styles.hint}>{t('chantierForm.companiesHint')}</Text>
            <CompanySelector
              mode="multi"
              identifier="id"
              companies={companies}
              value={selectedCompanyIds}
              onChange={(next) => {
                const toAdd = next.filter(id => !selectedCompanyIds.includes(id));
                const toRemove = selectedCompanyIds.filter(id => !next.includes(id));
                toAdd.forEach(id => toggleChantierCompany(id));
                toRemove.forEach(id => toggleChantierCompany(id));
              }}
            />
          </View>
        )}

        {/* STRUCTURE DU BÂTIMENT */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Ionicons name="business-outline" size={16} color={C.primary} />
            <Text style={styles.sectionTitle}>{t('chantierForm.structureTitle')} *</Text>
          </View>
          <Text style={styles.hint}>
            {t('chantierForm.structureHint')}
          </Text>
          <LocationTreeEditor buildings={buildings} onChange={setBuildings} />
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, isSubmitting && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          <Ionicons name="checkmark-circle" size={20} color="#fff" />
          <Text style={styles.submitBtnText}>
            {isSubmitting ? t('chantierForm.creating') : t('chantierForm.createSite')}
          </Text>
        </TouchableOpacity>

        {chantiers.length > 0 && (
          <View style={styles.existingNote}>
            <Ionicons name="information-circle-outline" size={14} color={C.textMuted} />
            <Text style={styles.existingNoteText}>
              {t('chantierForm.activeNote')}
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 48 },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  fieldGroup: { marginBottom: 14 },
  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  hint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginBottom: 14, lineHeight: 17 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  sectionTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  coRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2, marginBottom: 6 },
  coDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  coName: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  coShort: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  coCheck: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  input: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14,
    borderWidth: 1, borderColor: C.border,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  dateRow: { flexDirection: 'row', gap: 12 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, gap: 8, marginTop: 4 },
  submitBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  existingNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 14, padding: 12, backgroundColor: C.surface2, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  existingNoteText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 17 },
});
