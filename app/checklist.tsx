import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useState, useCallback, useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { useChecklists } from '@/hooks/queries/useChecklists';
import Header from '@/components/Header';
import PageContainer from '@/components/PageContainer';
import { Checklist, ChecklistItem } from '@/constants/types';
import BottomNavBar from '@/components/BottomNavBar';
import { showAlert } from '@/lib/appAlert';
import { genId, formatDateFR } from '@/lib/utils';

const TEMPLATE_ITEM_KEYS = [
  'ppe',
  'access',
  'scaffolding',
  'signage',
  'equipment',
  'cleanliness',
  'storage',
  'register',
];

export default function ChecklistScreen() {
  const { t } = useTranslation();
  const { user, permissions } = useAuth();
  const { activeChantierId } = useApp();
  // Persistance Supabase offline-first (la migration one-shot de l'ancienne
  // clé AsyncStorage buildtrack_checklists_v1 s'exécute au premier fetch).
  const { checklists, addChecklist, updateChecklist } = useChecklists();
  const [showNew, setShowNew] = useState(false);
  const templateItems = useMemo(
    () => TEMPLATE_ITEM_KEYS.map(key => t(`checklistScreen.templates.${key}`)),
    [t]
  );
  const [newTitle, setNewTitle] = useState('');
  const [newItems, setNewItems] = useState<string[]>(templateItems);
  const [newItemText, setNewItemText] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleCreate = useCallback(() => {
    if (!newTitle.trim()) {
      showAlert(t('checklistScreen.titleRequired'), t('checklistScreen.titleRequiredText'));
      return;
    }
    const items: ChecklistItem[] = newItems.map(label => ({
      id: genId(),
      label,
      checked: false,
    }));
    const checklist: Checklist = {
      id: genId(),
      title: newTitle.trim(),
      type: 'custom',
      building: '',
      zone: '',
      level: '',
      status: 'in_progress',
      items,
      createdAt: formatDateFR(new Date()),
      createdBy: user?.name ?? t('checklistScreen.teamFallback'),
    };
    void addChecklist({ ...checklist, chantierId: activeChantierId ?? null });
    setNewTitle('');
    setNewItems([...templateItems]);
    setShowNew(false);
  }, [newTitle, newItems, user, t, templateItems, addChecklist, activeChantierId]);

  const toggleItem = useCallback((checklistId: string, itemId: string) => {
    if (!permissions.canEdit) return;
    const cl = checklists.find(c => c.id === checklistId);
    if (!cl) return;
    const newItems = cl.items.map(it => it.id === itemId ? { ...it, checked: !it.checked } : it);
    const allChecked = newItems.length > 0 && newItems.every(it => it.checked);
    if (allChecked) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    void updateChecklist({
      ...cl,
      items: newItems,
      status: allChecked ? 'completed' : newItems.some(it => it.checked) ? 'in_progress' : 'draft',
      completedAt: allChecked ? formatDateFR(new Date()) : undefined,
    });
  }, [permissions.canEdit, checklists, updateChecklist]);

  const getProgress = (cl: Checklist) => {
    if (cl.items.length === 0) return 0;
    return Math.round((cl.items.filter(i => i.checked).length / cl.items.length) * 100);
  };

  const router = useRouter();

  if (user?.role === 'sous_traitant') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC', padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color="#94A3B8" />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#1E293B', marginTop: 16, textAlign: 'center' }}>{t('checklistScreen.restrictedTitle')}</Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: '#94A3B8', marginTop: 8, textAlign: 'center' }}>
          {t('checklistScreen.restrictedText')}
        </Text>
        <TouchableOpacity
          onPress={() => router.canGoBack() ? router.back() : router.navigate('/(tabs)/' as any)}
          style={{ marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#2563EB', borderRadius: 10 }}
        >
          <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>{t('checklistScreen.backDashboard')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Header
        title={t('checklistScreen.title')}
        subtitle={t('checklistScreen.subtitle')}
        showBack
        rightLabel={permissions.canCreate ? t('checklistScreen.new') : undefined}
        onRightPress={permissions.canCreate ? () => setShowNew(s => !s) : undefined}
      />

      <PageContainer maxWidth={800}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {showNew && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('checklistScreen.newChecklist')}</Text>
            <Text style={styles.label}>{t('checklistScreen.titleLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('checklistScreen.titlePlaceholder')}
              placeholderTextColor={C.textMuted}
              value={newTitle}
              onChangeText={setNewTitle}
            />
            <Text style={styles.label}>{t('checklistScreen.itemsToCheck')}</Text>
            {newItems.map((item, idx) => (
              <View key={idx} style={styles.templateRow}>
                <Ionicons name="checkmark-circle-outline" size={16} color={C.primary} />
                <Text style={styles.templateText}>{item}</Text>
                <TouchableOpacity onPress={() => setNewItems(prev => prev.filter((_, i) => i !== idx))}>
                  <Ionicons name="close-circle" size={18} color={C.open} />
                </TouchableOpacity>
              </View>
            ))}
            <View style={styles.addItemRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder={t('checklistScreen.addItemPlaceholder')}
                placeholderTextColor={C.textMuted}
                value={newItemText}
                onChangeText={setNewItemText}
              />
              <TouchableOpacity
                style={styles.addItemBtn}
                onPress={() => {
                  if (newItemText.trim()) {
                    setNewItems(prev => [...prev, newItemText.trim()]);
                    setNewItemText('');
                  }
                }}
              >
                <Ionicons name="add" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.createBtn} onPress={handleCreate}>
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={styles.createBtnText}>{t('checklistScreen.createChecklist')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {checklists.length === 0 && !showNew && (
          <View style={styles.emptyBox}>
            <Ionicons name="checkmark-done-circle-outline" size={52} color={C.border} />
            <Text style={styles.emptyTitle}>{t('checklistScreen.emptyTitle')}</Text>
            <Text style={styles.emptyText}>{t('checklistScreen.emptyText')}</Text>
            {permissions.canCreate && (
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowNew(true)}>
                <Ionicons name="add-circle" size={18} color={C.primary} />
                <Text style={styles.emptyBtnText}>{t('checklistScreen.createChecklist')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {checklists.map(cl => {
          const pct = getProgress(cl);
          const checked = cl.items.filter(i => i.checked).length;
          const isExpanded = expandedId === cl.id;
          return (
            <TouchableOpacity
              key={cl.id}
              style={styles.card}
              onPress={() => setExpandedId(isExpanded ? null : cl.id)}
              activeOpacity={0.85}
            >
              <View style={styles.clHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clTitle}>{cl.title}</Text>
                  <Text style={styles.clMeta}>{cl.createdBy} — {cl.createdAt}</Text>
                </View>
                <View style={styles.clBadge}>
                  <Text style={[styles.clPct, { color: pct === 100 ? C.closed : C.primary }]}>{pct}%</Text>
                </View>
                <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={C.textMuted} />
              </View>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, {
                  width: `${pct}%` as any,
                  backgroundColor: pct === 100 ? C.closed : C.primary,
                }]} />
              </View>
              <Text style={styles.clCount}>{t('checklistScreen.checkedCount', { checked, total: cl.items.length })}</Text>
              {isExpanded && (
                <View style={styles.itemList}>
                  {cl.items.map(item => (
                    <TouchableOpacity
                      key={item.id}
                      style={styles.itemRow}
                      // stopPropagation : sur web, le clic remonterait au TouchableOpacity
                      // de la carte et replierait la checklist au lieu de cocher l'item.
                      onPress={e => { e.stopPropagation?.(); toggleItem(cl.id, item.id); }}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={item.checked ? 'checkmark-circle' : 'ellipse-outline'}
                        size={20}
                        color={item.checked ? C.closed : C.textMuted}
                      />
                      <Text style={[styles.itemText, item.checked && styles.itemChecked]}>{item.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      </PageContainer>
      <BottomNavBar />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 },
  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 6, marginTop: 4 },
  input: { backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, borderWidth: 1, borderColor: C.border, marginBottom: 12 },
  templateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  templateText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  addItemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 14 },
  addItemBtn: { width: 40, height: 44, backgroundColor: C.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  createBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14 },
  createBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', lineHeight: 20, maxWidth: 280 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primaryBg, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8, borderWidth: 1, borderColor: C.primary + '40' },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  clHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  clTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  clMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  clBadge: { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: C.surface2, borderRadius: 8 },
  clPct: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  progressBg: { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', borderRadius: 3 },
  clCount: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  itemList: { marginTop: 14, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10, gap: 2 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  itemText: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
  itemChecked: { textDecorationLine: 'line-through', color: C.textMuted },
});
