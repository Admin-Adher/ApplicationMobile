import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, Linking, Switch, TextInput, Modal, KeyboardAvoidingView,
} from 'react-native';
import { showAlert } from '@/lib/appAlert';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import Header from '@/components/Header';
import PageContainer from '@/components/PageContainer';
import BottomNavBar from '@/components/BottomNavBar';
import { BTPIntegration } from '@/constants/types';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'expo-router';
import { goBack } from '@/lib/nav';

const INTEGRATION_CATEGORIES = ['project', 'bim', 'regulatory', 'geolocation', 'forms', 'dms', 'signature', 'weather', 'hr'] as const;
type IntegrationCategory = typeof INTEGRATION_CATEGORIES[number];

const INTEGRATIONS_CATALOG: (Omit<BTPIntegration, 'enabled' | 'apiKey' | 'webhookUrl' | 'lastSync' | 'description'> & { category: IntegrationCategory; docsUrl: string; featureCount: number })[] = [
  {
    id: 'procore',
    name: 'Procore',
    type: 'procore',
    provider: 'Procore Technologies',
    logoUri: '',
    category: 'project',
    docsUrl: 'https://developers.procore.com',
    featureCount: 4,
  },
  {
    id: 'archicad',
    name: 'ArchiCAD',
    type: 'autodesk',
    provider: 'Graphisoft',
    logoUri: '',
    category: 'bim',
    docsUrl: 'https://graphisoft.com/solutions/archicad',
    featureCount: 3,
  },
  {
    id: 'revit',
    name: 'Autodesk Revit',
    type: 'autodesk',
    provider: 'Autodesk',
    logoUri: '',
    category: 'bim',
    docsUrl: 'https://www.autodesk.com/products/revit',
    featureCount: 3,
  },
  {
    id: 'e-diffusion',
    name: 'e-Diffusion BTP',
    type: 'generic',
    provider: 'e-Diffusion',
    logoUri: '',
    category: 'regulatory',
    docsUrl: 'https://www.e-diffusion.fr',
    featureCount: 3,
  },
  {
    id: 'geosat',
    name: 'Géosat GPS',
    type: 'generic',
    provider: 'Géosat',
    logoUri: '',
    category: 'geolocation',
    docsUrl: 'https://www.geosat.fr',
    featureCount: 3,
  },
  {
    id: 'kizeo',
    name: 'Kizeo Forms',
    type: 'generic',
    provider: 'Kizeo',
    logoUri: '',
    category: 'forms',
    docsUrl: 'https://www.kizeoforms.com',
    featureCount: 3,
  },
  {
    id: 'docuware',
    name: 'DocuWare',
    type: 'google_drive',
    provider: 'DocuWare',
    logoUri: '',
    category: 'dms',
    docsUrl: 'https://start.docuware.com',
    featureCount: 3,
  },
  {
    id: 'signaturit',
    name: 'Signaturit',
    type: 'generic',
    provider: 'Signaturit',
    logoUri: '',
    category: 'signature',
    docsUrl: 'https://www.signaturit.com',
    featureCount: 4,
  },
  {
    id: 'meteofrance',
    name: 'Météo-France API',
    type: 'generic',
    provider: 'Météo-France',
    logoUri: '',
    category: 'weather',
    docsUrl: 'https://portail-api.meteofrance.fr',
    featureCount: 4,
  },
  {
    id: 'urssaf-btp',
    name: 'URSSAF BTP',
    type: 'generic',
    provider: 'URSSAF',
    logoUri: '',
    category: 'hr',
    docsUrl: 'https://www.urssaf.fr',
    featureCount: 3,
  },
];

const CATEGORY_COLORS: Record<IntegrationCategory, string> = {
  project: C.primary,
  bim: '#7C3AED',
  regulatory: '#0891B2',
  geolocation: '#059669',
  forms: C.inProgress,
  dms: '#BE185D',
  signature: '#6366F1',
  weather: '#0EA5E9',
  hr: '#F59E0B',
};

const CATEGORY_LABEL_KEYS: Record<IntegrationCategory, string> = {
  project: 'integrationsScreen.categories.project',
  bim: 'integrationsScreen.categories.bim',
  regulatory: 'integrationsScreen.categories.regulatory',
  geolocation: 'integrationsScreen.categories.geolocation',
  forms: 'integrationsScreen.categories.forms',
  dms: 'integrationsScreen.categories.dms',
  signature: 'integrationsScreen.categories.signature',
  weather: 'integrationsScreen.categories.weather',
  hr: 'integrationsScreen.categories.hr',
};

const INTEGRATION_TEXT_KEYS = Object.fromEntries(
  INTEGRATIONS_CATALOG.map(integration => [
    integration.id,
    {
      description: `integrationsScreen.integrations.${integration.id}.description`,
      features: Array.from({ length: integration.featureCount }, (_, index) => `integrationsScreen.integrations.${integration.id}.features.${index}`),
    },
  ]),
) as Record<string, { description: string; features: string[] }>;

export default function IntegrationsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();

  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [configModal, setConfigModal] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [webhookInput, setWebhookInput] = useState('');
  const [apiKeysStored, setApiKeysStored] = useState<Record<string, string>>({});
  const [selectedCategory, setSelectedCategory] = useState<IntegrationCategory | null>(null);

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 16, textAlign: 'center' }}>
          {t('integrationsScreen.restrictedTitle')}
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 8, textAlign: 'center' }}>
          {t('integrationsScreen.restrictedText')}
        </Text>
        <TouchableOpacity
          onPress={() => goBack()}
          style={{ marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 10 }}
        >
          <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>{t('common.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const categories = [...new Set(INTEGRATIONS_CATALOG.map(i => i.category))];
  const filtered = selectedCategory
    ? INTEGRATIONS_CATALOG.filter(i => i.category === selectedCategory)
    : INTEGRATIONS_CATALOG;

  const enabledCount = Object.values(enabledMap).filter(Boolean).length;

  function openConfig(integrationId: string) {
    const saved = apiKeysStored[integrationId] ?? '';
    setApiKeyInput(saved);
    setWebhookInput('');
    setConfigModal(integrationId);
  }

  function saveConfig() {
    if (!configModal) return;
    setApiKeysStored(prev => ({ ...prev, [configModal]: apiKeyInput }));
    setConfigModal(null);
    showAlert(t('integrationsScreen.configSavedTitle'), t('integrationsScreen.configSavedText'), [{ text: 'OK' }]);
  }

  function toggleIntegration(id: string, value: boolean) {
    if (value && !apiKeysStored[id]) {
      openConfig(id);
      return;
    }
    setEnabledMap(prev => ({ ...prev, [id]: value }));
    if (value) {
      showAlert(t('integrationsScreen.enabledTitle'), t('integrationsScreen.enabledText'), [{ text: 'OK' }]);
    }
  }

  return (
    <View style={styles.container}>
      <Header
        title={t('integrationsScreen.title')}
        subtitle={t('integrationsScreen.subtitle', { enabled: enabledCount, total: INTEGRATIONS_CATALOG.length })}
        showBack
      />

      <PageContainer maxWidth={900}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Banner */}
        <View style={styles.banner}>
          <Ionicons name="git-network-outline" size={28} color={C.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>{t('integrationsScreen.bannerTitle')}</Text>
            <Text style={styles.bannerSub}>{t('integrationsScreen.bannerText')}</Text>
          </View>
        </View>

        {/* Category filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catRow} contentContainerStyle={{ gap: 8 }}>
          <TouchableOpacity
            style={[styles.catChip, !selectedCategory && styles.catChipActive]}
            onPress={() => setSelectedCategory(null)}
          >
            <Text style={[styles.catChipText, !selectedCategory && styles.catChipTextActive]}>{t('common.all')}</Text>
          </TouchableOpacity>
          {categories.map(cat => (
            <TouchableOpacity
              key={cat}
              style={[styles.catChip, selectedCategory === cat && { backgroundColor: (CATEGORY_COLORS[cat] ?? C.primary) + '20', borderColor: CATEGORY_COLORS[cat] ?? C.primary }]}
              onPress={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
            >
              <Text style={[styles.catChipText, selectedCategory === cat && { color: CATEGORY_COLORS[cat] ?? C.primary }]}>{t(CATEGORY_LABEL_KEYS[cat])}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Integration cards */}
        {filtered.map(integration => {
          const isEnabled = enabledMap[integration.id] ?? false;
          const hasKey = !!apiKeysStored[integration.id];
          const catColor = CATEGORY_COLORS[integration.category] ?? C.primary;

          return (
            <View key={integration.id} style={[styles.card, isEnabled && styles.cardActive]}>
              <View style={styles.cardHeader}>
                <View style={[styles.logoPlaceholder, { backgroundColor: catColor + '20' }]}>
                  <Ionicons name="git-network" size={22} color={catColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.integName}>{integration.name}</Text>
                    <View style={[styles.catBadge, { backgroundColor: catColor + '20' }]}>
                      <Text style={[styles.catBadgeText, { color: catColor }]}>{t(CATEGORY_LABEL_KEYS[integration.category])}</Text>
                    </View>
                  </View>
                  <Text style={styles.integProvider}>{integration.provider}</Text>
                </View>
                <Switch
                  value={isEnabled}
                  onValueChange={v => toggleIntegration(integration.id, v)}
                  trackColor={{ false: C.border, true: catColor + '60' }}
                  thumbColor={isEnabled ? catColor : C.textMuted}
                />
              </View>

              <Text style={styles.integDesc}>{t(INTEGRATION_TEXT_KEYS[integration.id].description)}</Text>

              <View style={styles.featuresRow}>
                {Array.from({ length: Math.min(integration.featureCount, 3) }).map((_, fi) => (
                  <View key={fi} style={styles.featureChip}>
                    <Ionicons name="checkmark" size={10} color={catColor} />
                    <Text style={[styles.featureText, { color: catColor }]}>{t(INTEGRATION_TEXT_KEYS[integration.id].features[fi])}</Text>
                  </View>
                ))}
                {integration.featureCount > 3 && (
                  <View style={[styles.featureChip, { backgroundColor: C.surface2 }]}>
                    <Text style={styles.featureText}>+{integration.featureCount - 3}</Text>
                  </View>
                )}
              </View>

              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.configBtn}
                  onPress={() => openConfig(integration.id)}
                >
                  <Ionicons name={hasKey ? 'key' : 'key-outline'} size={14} color={hasKey ? catColor : C.textSub} />
                  <Text style={[styles.configBtnText, hasKey && { color: catColor }]}>
                    {hasKey ? t('integrationsScreen.reconfigure') : t('integrationsScreen.configure')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.docsBtn}
                  onPress={() => {
                    if (Platform.OS !== 'web') {
                      Linking.openURL(integration.docsUrl).catch(() => {});
                    } else {
                      window.open(integration.docsUrl, '_blank');
                    }
                  }}
                >
                  <Ionicons name="open-outline" size={14} color={C.textSub} />
                  <Text style={styles.docsBtnText}>{t('integrationsScreen.documentation')}</Text>
                </TouchableOpacity>
                {isEnabled && (
                  <View style={styles.syncBadge}>
                    <View style={styles.syncDot} />
                    <Text style={styles.syncText}>{t('integrationsScreen.active')}</Text>
                  </View>
                )}
              </View>
            </View>
          );
        })}

        {/* Info card */}
        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={20} color={C.primary} />
          <Text style={styles.infoText}>
            {t('integrationsScreen.infoText')}
          </Text>
        </View>

      </ScrollView>
      </PageContainer>

      {/* Config modal */}
      <Modal visible={!!configModal} transparent animationType="slide" onRequestClose={() => setConfigModal(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {configModal && (() => {
              const integ = INTEGRATIONS_CATALOG.find(i => i.id === configModal);
              if (!integ) return null;
              return (
                <>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>{t('integrationsScreen.configureTitle', { name: integ.name })}</Text>
                    <TouchableOpacity onPress={() => setConfigModal(null)}>
                      <Ionicons name="close" size={24} color={C.text} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.modalSub}>{integ.provider}</Text>

                  <Text style={styles.fieldLabel}>{t('integrationsScreen.apiKey')}</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={apiKeyInput}
                    onChangeText={setApiKeyInput}
                    placeholder="sk-xxxxxxxxxxxxxxxxxxxx"
                    placeholderTextColor={C.textMuted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <Text style={styles.fieldLabel}>{t('integrationsScreen.webhookUrl')}</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={webhookInput}
                    onChangeText={setWebhookInput}
                    placeholder="https://webhook.example.com/buildtrack"
                    placeholderTextColor={C.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <Text style={styles.docsLink}>
                    {t('integrationsScreen.docsPrefix')}{' '}
                    <Text
                      style={{ color: C.primary, textDecorationLine: 'underline' }}
                      onPress={() => {
                        if (Platform.OS !== 'web') Linking.openURL(integ.docsUrl).catch(() => {});
                        else window.open(integ.docsUrl, '_blank');
                      }}
                    >
                      {t('integrationsScreen.docsLink', { name: integ.name })}
                    </Text>
                    {' '}{t('integrationsScreen.docsSuffix')}
                  </Text>

                  <View style={styles.modalActions}>
                    <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfigModal(null)}>
                      <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.saveBtn, !apiKeyInput.trim() && styles.saveBtnDisabled]}
                      onPress={saveConfig}
                      disabled={!apiKeyInput.trim()}
                    >
                      <Text style={styles.saveBtnText}>{t('common.save')}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              );
            })()}
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.primaryBg, borderRadius: 14, padding: 16,
    marginBottom: 14, borderWidth: 1, borderColor: C.primary + '30',
  },
  bannerTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 3 },
  bannerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 17 },

  catRow: { marginBottom: 14 },
  catChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  catChipActive: { backgroundColor: C.primary + '20', borderColor: C.primary },
  catChipText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  catChipTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },

  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    marginBottom: 12, borderWidth: 1, borderColor: C.border,
  },
  cardActive: { borderColor: C.primary + '50', backgroundColor: C.primaryBg + '80' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  logoPlaceholder: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' },
  integName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  integProvider: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },
  catBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  catBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  integDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 17, marginBottom: 10 },

  featuresRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  featureChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.surface2, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  featureText: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub },

  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  configBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: C.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  configBtnText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  docsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  docsBtnText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  syncBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.closed + '20', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  syncDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.closed },
  syncText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.closed },

  infoCard: {
    flexDirection: 'row', gap: 10, backgroundColor: C.primaryBg,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.primary + '30',
  },
  infoText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 17 },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    // Sur web desktop, un dialogue centré remplace la feuille basse mobile.
    ...(Platform.OS === 'web'
      ? { justifyContent: 'center' as const, alignItems: 'center' as const, padding: 20 }
      : { justifyContent: 'flex-end' as const }),
  },
  modalContent: {
    backgroundColor: C.surface,
    padding: 24,
    ...(Platform.OS === 'web'
      ? { borderRadius: 20, width: '100%' as const, maxWidth: 480, paddingBottom: 24 }
      : { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40 }),
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  modalSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 20 },
  fieldLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldInput: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular',
    color: C.text, backgroundColor: C.bg, marginBottom: 16,
  },
  docsLink: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 17, marginBottom: 24 },
  modalActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingVertical: 13, alignItems: 'center',
  },
  cancelBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  saveBtn: { flex: 2, backgroundColor: C.primary, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  saveBtnDisabled: { backgroundColor: C.border },
  saveBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
