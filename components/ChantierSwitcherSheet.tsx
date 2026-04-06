import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  Animated, ScrollView, Platform, useWindowDimensions, PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';

let _open: (() => void) | null = null;

export function openChantierSwitcher() {
  _open?.();
}

const STATUS_CFG: Record<string, { color: string; icon: string; label: string }> = {
  active:    { color: C.closed,    icon: 'play-circle',         label: 'En cours' },
  completed: { color: C.primary,   icon: 'checkmark-circle',    label: 'Terminé'  },
  paused:    { color: '#F59E0B',   icon: 'pause-circle',        label: 'En pause' },
};

export default function ChantierSwitcherSheet() {
  const [visible, setVisible] = useState(false);
  const { height: screenHeight } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(screenHeight)).current;
  const insets = useSafeAreaInsets();
  const scrollOffsetRef = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, g) => {
        return g.dy > 8 && g.dy > Math.abs(g.dx) && scrollOffsetRef.current <= 0;
      },
      onMoveShouldSetPanResponderCapture: () => false,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) {
          close();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 70, friction: 14 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 70, friction: 14 }).start();
      },
    })
  ).current;
  const router = useRouter();
  const { chantiers, activeChantierId, activeChantier, setActiveChantier, reserves, sitePlans } = useApp();
  const { permissions } = useAuth();

  useEffect(() => {
    _open = () => setVisible(true);
    return () => { _open = null; };
  }, []);

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        tension: 70,
        friction: 14,
        useNativeDriver: true,
      }).start();
    } else {
      translateY.setValue(screenHeight);
    }
  }, [visible, screenHeight]);

  function close() {
    Animated.timing(translateY, {
      toValue: screenHeight,
      duration: 220,
      useNativeDriver: true,
    }).start(() => setVisible(false));
  }

  function handleSelect(id: string) {
    if (id !== activeChantierId) {
      setActiveChantier(id);
    }
    close();
  }

  const bottomPad = Platform.OS === 'web' ? 24 : insets.bottom + 12;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={close}>
        <Animated.View
          style={[styles.sheet, { paddingBottom: bottomPad, transform: [{ translateY }] }]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={styles.handle} />

            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Chantiers</Text>
              {activeChantier && (
                <Text style={styles.sheetSub} numberOfLines={1}>
                  Actif : {activeChantier.name}
                </Text>
              )}
            </View>

            <ScrollView
              style={styles.list}
              showsVerticalScrollIndicator={false}
              bounces={false}
              scrollEventThrottle={16}
              onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
            >
              {(chantiers ?? []).length === 0 && (
                <View style={styles.emptyWrap}>
                  <Ionicons name="business-outline" size={36} color={C.textMuted} />
                  <Text style={styles.emptyText}>Aucun chantier créé</Text>
                </View>
              )}

              {(chantiers ?? []).map(ch => {
                const isActive = ch.id === activeChantierId;
                const cfg = STATUS_CFG[ch.status] ?? STATUS_CFG.active;
                const reserveCount = (reserves ?? []).filter(r => r.chantierId === ch.id).length;
                const planCount = (sitePlans ?? []).filter(p => p.chantierId === ch.id).length;

                return (
                  <TouchableOpacity
                    key={ch.id}
                    style={[styles.item, isActive && styles.itemActive]}
                    onPress={() => handleSelect(ch.id)}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.itemIconWrap, { backgroundColor: isActive ? C.primary + '20' : C.surface2 }]}>
                      <Ionicons name="business" size={20} color={isActive ? C.primary : C.textSub} />
                    </View>

                    <View style={styles.itemContent}>
                      <View style={styles.itemTop}>
                        <Text style={[styles.itemName, isActive && styles.itemNameActive]} numberOfLines={1}>
                          {ch.name}
                        </Text>
                        <View style={[styles.statusPill, { backgroundColor: cfg.color + '18' }]}>
                          <Ionicons name={cfg.icon as any} size={10} color={cfg.color} />
                          <Text style={[styles.statusPillText, { color: cfg.color }]}>{cfg.label}</Text>
                        </View>
                      </View>
                      {ch.address ? (
                        <Text style={styles.itemAddress} numberOfLines={1}>{ch.address}</Text>
                      ) : null}
                      <View style={styles.itemMeta}>
                        <View style={styles.metaChip}>
                          <Ionicons name="warning-outline" size={11} color={C.textMuted} />
                          <Text style={styles.metaChipText}>{reserveCount} réserve{reserveCount !== 1 ? 's' : ''}</Text>
                        </View>
                        <View style={styles.metaDot} />
                        <View style={styles.metaChip}>
                          <Ionicons name="map-outline" size={11} color={C.textMuted} />
                          <Text style={styles.metaChipText}>{planCount} plan{planCount !== 1 ? 's' : ''}</Text>
                        </View>
                      </View>
                    </View>

                    {isActive ? (
                      <View style={styles.checkWrap}>
                        <Ionicons name="checkmark-circle" size={22} color={C.primary} />
                      </View>
                    ) : (
                      <View style={styles.checkWrap}>
                        <Ionicons name="radio-button-off" size={22} color={C.border} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {permissions.canCreate && (
              <TouchableOpacity
                style={styles.newBtn}
                onPress={() => {
                  close();
                  setTimeout(() => router.push('/chantier/new' as any), 250);
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="add-circle-outline" size={18} color={C.primary} />
                <Text style={styles.newBtnText}>Nouveau chantier</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    maxHeight: '80%',
    ...Platform.select({
      web: { boxShadow: '0px -4px 24px rgba(0,0,0,0.14)' } as any,
      default: { shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 24, shadowOffset: { width: 0, height: -4 } },
    }),
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetHeader: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    marginBottom: 8,
  },
  sheetTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: C.text,
  },
  sheetSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
    marginTop: 2,
  },
  list: {
    maxHeight: 420,
    paddingHorizontal: 12,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    marginBottom: 6,
    backgroundColor: C.surface2,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  itemActive: {
    backgroundColor: C.primaryBg,
    borderColor: C.primary + '40',
  },
  itemIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  itemContent: {
    flex: 1,
    gap: 3,
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemName: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
    flex: 1,
  },
  itemNameActive: {
    color: C.primary,
  },
  itemAddress: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaChipText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: C.border,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    flexShrink: 0,
  },
  statusPillText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
  },
  checkWrap: {
    flexShrink: 0,
  },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 10,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: C.primaryBg,
    borderWidth: 1.5,
    borderColor: C.primary + '40',
    borderStyle: 'dashed',
  },
  newBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },
});
