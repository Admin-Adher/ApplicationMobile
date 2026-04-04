import { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, Platform, Alert, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { Opr } from '@/constants/types';
import SignaturePad, { SignaturePadRef } from '@/components/SignaturePad';
import { formatDateFR } from '@/lib/utils';

const ITEM_STATUS_CFG = {
  ok: { label: 'Conforme', color: '#10B981', icon: 'checkmark-circle' },
  reserve: { label: 'Réserve', color: '#EF4444', icon: 'warning' },
  non_applicable: { label: 'N/A', color: '#9CA3AF', icon: 'remove-circle-outline' },
};

export default function OprSessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isAuthenticated } = useAuth();
  const { oprs, updateOpr } = useApp();
  const router = useRouter();

  const [opr, setOpr] = useState<Opr | null>(null);
  const [loading, setLoading] = useState(true);
  const [signerName, setSignerName] = useState('');
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const sigPadRef = useRef<SignaturePadRef>(null);

  useEffect(() => {
    if (!id) return;
    if (isAuthenticated && oprs) {
      const found = oprs.find(o => o.id === id);
      if (found) { setOpr(found); setLoading(false); return; }
    }
    setLoading(false);
  }, [id, isAuthenticated, oprs]);

  async function handleSign() {
    if (!signerName.trim()) {
      Alert.alert('Nom requis', 'Veuillez saisir votre nom complet avant de signer.');
      return;
    }
    if (!opr) return;
    const sigData = sigPadRef.current?.isEmpty() ? undefined : sigPadRef.current?.getSVGData() ?? undefined;
    if (!sigData) {
      Alert.alert('Signature requise', 'Veuillez apposer votre signature dans le cadre prévu.');
      return;
    }
    const signatories = opr.signatories ?? [];
    if (signatories.length > 0) {
      const matchFound = signatories.some(s => s.name.trim().toLowerCase() === signerName.trim().toLowerCase());
      if (!matchFound) {
        Alert.alert(
          'Nom non reconnu',
          `Le nom "${signerName.trim()}" ne correspond à aucun signataire attendu pour cet OPR. Vérifiez l'orthographe ou contactez le conducteur de travaux.`
        );
        return;
      }
    }
    setSigning(true);
    try {
      const now = formatDateFR(new Date());
      const updatedSignatories = signatories.map(s =>
        s.name.trim().toLowerCase() === signerName.trim().toLowerCase()
          ? { ...s, signed: true, signedAt: now, signature: sigData }
          : s
      );
      const allSigned = updatedSignatories.every(s => s.signed);
      updateOpr({
        ...opr,
        signatories: updatedSignatories,
        status: allSigned ? 'signed' : 'in_progress',
        signedAt: allSigned ? now : opr.signedAt,
      });
      setSigned(true);
    } finally {
      setSigning(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Chargement de la session OPR...</Text>
      </View>
    );
  }

  if (!opr) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="search-outline" size={48} color={C.textMuted} />
        <Text style={styles.notFoundTitle}>Session introuvable</Text>
        <Text style={styles.notFoundSub}>
          {isAuthenticated
            ? `Aucun OPR avec l'identifiant "${id}" n'a été trouvé.`
            : 'Connectez-vous pour accéder à cette session OPR.'}
        </Text>
        <TouchableOpacity style={styles.loginBtn} onPress={() => router.replace('/login')}>
          <Text style={styles.loginBtnText}>{isAuthenticated ? 'Retour' : 'Se connecter'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (signed) {
    return (
      <View style={styles.centerContainer}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark-circle" size={56} color="#10B981" />
        </View>
        <Text style={styles.successTitle}>Signature enregistrée</Text>
        <Text style={styles.successSub}>Merci, votre signature a bien été prise en compte pour l'OPR "{opr.title}".</Text>
        {isAuthenticated && (
          <TouchableOpacity style={[styles.loginBtn, { backgroundColor: C.primary }]} onPress={() => router.back()}>
            <Text style={styles.loginBtnText}>Retour à la liste</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const totalItems = opr.items?.length ?? 0;
  const conformes = opr.items?.filter(i => i.status === 'ok').length ?? 0;
  const reserves = opr.items?.filter(i => i.status === 'reserve').length ?? 0;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/login')} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Session OPR</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{opr.title}</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <View style={styles.summaryCard}>
          <Text style={styles.cardTitle}>{opr.title}</Text>
          {opr.building && (
            <View style={styles.metaRow}>
              <Ionicons name="business-outline" size={13} color={C.textMuted} />
              <Text style={styles.metaText}>{opr.building}{opr.level ? ` — ${opr.level}` : ''}</Text>
            </View>
          )}
          {opr.conducteur && (
            <View style={styles.metaRow}>
              <Ionicons name="person-outline" size={13} color={C.textMuted} />
              <Text style={styles.metaText}>Conducteur : {opr.conducteur}</Text>
            </View>
          )}
          {opr.date && (
            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={13} color={C.textMuted} />
              <Text style={styles.metaText}>Date OPR : {opr.date}</Text>
            </View>
          )}
          <View style={styles.statRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statVal, { color: '#10B981' }]}>{conformes}</Text>
              <Text style={styles.statLabel}>Conformes</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statVal, { color: '#EF4444' }]}>{reserves}</Text>
              <Text style={styles.statLabel}>Réserves</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statVal, { color: C.primary }]}>{totalItems}</Text>
              <Text style={styles.statLabel}>Total</Text>
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Points de contrôle</Text>
          {(opr.items ?? []).map(item => {
            const cfg = ITEM_STATUS_CFG[item.status] ?? ITEM_STATUS_CFG.ok;
            return (
              <View key={item.id} style={styles.itemRow}>
                <Ionicons name={cfg.icon as any} size={16} color={cfg.color} />
                <Text style={styles.itemText}>{item.lotName}</Text>
                <View style={[styles.itemBadge, { backgroundColor: cfg.color + '15' }]}>
                  <Text style={[styles.itemBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {opr.status !== 'signed' && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Apposer votre signature</Text>
            <Text style={styles.sectionSub}>Saisissez votre nom puis dessinez votre signature dans le cadre ci-dessous.</Text>

            <View style={styles.nameField}>
              <Text style={styles.nameLabel}>Nom complet *</Text>
              <TextInput
                style={styles.nameInput}
                placeholder="Prénom Nom"
                placeholderTextColor={C.textMuted}
                value={signerName}
                onChangeText={setSignerName}
                autoCapitalize="words"
                returnKeyType="done"
                accessibilityLabel="Votre nom complet pour signer le PV"
              />
            </View>

            {(opr.signatories ?? []).length > 0 && (
              <View style={styles.signatoryList}>
                <Text style={styles.nameLabel}>Signataires attendus</Text>
                {(opr.signatories ?? []).map(s => (
                  <View key={s.id} style={styles.signatoryRow}>
                    <Ionicons
                      name={s.signed ? 'checkmark-circle' : 'ellipse-outline'}
                      size={14}
                      color={s.signed ? '#10B981' : C.textMuted}
                    />
                    <Text style={[styles.signatoryName, s.signed && { color: '#10B981' }]}>{s.name}</Text>
                    {s.signed && s.signedAt && <Text style={styles.signatoryDate}>le {s.signedAt}</Text>}
                  </View>
                ))}
              </View>
            )}

            <View style={styles.sigPadContainer}>
              <SignaturePad ref={sigPadRef} />
            </View>

            <TouchableOpacity
              style={[styles.signBtn, (!signerName.trim() || signing) && { opacity: 0.5 }]}
              onPress={handleSign}
              disabled={!signerName.trim() || signing}
            >
              {signing ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="create-outline" size={18} color="#fff" />}
              <Text style={styles.signBtnText}>{signing ? 'Enregistrement...' : 'Signer le PV'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {opr.status === 'signed' && (
          <View style={[styles.sectionCard, { backgroundColor: '#ECFDF5', borderColor: '#6EE7B7' }]}>
            <View style={styles.signedRow}>
              <Ionicons name="checkmark-circle" size={20} color="#10B981" />
              <Text style={styles.signedText}>PV signé le {opr.signedAt}</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  centerContainer: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  loadingText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 8 },
  notFoundTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.text, textAlign: 'center' },
  notFoundSub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', lineHeight: 20 },
  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#ECFDF5', alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text, textAlign: 'center' },
  successSub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', lineHeight: 20 },
  loginBtn: { backgroundColor: '#7C3AED', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  loginBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
    paddingHorizontal: 16, paddingVertical: 14,
    paddingTop: Platform.OS === 'ios' ? 54 : 14,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 1 },
  scroll: { flex: 1 },
  summaryCard: { backgroundColor: C.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border, gap: 8 },
  cardTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub },
  statRow: { flexDirection: 'row', gap: 12, marginTop: 8, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 12 },
  statItem: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  sectionCard: { backgroundColor: C.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border, gap: 10 },
  sectionTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.text },
  sectionSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: -4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  itemText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  itemBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  itemBadgeText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  nameField: { gap: 6 },
  nameLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5 },
  nameInput: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14, borderWidth: 1, borderColor: C.border,
  },
  signatoryList: { gap: 8 },
  signatoryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  signatoryName: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  signatoryDate: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  sigPadContainer: { borderRadius: 12, overflow: 'hidden', borderWidth: 1.5, borderColor: C.border, height: 160 },
  signBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#7C3AED', borderRadius: 12, paddingVertical: 14, marginTop: 4,
  },
  signBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  signedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  signedText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#059669' },
});
