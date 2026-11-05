import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, Linking, TextInput,
} from 'react-native';
import { showAlert } from '@/lib/appAlert';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import Header from '@/components/Header';
import PageContainer from '@/components/PageContainer';
import BottomNavBar from '@/components/BottomNavBar';
import { BTPIntegration } from '@/constants/types';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { canonicalApiBaseUrl } from '@/lib/apiBase';
import { supabase } from '@/lib/supabase';
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

type WebhookConnection = {
  provider: 'make' | 'n8n';
  updated_at: string;
  last_tested_at: string | null;
  last_sent_at: string | null;
};

async function requestWebhook(action: string, fields: Record<string, string> = {}): Promise<WebhookConnection | null> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Reconnectez-vous pour gérer le connecteur.');
  const base = canonicalApiBaseUrl() || 'https://buildtrack-mobile.vercel.app';
  const response = await fetch(base + '/api/organization-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
    body: JSON.stringify({ action, ...fields }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Connecteur indisponible.');
  return result.connection ?? null;
}

export default function IntegrationsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { activeChantierId, activeChantier } = useApp();
  const [webhookInput, setWebhookInput] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [connection, setConnection] = useState<WebhookConnection | null>(null);
  const [busy, setBusy] = useState('');
  const [loadError, setLoadError] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<IntegrationCategory | null>(null);
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  useEffect(() => {
    setConnection(null);
    setWebhookInput('');
    setLoadError('');
    if (!isAdmin) return;
    let mounted = true;
    setBusy('read');
    void requestWebhook('read').then(value => {
      if (mounted) setConnection(value);
    }).catch(cause => {
      if (mounted) setLoadError(cause instanceof Error ? cause.message : 'Connecteur indisponible.');
    }).finally(() => { if (mounted) setBusy(''); });
    return () => { mounted = false; };
  }, [isAdmin, user?.id, user?.organizationId]);

  async function run(action: 'save' | 'remove' | 'test' | 'send' | 'read') {
    if (busy) return;
    setBusy(action);
    setLoadError('');
    try {
      const value = await requestWebhook(action, action === 'save' ? { url: webhookInput.trim() }
        : action === 'send' && activeChantierId ? { projectId: activeChantierId } : {});
      setConnection(value);
      if (action === 'save') { setWebhookInput(''); setShowConfig(false); }
      if (action === 'test' || action === 'send') {
        showAlert(action === 'test' ? 'Connexion vérifiée' : 'Bilan transmis', 'Le fournisseur a confirmé la réception.');
      }
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Connecteur indisponible.');
    } finally {
      setBusy('');
    }
  }

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

  return (
    <View style={styles.container}>
      <Header
        title={t('integrationsScreen.title')}
        subtitle={connection ? 'Webhook d’organisation configuré' : 'Connecteur d’organisation et catalogue'}
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

        <View style={styles.card}>
          <Text style={styles.integName}>Webhook d’organisation</Text>
          <Text style={styles.integDesc}>Connectez Make ou n8n Cloud pour recevoir un bilan du chantier sur demande.</Text>
          {loadError ? <Text accessibilityRole="alert" style={styles.integDesc}>{loadError}</Text> : null}
          {busy === 'read' ? <Text style={styles.integDesc}>Chargement du connecteur…</Text> : null}
          {connection ? (
            <View style={styles.featuresRow}>
              <Text style={styles.syncText}>{connection.provider === 'make' ? 'Make' : 'n8n Cloud'}</Text>
              <Text style={styles.featureText}>{connection.last_tested_at ? 'Testé le ' + new Date(connection.last_tested_at).toLocaleString() : 'Test de connexion à faire'}</Text>
              {connection.last_sent_at ? <Text style={styles.featureText}>Dernier bilan le {new Date(connection.last_sent_at).toLocaleString()}</Text> : null}
            </View>
          ) : null}
          {showConfig ? <>
            <Text style={styles.fieldLabel}>URL HTTPS de production</Text>
            <TextInput
              value={webhookInput} onChangeText={setWebhookInput} style={styles.fieldInput}
              secureTextEntry autoCapitalize="none" autoCorrect={false} keyboardType="url"
              placeholder="https://hook.eu1.make.com/…" placeholderTextColor={C.textMuted}
              accessibilityLabel="URL du webhook"
            />
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.configBtn} disabled={!!busy || !webhookInput.trim()} onPress={() => void run('save')} accessibilityRole="button">
                <Text style={styles.configBtnText}>{busy === 'save' ? 'Enregistrement…' : t('common.save')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.configBtn} disabled={!!busy} onPress={() => { setWebhookInput(''); setShowConfig(false); }} accessibilityRole="button">
                <Text style={styles.configBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </> : (
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.configBtn} disabled={!!busy} onPress={() => setShowConfig(true)} accessibilityRole="button">
                <Text style={styles.configBtnText}>{connection ? 'Remplacer l’URL' : 'Configurer le webhook'}</Text>
              </TouchableOpacity>
              {connection ? <>
                <TouchableOpacity style={styles.configBtn} disabled={!!busy} onPress={() => void run('test')} accessibilityRole="button">
                  <Text style={styles.configBtnText}>{busy === 'test' ? 'Test…' : 'Tester la connexion'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.configBtn} disabled={!!busy || !activeChantierId} onPress={() => showAlert(
                  'Envoyer le bilan du chantier',
                  'Le fournisseur recevra le nom du chantier et le nombre de réserves actives et clôturées pour « ' + (activeChantier?.name ?? activeChantierId) + ' ».',
                  [{ text: t('common.cancel'), style: 'cancel' }, { text: 'Envoyer le bilan', onPress: () => void run('send') }],
                )} accessibilityRole="button">
                  <Text style={styles.configBtnText}>{busy === 'send' ? 'Envoi…' : 'Envoyer le bilan du chantier'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.configBtn} disabled={!!busy} onPress={() => showAlert(
                  'Retirer le webhook', 'L’URL enregistrée pour cette organisation sera supprimée.',
                  [{ text: t('common.cancel'), style: 'cancel' }, { text: 'Retirer', style: 'destructive', onPress: () => void run('remove') }],
                )} accessibilityRole="button">
                  <Text style={styles.configBtnText}>Retirer</Text>
                </TouchableOpacity>
              </> : loadError ? <TouchableOpacity style={styles.configBtn} disabled={!!busy} onPress={() => void run('read')} accessibilityRole="button">
                <Text style={styles.configBtnText}>Recharger</Text>
              </TouchableOpacity> : null}
            </View>
          )}
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
          const catColor = CATEGORY_COLORS[integration.category] ?? C.primary;

          return (
            <View key={integration.id} style={styles.card}>
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
                <Text style={styles.featureText}>Catalogue</Text>
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

              </View>
            </View>
          );
        })}

        {/* Info card */}
        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={20} color={C.primary} />
          <Text style={styles.infoText}>
            Le catalogue présente les outils. Le webhook Make ou n8n Cloud est le connecteur configurable dans BuildTrack.
          </Text>
        </View>

      </ScrollView>
      </PageContainer>

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

  fieldLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldInput: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular',
    color: C.text, backgroundColor: C.bg, marginBottom: 16,
  },
});
