import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetwork, StatusConflict } from '@/context/NetworkContext';
import { C } from '@/constants/colors';

const STATUS_LABELS: Record<string, string> = {
  open: 'Ouvert',
  in_progress: 'En cours',
  waiting: 'En attente',
  verification: 'Vérification',
  closed: 'Clôturé',
};

const STATUS_COLORS: Record<string, string> = {
  open: '#EF4444',
  in_progress: '#F59E0B',
  waiting: '#8B5CF6',
  verification: '#3B82F6',
  closed: '#10B981',
};

function ConflictCard({ conflict, onResolve }: { conflict: StatusConflict; onResolve: (chosenStatus: string) => void }) {
  const serverLabel = STATUS_LABELS[conflict.serverStatus] ?? conflict.serverStatus;
  const localLabel = STATUS_LABELS[conflict.localStatus] ?? conflict.localStatus;
  const serverColor = STATUS_COLORS[conflict.serverStatus] ?? C.primary;
  const localColor = STATUS_COLORS[conflict.localStatus] ?? C.primary;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name="warning-outline" size={16} color="#F59E0B" />
        <Text style={styles.cardTitle} numberOfLines={2}>{conflict.reserveTitle}</Text>
      </View>

      <Text style={styles.cardSubtitle}>
        Modifié par <Text style={styles.authorText}>{conflict.author}</Text> hors connexion
        {'\n'}et par quelqu'un d'autre en ligne simultanément.
      </Text>

      <Text style={styles.choiceLabel}>Quel statut conserver ?</Text>

      <View style={styles.choiceRow}>
        <TouchableOpacity
          style={[styles.choiceBtn, { borderColor: serverColor }]}
          onPress={() => onResolve(conflict.serverStatus)}
        >
          <View style={[styles.choiceDot, { backgroundColor: serverColor }]} />
          <View style={styles.choiceBtnInner}>
            <Text style={[styles.choiceBtnTitle, { color: serverColor }]}>{serverLabel}</Text>
            <Text style={styles.choiceBtnSub}>Version serveur</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.choiceBtn, { borderColor: localColor }]}
          onPress={() => onResolve(conflict.localStatus)}
        >
          <View style={[styles.choiceDot, { backgroundColor: localColor }]} />
          <View style={styles.choiceBtnInner}>
            <Text style={[styles.choiceBtnTitle, { color: localColor }]}>{localLabel}</Text>
            <Text style={styles.choiceBtnSub}>Ma modification</Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ConflictModal() {
  const { conflicts, syncStatus, resolveConflict, dismissConflicts } = useNetwork();
  const insets = useSafeAreaInsets();

  const visible = syncStatus === 'conflict' && conflicts.length > 0;

  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={dismissConflicts}
    >
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name="git-merge-outline" size={22} color="#F59E0B" />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.headerTitle}>Conflits de synchronisation</Text>
              <Text style={styles.headerSub}>
                {conflicts.length} réserve{conflicts.length > 1 ? 's' : ''} modifiée{conflicts.length > 1 ? 's' : ''} simultanément
              </Text>
            </View>
          </View>

          <Text style={styles.explanation}>
            Pendant que vous étiez hors connexion, d'autres utilisateurs ont modifié les mêmes réserves.
            Choisissez le statut à conserver pour chacune.
          </Text>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {conflicts.map(c => (
              <ConflictCard
                key={c.id}
                conflict={c}
                onResolve={(status) => resolveConflict(c.id, status)}
              />
            ))}
          </ScrollView>

          <TouchableOpacity style={styles.dismissBtn} onPress={dismissConflicts}>
            <Text style={styles.dismissText}>Ignorer tous les conflits</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1A1F2E',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingHorizontal: 16,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#78350F20',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F59E0B30',
  },
  headerText: { flex: 1 },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
  headerSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
    marginTop: 2,
  },
  explanation: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
    lineHeight: 20,
    marginBottom: 16,
  },
  list: {
    flexGrow: 0,
    maxHeight: 400,
  },
  card: {
    backgroundColor: '#242938',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F59E0B25',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  cardTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
  },
  cardSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
    lineHeight: 18,
    marginBottom: 12,
  },
  authorText: {
    color: '#C4B5FD',
    fontFamily: 'Inter_500Medium',
  },
  choiceLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: '#D1D5DB',
    marginBottom: 8,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 8,
  },
  choiceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    backgroundColor: '#1A1F2E',
  },
  choiceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  choiceBtnInner: { flex: 1 },
  choiceBtnTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  choiceBtnSub: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
    marginTop: 1,
  },
  dismissBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  dismissText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#6B7280',
  },
});
