import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { ReserveStatus } from '@/constants/types';
import StatusBadge, { STATUS_CONFIG } from '@/components/StatusBadge';
import PriorityBadge from '@/components/PriorityBadge';
import Header from '@/components/Header';
import { useAuth } from '@/context/AuthContext';

const STATUS_ORDER: ReserveStatus[] = ['open', 'in_progress', 'waiting', 'verification', 'closed'];

export default function ReserveDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { reserves, updateReserveStatus, addComment, companies, channels } = useApp();
  const { user } = useAuth();
  const [comment, setComment] = useState('');
  const [showCommentBox, setShowCommentBox] = useState(false);

  const reserve = reserves.find(r => r.id === id);

  if (!reserve) {
    return (
      <View style={styles.container}>
        <Header title="Réserve introuvable" showBack />
        <View style={styles.notFound}>
          <Text style={styles.notFoundText}>Réserve non trouvée</Text>
        </View>
      </View>
    );
  }

  const company = companies.find(c => c.name === reserve?.company);
  const companyChannel = company ? channels.find(ch => ch.id === `company-${company.id}`) : null;

  function handleContactCompany() {
    if (!companyChannel) {
      Alert.alert('Canal indisponible', `Le canal de "${reserve!.company}" n'existe pas encore. Ajoutez d'abord l'entreprise dans l'onglet Équipes.`);
      return;
    }
    router.push({
      pathname: '/channel/[id]',
      params: {
        id: companyChannel.id,
        name: companyChannel.name,
        color: companyChannel.color,
        icon: companyChannel.icon,
        isDM: '0',
        isGroup: '0',
        members: '',
      },
    } as any);
  }

  function handleStatusChange(newStatus: ReserveStatus) {
    Alert.alert(
      'Modifier le statut',
      `Passer à "${STATUS_CONFIG[newStatus].label}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Confirmer', onPress: () => updateReserveStatus(reserve!.id, newStatus, user?.name ?? 'Conducteur de travaux') },
      ]
    );
  }

  function handleAddComment() {
    if (comment.trim().length === 0) return;
    addComment(reserve.id, comment.trim());
    setComment('');
    setShowCommentBox(false);
  }

  return (
    <View style={styles.container}>
      <Header
        title={reserve.id}
        subtitle={reserve.title}
        showBack
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.badgeRow}>
          <StatusBadge status={reserve.status} />
          <PriorityBadge priority={reserve.priority} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Informations</Text>
          <InfoRow icon="business-outline" label="Bâtiment" value={`Bâtiment ${reserve.building}`} />
          <InfoRow icon="location-outline" label="Zone" value={reserve.zone} />
          <InfoRow icon="layers-outline" label="Niveau" value={reserve.level} />
          <InfoRow icon="people-outline" label="Entreprise" value={reserve.company} />
          <InfoRow icon="calendar-outline" label="Créé le" value={reserve.createdAt} />
          <InfoRow icon="timer-outline" label="Échéance" value={reserve.deadline} last />
          <TouchableOpacity
            style={[styles.contactBtn, { borderColor: company?.color ?? C.primary, backgroundColor: (company?.color ?? C.primary) + '12' }]}
            onPress={handleContactCompany}
            activeOpacity={0.75}
          >
            <Ionicons name="chatbubbles" size={16} color={company?.color ?? C.primary} />
            <Text style={[styles.contactBtnText, { color: company?.color ?? C.primary }]}>
              Contacter {reserve.company}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={company?.color ?? C.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.description}>{reserve.description}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Modifier le statut</Text>
          <View style={styles.statusGrid}>
            {STATUS_ORDER.map(s => {
              const cfg = STATUS_CONFIG[s];
              const isActive = reserve.status === s;
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.statusBtn, { borderColor: cfg.color, backgroundColor: isActive ? cfg.bg : 'transparent' }]}
                  onPress={() => !isActive && handleStatusChange(s)}
                  disabled={isActive}
                >
                  <View style={[styles.statusDot, { backgroundColor: cfg.color }]} />
                  <Text style={[styles.statusBtnText, { color: cfg.color }]}>{cfg.label}</Text>
                  {isActive && <Ionicons name="checkmark" size={12} color={cfg.color} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.commentHeader}>
            <Text style={styles.sectionTitle}>Commentaires ({reserve.comments.length})</Text>
            <TouchableOpacity onPress={() => setShowCommentBox(!showCommentBox)} style={styles.addCommentBtn}>
              <Ionicons name="add" size={18} color={C.primary} />
            </TouchableOpacity>
          </View>

          {showCommentBox && (
            <View style={styles.commentBox}>
              <TextInput
                style={styles.commentInput}
                placeholder="Ajouter un commentaire..."
                placeholderTextColor={C.textMuted}
                value={comment}
                onChangeText={setComment}
                multiline
              />
              <TouchableOpacity style={styles.sendBtn} onPress={handleAddComment}>
                <Ionicons name="send" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {reserve.comments.length === 0 && !showCommentBox && (
            <Text style={styles.emptyText}>Aucun commentaire</Text>
          )}

          {[...reserve.comments].reverse().map(c => (
            <View key={c.id} style={styles.commentCard}>
              <View style={styles.commentTop}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarText}>{c.author.charAt(0)}</Text>
                </View>
                <View>
                  <Text style={styles.commentAuthor}>{c.author}</Text>
                  <Text style={styles.commentDate}>{c.createdAt}</Text>
                </View>
              </View>
              <Text style={styles.commentContent}>{c.content}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Historique ({reserve.history.length})</Text>
          {[...reserve.history].reverse().map(h => (
            <View key={h.id} style={styles.historyItem}>
              <View style={styles.historyDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.historyAction}>{h.action}</Text>
                {h.oldValue && h.newValue && (
                  <Text style={styles.historyValues}>{h.oldValue} → {h.newValue}</Text>
                )}
                <Text style={styles.historyMeta}>{h.author} — {h.createdAt}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function InfoRow({ icon, label, value, last }: { icon: string; label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
      <Ionicons name={icon as any} size={15} color={C.textMuted} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: 16, color: C.textSub, fontFamily: 'Inter_400Regular' },
  content: { padding: 16, paddingBottom: 40 },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  infoLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, flex: 1 },
  infoValue: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  description: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 22 },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addCommentBtn: { padding: 4 },
  commentBox: { flexDirection: 'row', gap: 8, marginBottom: 12, alignItems: 'flex-end' },
  commentInput: {
    flex: 1, backgroundColor: C.surface2, borderRadius: 10, padding: 10,
    color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14,
    maxHeight: 100, borderWidth: 1, borderColor: C.border,
  },
  sendBtn: { backgroundColor: C.primary, width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted },
  commentCard: { backgroundColor: C.surface2, borderRadius: 10, padding: 12, marginTop: 8 },
  commentTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  avatarCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.primary },
  commentAuthor: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  commentDate: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  commentContent: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 20 },
  historyItem: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  historyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary, marginTop: 4 },
  historyAction: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  historyValues: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  historyMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 3 },
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.5 },
  contactBtnText: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
