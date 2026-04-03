import { View, StyleSheet, Animated } from 'react-native';
import { useEffect, useRef } from 'react';
import { C } from '@/constants/colors';

function SkeletonLine({ width, height = 12, style }: { width: string | number; height?: number; style?: any }) {
  const anim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: height / 2, backgroundColor: C.border, opacity: anim },
        style,
      ]}
    />
  );
}

export function ReserveSkeletonCard() {
  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <SkeletonLine width={56} height={20} style={{ borderRadius: 6 }} />
        <View style={styles.topRight}>
          <SkeletonLine width={52} height={18} style={{ borderRadius: 9 }} />
          <SkeletonLine width={64} height={18} style={{ borderRadius: 9 }} />
        </View>
      </View>
      <SkeletonLine width="90%" height={14} style={{ marginBottom: 6 }} />
      <SkeletonLine width="65%" height={12} style={{ marginBottom: 16 }} />
      <SkeletonLine width="50%" height={11} style={{ marginBottom: 5 }} />
      <SkeletonLine width="40%" height={11} style={{ marginBottom: 14 }} />
      <View style={styles.bottomRow}>
        <SkeletonLine width="45%" height={11} />
        <SkeletonLine width={48} height={18} style={{ borderRadius: 9 }} />
      </View>
    </View>
  );
}

export function IncidentSkeletonCard() {
  return (
    <View style={[styles.card, styles.incidentCard]}>
      <View style={styles.topRow}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <SkeletonLine width={60} height={18} style={{ borderRadius: 9 }} />
          <SkeletonLine width={60} height={18} style={{ borderRadius: 9 }} />
        </View>
      </View>
      <SkeletonLine width="85%" height={14} style={{ marginBottom: 6 }} />
      <SkeletonLine width="70%" height={12} style={{ marginBottom: 12 }} />
      <SkeletonLine width="50%" height={11} style={{ marginBottom: 4 }} />
      <SkeletonLine width="40%" height={11} />
    </View>
  );
}

export function SkeletonList({ count = 4, type = 'reserve' }: { count?: number; type?: 'reserve' | 'incident' }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) =>
        type === 'incident'
          ? <IncidentSkeletonCard key={i} />
          : <ReserveSkeletonCard key={i} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  incidentCard: {
    borderLeftWidth: 3,
    borderLeftColor: C.border,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  topRight: {
    flexDirection: 'row',
    gap: 6,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
