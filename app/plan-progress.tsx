import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { ensurePlanCached } from '@/lib/planCache';
import { loadFileAsDataUrl } from '@/lib/pdfBase';
import { loadBundledPdfJsSources } from '@/lib/pdfjsAsset';
import { supabaseRestRpc } from '@/lib/supabaseRest';
import { canTrackPdfPlan, editorHtml, emptyProgress, progressGroups, progressRpc, progressScope, type ProgressOperation } from '@/lib/plan-progress/core';
import { ProgressSession } from '@/lib/plan-progress/session';

export default function PlanProgressScreen() {
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const app = useApp();
  const auth = useAuth();
  const network = useNetwork();
  const plan = app.sitePlans.find(row => row.id === planId);
  const project = app.chantiers.find(row => row.id === plan?.chantierId);
  const web = useRef<WebView>(null);
  const latest = useRef({ auth, network, plan });
  latest.current = { auth, network, plan };
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const permissions = JSON.stringify({ edit: auth.permissions.canCreate && auth.permissions.canEdit,
    editOwn: auth.permissions.canEditOwn, delete: auth.permissions.canDelete, export: auth.permissions.canExport });
  const bridge = useRef<{ nonce: string; receive: (message: any) => Promise<unknown> } | null>(null);

  useEffect(() => {
    let active = true;
    bridge.current = null;
    setHtml(''); setError('');
    const user = auth.user;
    if (!network.queueLoaded || !user?.organizationId || !plan?.uri) return;
    const source = plan.uri;
    const owned = () => active && latest.current.auth.user?.id === user.id &&
      latest.current.auth.user?.organizationId === user.organizationId && latest.current.plan?.uri === source;
    const key = progressScope(user.id, user.organizationId, plan.id, source) + ':' + permissions;
    const pending = async () => latest.current.network.queue.filter(row => row.rpc?.fn === 'apply_plan_progress' &&
      row.rpc.args?.p_plan_id === plan.id && row.rpc.args?.p_source_ref === source).map(row => ({
        id: row.rpc!.args!.p_operation_id, planId: plan.id, sourceRef: source, changes: row.rpc!.args!.p_changes,
      } as ProgressOperation));
    const session = new ProgressSession({
      planId: plan.id, sourceRef: source, owned, online: () => latest.current.network.isOnline, newId: () => Crypto.randomUUID(),
      cacheRead: () => AsyncStorage.getItem(key),
      cacheWrite: value => owned() ? AsyncStorage.setItem(key,value) : Promise.reject(new Error('Compte modifié.')),
      pending,
      read: async () => {
        if (!latest.current.network.isOnline) return emptyProgress();
        const result = await supabaseRestRpc('read_plan_progress', { p_plan_id: plan.id, p_source_ref: source });
        if (result.error) throw Object.assign(new Error(result.error.message),{ code:result.error.code });
        return result.data;
      },
      enqueue: async operation => {
        if (!owned()) throw new Error('Compte modifié.');
        await latest.current.network.enqueueOperationDurable({ table: 'site_plan_progress', op: 'rpc', rpc: { fn: 'apply_plan_progress', args: progressRpc(operation) } });
      },
    });
    void (async () => {
      if (!canTrackPdfPlan(plan)) throw new Error('Le suivi d’avancement s’applique aux plans PDF.');
      const [document, cached, pdfjs] = await Promise.all([session.open(), ensurePlanCached(source), loadBundledPdfJsSources()]);
      const info = await FileSystem.getInfoAsync(cached.localUri);
      if (info.exists && info.size > 25 * 1024 * 1024) throw new Error('Ce PDF dépasse 25 Mo. Utilisez une version optimisée pour le suivi.');
      if (!pdfjs.moduleSource || !pdfjs.workerSource) throw new Error('Le lecteur PDF n’est pas disponible. Réessayez en ligne.');
      const pdfSource = await loadFileAsDataUrl(cached.localUri, 'pdf');
      if (!pdfSource.startsWith('data:application/pdf')) throw new Error('Le PDF n’a pas pu être lu.');
      const asset = Asset.fromModule(require('../assets/plan-progress/editor.html.txt'));
      await asset.downloadAsync();
      const template = await FileSystem.readAsStringAsync(asset.localUri ?? asset.uri);
      if (!owned()) return;
      const groups = progressGroups(app.companies.filter(company => (!company.organizationId || company.organizationId === user.organizationId) &&
        (!project?.companyIds?.length || project.companyIds.includes(company.id))),
        app.lots.filter(lot => !lot.chantierId || lot.chantierId === plan.chantierId));
      const nonce = Crypto.randomUUID();
      bridge.current = { nonce, receive: async message => {
        if (!owned()) throw new Error('La session a changé. Rouvrez le plan.');
        if (message.type === 'save') {
          await session.save(message.payload);
          return { text: 'Enregistré sur cet appareil · synchronisation en attente' };
        }
        if (message.type === 'reload') return await session.refresh() ?? {};
        if (message.type === 'download' && auth.permissions.canExport) {
          const base64 = message.payload?.base64;
          if (typeof base64 !== 'string' || base64.length > 20_000_000 || !/^[A-Za-z0-9+/=]+$/.test(base64)) throw new Error('Export invalide.');
          if (!await Sharing.isAvailableAsync()) throw new Error('Le partage de fichiers est indisponible.');
          const uri = FileSystem.cacheDirectory + 'BuildTrack-avancement-' + Date.now() + '.xlsx';
          await FileSystem.writeAsStringAsync(uri,base64,{ encoding: FileSystem.EncodingType.Base64 });
          await Sharing.shareAsync(uri,{ mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', UTI: 'org.openxmlformats.spreadsheetml.sheet' });
          return {};
        }
        throw new Error('Action non autorisée.');
      } };
      setHtml(editorHtml(template, { nonce, document, history: session.history, plan: { id: plan.id, name: plan.name, pages: plan.pdfPageCount ?? 1 },
        projectName: project?.name ?? 'Chantier', groups, companyId: user.companyId, permissions: JSON.parse(permissions), pdfSource, pdfjs,
        syncText: (await pending()).length ? 'Modifications en attente de synchronisation' : session.fresh ? 'Suivi chargé · synchronisé' : 'Données locales · actualisation à la connexion' }));
    })().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Impossible de charger l’avancement.'); });
    return () => { active = false; bridge.current = null; };
    // The queue is read through a ref; a replay must not reload an active drawing.
  }, [auth.user?.id, auth.user?.organizationId, plan?.id, plan?.uri, network.queueLoaded, permissions, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!bridge.current || !html) return;
    const rows = network.queue.filter(row => row.rpc?.fn === 'apply_plan_progress' && row.rpc.args?.p_plan_id === planId && row.rpc.args?.p_source_ref === plan?.uri);
    const text = rows.some(row => row.lastError) ? 'Synchronisation à vérifier dans Paramètres → Compte' : rows.length ? `${rows.length} modification(s) en attente de synchronisation` : network.isOnline ? 'File d’attente vide · actualisation du suivi' : 'Hors ligne · enregistré sur cet appareil';
    web.current?.injectJavaScript('window.dispatchEvent(new MessageEvent("message",{data:' + JSON.stringify({ channel: 'bt-plan-progress', nonce: bridge.current.nonce, type: 'status', text }) + '}));true;');
    if (!rows.length && network.isOnline) web.current?.injectJavaScript('window.dispatchEvent(new MessageEvent("message",{data:' + JSON.stringify({ channel:'bt-plan-progress',nonce:bridge.current.nonce,type:'refreshAvailable' }) + '}));true;');
  }, [network.queue, network.isOnline, html, planId, plan?.uri]);

  return <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top, paddingBottom: insets.bottom }}>
    <Stack.Screen options={{ headerShown: false }} />
    <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 12 }}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.back()} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 }}><Text style={{ color: '#003582', fontWeight: '700' }}>‹ Plans</Text></Pressable>
      <Text numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>{plan?.name ?? 'Avancement'}</Text>
    </View>
    {error ? <View style={{ padding: 24, gap: 16 }}><Text accessibilityRole="alert">{error}</Text><Pressable onPress={() => setAttempt(value => value + 1)} style={{ minHeight: 48 }}><Text>Réessayer</Text></Pressable></View>
      : html ? <WebView ref={web} source={{ html, baseUrl: 'https://buildtrack.local/' }} style={{ flex: 1 }} originWhitelist={['https://buildtrack.local', 'about:blank']}
        allowFileAccess={false} domStorageEnabled={false} setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url === 'https://buildtrack.local/'}
        onMessage={event => {
          let message: any; try { if (event.nativeEvent.data.length > 21_000_000) return; message = JSON.parse(event.nativeEvent.data); } catch { return; }
          const host = bridge.current;
          if (!host || message?.channel !== 'bt-plan-progress' || message.nonce !== host.nonce || typeof message.id !== 'string') return;
          if (message.type === 'save') setBusy(true);
          void host.receive(message).then(payload => ({ payload })).catch(cause => ({ error: cause instanceof Error ? cause.message : 'Action impossible.', uncertain: cause?.code === 'LOCAL_SAVE_UNCONFIRMED' })).then(result => {
            if (bridge.current !== host) return;
            web.current?.injectJavaScript('window.dispatchEvent(new MessageEvent("message",{data:' + JSON.stringify({ channel: 'bt-plan-progress', nonce: host.nonce, id: message.id, ...result }).replace(/</g, '\\u003c') + '}));true;');
          }).finally(() => { if (message.type === 'save') setBusy(false); });
        }} onError={() => setError('Le lecteur du plan a été interrompu. Rouvrez le plan.')} />
        : <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator /><Text>Chargement du plan et de son avancement…</Text></View>}
  </View>;
}
