import {
  View, Text, StyleSheet, SectionList, TouchableOpacity, Modal,
  TextInput, Platform, Alert, TouchableWithoutFeedback, ScrollView, KeyboardAvoidingView,
} from 'react-native';
import DateInput from '@/components/DateInput';
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { useReglementaire } from '@/context/ReglementaireContext';
import Header from '@/components/Header';
import { RegulatoryDoc, RegDocType, RegDocStatus } from '@/constants/types';
import BottomNavBar from '@/components/BottomNavBar';

const DOC_TYPES: { value: RegDocType; labelKey: string; descKey: string; icon: string; color: string }[] = [
  { value: 'ppsps', labelKey: 'regulatory.docTypes.ppsps.label', descKey: 'regulatory.docTypes.ppsps.desc', icon: 'shield-checkmark', color: '#DC2626' },
  { value: 'dict', labelKey: 'regulatory.docTypes.dict.label', descKey: 'regulatory.docTypes.dict.desc', icon: 'document-text', color: '#2563EB' },
  { value: 'doe', labelKey: 'regulatory.docTypes.doe.label', descKey: 'regulatory.docTypes.doe.desc', icon: 'folder-open', color: '#7C3AED' },
  { value: 'plan_prevention', labelKey: 'regulatory.docTypes.plan_prevention.label', descKey: 'regulatory.docTypes.plan_prevention.desc', icon: 'warning', color: '#D97706' },
  { value: 'declaration_prealable', labelKey: 'regulatory.docTypes.declaration_prealable.label', descKey: 'regulatory.docTypes.declaration_prealable.desc', icon: 'document', color: '#059669' },
  { value: 'dpae', labelKey: 'regulatory.docTypes.dpae.label', descKey: 'regulatory.docTypes.dpae.desc', icon: 'people', color: '#DB2777' },
  { value: 'autre', labelKey: 'regulatory.docTypes.autre.label', descKey: 'regulatory.docTypes.autre.desc', icon: 'attach', color: '#6B7280' },
];

const STATUS_CONFIG: Record<RegDocStatus, { labelKey: string; color: string; bg: string; icon: string }> = {
  valid: { labelKey: 'regulatory.status.valid', color: C.closed, bg: C.closedBg, icon: 'checkmark-circle' },
  expiring: { labelKey: 'regulatory.status.expiring', color: C.medium, bg: C.mediumBg, icon: 'time' },
  expired: { labelKey: 'regulatory.status.expired', color: C.open, bg: C.openBg, icon: 'close-circle' },
  missing: { labelKey: 'regulatory.status.missing', color: C.open, bg: C.openBg, icon: 'alert-circle' },
  in_progress: { labelKey: 'regulatory.status.in_progress', color: C.inProgress, bg: C.inProgressBg, icon: 'hourglass' },
};

const STATUSES: RegDocStatus[] = ['valid', 'in_progress', 'expiring', 'expired', 'missing'];

function getTypeInfo(type: RegDocType) {
  return DOC_TYPES.find(t => t.value === type) ?? DOC_TYPES[DOC_TYPES.length - 1];
}

export default function ReglementaireScreen() {
  const { t } = useTranslation();
  const { user, permissions } = useAuth();
  const { docs, addDoc, updateDoc, deleteDoc } = useReglementaire();

  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<RegulatoryDoc | null>(null);
  const [filterStatus, setFilterStatus] = useState<RegDocStatus | ''>('');

  const [selectedType, setSelectedType] = useState<RegDocType>('ppsps');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [reference, setReference] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [status, setStatus] = useState<RegDocStatus>('missing');
  const [notes, setNotes] = useState('');

  const grouped = useMemo(() => {
    const filtered = docs.filter(d => !filterStatus || d.status === filterStatus);
    const map: Record<string, RegulatoryDoc[]> = {};
    filtered.forEach(d => {
      const label = t(getTypeInfo(d.type).labelKey);
      if (!map[label]) map[label] = [];
      map[label].push(d);
    });
    return Object.entries(map).map(([title, data]) => ({ title, data }));
  }, [docs, filterStatus, t]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { valid: 0, expiring: 0, expired: 0, missing: 0, in_progress: 0 };
    docs.forEach(d => { c[d.status] = (c[d.status] ?? 0) + 1; });
    return c;
  }, [docs]);

  function openAdd() {
    setEditTarget(null);
    setSelectedType('ppsps');
    setTitle('');
    setCompany('');
    setReference('');
    setIssueDate('');
    setExpiryDate('');
    setStatus('missing');
    setNotes('');
    setModalVisible(true);
  }

  function openEdit(doc: RegulatoryDoc) {
    setEditTarget(doc);
    setSelectedType(doc.type);
    setTitle(doc.title);
    setCompany(doc.company ?? '');
    setReference(doc.reference ?? '');
    setIssueDate(doc.issueDate ?? '');
    setExpiryDate(doc.expiryDate ?? '');
    setStatus(doc.status);
    setNotes(doc.notes ?? '');
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditTarget(null);
  }

  async function handleSave() {
    if (!title.trim()) {
      Alert.alert(t('regulatory.requiredTitle'), t('regulatory.titleRequired'));
      return;
    }
    const payload = {
      type: selectedType,
      title: title.trim(),
      company: company.trim() || undefined,
      reference: reference.trim() || undefined,
      issueDate: issueDate.trim() || undefined,
      expiryDate: expiryDate.trim() || undefined,
      status,
      notes: notes.trim() || undefined,
      createdBy: user?.name ?? t('settings.systemUser'),
    };
    if (editTarget) {
      await updateDoc(editTarget.id, payload);
    } else {
      await addDoc(payload);
    }
    closeModal();
  }

  function handleDelete(doc: RegulatoryDoc) {
    Alert.alert(t('regulatory.deleteTitle'), t('regulatory.deleteText', { title: doc.title }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => deleteDoc(doc.id) },
    ]);
  }

  function handleStatusChange(doc: RegulatoryDoc) {
    const idx = STATUSES.indexOf(doc.status);
    const next = STATUSES[(idx + 1) % STATUSES.length];
    Alert.alert(
      t('regulatory.changeStatusTitle'),
      t('regulatory.changeStatusText', { title: doc.title, status: t(STATUS_CONFIG[next].labelKey) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('regulatory.confirm'), onPress: () => updateDoc(doc.id, { status: next }) },
      ]
    );
  }

  const alertCount = (counts.expired ?? 0) + (counts.missing ?? 0);

  return (
    <View style={styles.container}>
      <Header
        title={t('regulatory.headerTitle')}
        subtitle={t('regulatory.headerSubtitle')}
        showBack
        rightIcon={permissions.canCreate ? 'add-outline' : undefined}
        onRightPress={permissions.canCreate ? openAdd : undefined}
      />

      <View style={styles.statusBar}>
        {Object.entries(counts).filter(([, v]) => v > 0).map(([key, val]) => {
          const cfg = STATUS_CONFIG[key as RegDocStatus];
          return (
            <TouchableOpacity
              key={key}
              style={[styles.statusChip, { backgroundColor: cfg.bg, borderColor: cfg.color + '50' }, filterStatus === key && { borderColor: cfg.color, borderWidth: 2 }]}
              onPress={() => setFilterStatus(prev => prev === key ? '' : key as RegDocStatus)}
            >
              <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
              <Text style={[styles.statusChipText, { color: cfg.color }]}>{val} {t(cfg.labelKey)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {alertCount > 0 && (
        <View style={styles.alertBanner}>
          <Ionicons name="alert-circle" size={18} color={C.open} />
          <Text style={styles.alertText}>{t('regulatory.alertCount', { count: alertCount })}</Text>
        </View>
      )}

      {docs.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="document-lock-outline" size={56} color={C.textMuted} />
          <Text style={styles.emptyTitle}>{t('regulatory.emptyTitle')}</Text>
          <Text style={styles.emptyHint}>{t('regulatory.emptyHint')}</Text>
          {permissions.canCreate && (
            <TouchableOpacity style={styles.emptyBtn} onPress={openAdd}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.emptyBtnText}>{t('regulatory.addDocument')}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <SectionList
          sections={grouped}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderSectionHeader={({ section }) => {
            const typeInfo = DOC_TYPES.find(docType => t(docType.labelKey) === section.title);
            return (
              <View style={styles.sectionHeader}>
                {typeInfo && (
                  <View style={[styles.sectionIcon, { backgroundColor: typeInfo.color + '20' }]}>
                    <Ionicons name={typeInfo.icon as any} size={14} color={typeInfo.color} />
                  </View>
                )}
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.sectionCount}>{section.data.length}</Text>
              </View>
            );
          }}
          renderItem={({ item }) => {
            const typeInfo = getTypeInfo(item.type);
            const statusCfg = STATUS_CONFIG[item.status];
            return (
              <View style={styles.card}>
                <View style={[styles.cardLeft, { backgroundColor: typeInfo.color + '15' }]}>
                  <Ionicons name={typeInfo.icon as any} size={22} color={typeInfo.color} />
                </View>
                <View style={styles.cardBody}>
                  <View style={styles.cardTop}>
                    <Text style={styles.docTitle} numberOfLines={2}>{item.title}</Text>
                    <TouchableOpacity
                      style={[styles.statusBadge, { backgroundColor: statusCfg.bg, borderColor: statusCfg.color + '40' }]}
                      onPress={() => handleStatusChange(item)}
                    >
                      <Ionicons name={statusCfg.icon as any} size={11} color={statusCfg.color} />
                      <Text style={[styles.statusText, { color: statusCfg.color }]}>{t(statusCfg.labelKey)}</Text>
                    </TouchableOpacity>
                  </View>
                  {item.company && (
                    <Text style={styles.docMeta}><Ionicons name="business-outline" size={11} /> {item.company}</Text>
                  )}
                  {item.reference && (
                    <Text style={styles.docMeta}>{t('regulatory.referenceShort', { reference: item.reference })}</Text>
                  )}
                  <View style={styles.datesRow}>
                    {item.issueDate && (
                      <Text style={styles.dateText}>{t('regulatory.issuedOn', { date: item.issueDate })}</Text>
                    )}
                    {item.expiryDate && (
                      <Text style={[styles.dateText, item.status === 'expired' && { color: C.open }]}>
                        {t('regulatory.expiresOn', { date: item.expiryDate })}
                      </Text>
                    )}
                  </View>
                  {item.notes && (
                    <Text style={styles.notesText} numberOfLines={2}>{item.notes}</Text>
                  )}
                  <View style={styles.cardActions}>
                    {permissions.canEdit && (
                      <TouchableOpacity style={styles.actionBtn} onPress={() => openEdit(item)}>
                        <Ionicons name="pencil-outline" size={14} color={C.primary} />
                        <Text style={styles.actionBtnText}>{t('common.edit')}</Text>
                      </TouchableOpacity>
                    )}
                    {permissions.canDelete && (
                      <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={() => handleDelete(item)}>
                        <Ionicons name="trash-outline" size={14} color={C.open} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={() => (
            <View style={[styles.empty, { paddingTop: 40 }]}>
              <Ionicons name="filter-outline" size={40} color={C.textMuted} />
              <Text style={styles.emptyHint}>{t('regulatory.emptyFilter')}</Text>
            </View>
          )}
        />
      )}

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={closeModal}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableWithoutFeedback onPress={closeModal}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editTarget ? t('regulatory.editDocument') : t('regulatory.newDocument')}</Text>
              <TouchableOpacity onPress={closeModal}>
                <Ionicons name="close" size={22} color={C.textSub} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.fieldLabel}>{t('regulatory.documentType')}</Text>
              <View style={styles.typeGrid}>
                {DOC_TYPES.map(docType => (
                  <TouchableOpacity
                    key={docType.value}
                    style={[styles.typeChip, selectedType === docType.value && { backgroundColor: docType.color, borderColor: docType.color }]}
                    onPress={() => {
                      setSelectedType(docType.value);
                      if (!title) setTitle(t(docType.labelKey));
                    }}
                  >
                    <Ionicons name={docType.icon as any} size={14} color={selectedType === docType.value ? '#fff' : docType.color} />
                    <Text style={[styles.typeChipText, selectedType === docType.value && { color: '#fff' }]}>{t(docType.labelKey)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {selectedType && (
                <Text style={styles.typeDesc}>{t(getTypeInfo(selectedType).descKey)}</Text>
              )}

              <Text style={styles.fieldLabel}>{t('regulatory.titleLabel')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('regulatory.titlePlaceholder')}
                placeholderTextColor={C.textMuted}
                value={title}
                onChangeText={setTitle}
              />

              <Text style={styles.fieldLabel}>{t('regulatory.company')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('regulatory.companyPlaceholder')}
                placeholderTextColor={C.textMuted}
                value={company}
                onChangeText={setCompany}
              />

              <Text style={styles.fieldLabel}>{t('regulatory.reference')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('regulatory.referencePlaceholder')}
                placeholderTextColor={C.textMuted}
                value={reference}
                onChangeText={setReference}
              />

              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <DateInput label={t('regulatory.issueDate')} value={issueDate} onChange={setIssueDate} optional />
                </View>
                <View style={{ width: 12 }} />
                <View style={{ flex: 1 }}>
                  <DateInput label={t('regulatory.expiryDate')} value={expiryDate} onChange={setExpiryDate} optional />
                </View>
              </View>

              <Text style={styles.fieldLabel}>{t('regulatory.statusLabel')}</Text>
              <View style={styles.statusGrid}>
                {STATUSES.map(s => {
                  const cfg = STATUS_CONFIG[s];
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[styles.statusOption, { borderColor: cfg.color + '50' }, status === s && { backgroundColor: cfg.bg, borderColor: cfg.color }]}
                      onPress={() => setStatus(s)}
                    >
                      <Ionicons name={cfg.icon as any} size={14} color={status === s ? cfg.color : C.textMuted} />
                      <Text style={[styles.statusOptionText, status === s && { color: cfg.color, fontFamily: 'Inter_600SemiBold' }]}>{t(cfg.labelKey)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>{t('regulatory.notes')}</Text>
              <TextInput
                style={[styles.input, { minHeight: 70 }]}
                placeholder={t('regulatory.notesPlaceholder')}
                placeholderTextColor={C.textMuted}
                value={notes}
                onChangeText={setNotes}
                multiline
              />

              <TouchableOpacity
                style={[styles.saveBtn, !title.trim() && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={!title.trim()}
              >
                <Text style={styles.saveBtnText}>{editTarget ? t('regulatory.saveChanges') : t('regulatory.addDocument')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  statusBar: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  statusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    borderWidth: 1,
  },
  statusChipText: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.openBg, paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.open + '30',
  },
  alertText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.open, flex: 1 },

  listContent: { padding: 16, paddingBottom: 40 },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 16, marginBottom: 8,
  },
  sectionIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { flex: 1, fontSize: 13, fontFamily: 'Inter_700Bold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionCount: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textMuted, backgroundColor: C.surface2, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },

  card: {
    flexDirection: 'row', backgroundColor: C.surface, borderRadius: 12,
    marginBottom: 8, borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  cardLeft: { width: 48, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, padding: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  docTitle: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, lineHeight: 20 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1,
  },
  statusText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  docMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 2 },
  datesRow: { flexDirection: 'row', gap: 16, marginTop: 4 },
  dateText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },
  notesText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, fontStyle: 'italic', marginTop: 6 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '30',
  },
  actionBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  deleteBtn: { backgroundColor: C.openBg, borderColor: C.open + '40', paddingHorizontal: 8 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', lineHeight: 20 },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primary, paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 10, marginTop: 8,
  },
  emptyBtnText: { color: '#fff', fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 32, maxHeight: '92%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text, flex: 1, marginRight: 8 },

  fieldLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 11, fontSize: 14, fontFamily: 'Inter_400Regular',
    color: C.text, borderWidth: 1, borderColor: C.border, marginBottom: 14,
  },
  twoCol: { flexDirection: 'row' },

  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  typeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface2,
  },
  typeChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  typeDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginBottom: 14, fontStyle: 'italic' },

  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  statusOption: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, backgroundColor: C.surface2,
  },
  statusOptionText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },

  saveBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  saveBtnDisabled: { backgroundColor: C.textMuted },
  saveBtnText: { color: '#fff', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
