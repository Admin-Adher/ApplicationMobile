import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Platform, Share, Clipboard,
} from 'react-native';
import { DebugLogEntry, subscribeDebugLogs, getDebugLogs, clearDebugLogs } from '@/lib/debugLog';

const LEVEL_COLOR: Record<string, string> = {
  info:  '#9CA3AF',
  ok:    '#34D399',
  warn:  '#FBBF24',
  error: '#F87171',
};

const LEVEL_PREFIX: Record<string, string> = {
  info:  '·',
  ok:    '✓',
  warn:  '⚠',
  error: '✗',
};

interface Props {
  visible?: boolean;
}

export default function DebugOverlay({ visible = true }: Props) {
  const [logs, setLogs] = useState<DebugLogEntry[]>(getDebugLogs());
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const unsub = subscribeDebugLogs(updated => {
      setLogs([...updated]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 30);
    });
    return unsub;
  }, []);

  if (!visible) return null;

  function logsAsText(): string {
    return logs.map(e => `[${e.ts}] ${LEVEL_PREFIX[e.level]} ${e.msg}`).join('\n');
  }

  async function handleCopy() {
    const text = logsAsText();
    if (Platform.OS === 'web') {
      try { await (navigator as any).clipboard?.writeText(text); } catch {}
    } else {
      try { await Share.share({ message: text }); } catch {}
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.panel}>
        <View style={styles.header}>
          <Text style={styles.title}>🔍 Debug Log</Text>
          <View style={styles.headerButtons}>
            <TouchableOpacity style={styles.btn} onPress={clearDebugLogs}>
              <Text style={styles.btnText}>Effacer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, copied && styles.btnCopied]} onPress={handleCopy}>
              <Text style={styles.btnText}>{copied ? '✓ Copié !' : 'Copier tout'}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {logs.length === 0 && (
            <Text style={styles.empty}>En attente de logs…</Text>
          )}
          {logs.map((entry, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.ts}>{entry.ts}</Text>
              <Text style={[styles.prefix, { color: LEVEL_COLOR[entry.level] }]}>
                {LEVEL_PREFIX[entry.level]}
              </Text>
              <Text style={[styles.msg, { color: LEVEL_COLOR[entry.level] }]} numberOfLines={3}>
                {entry.msg}
              </Text>
            </View>
          ))}
        </ScrollView>
        <Text style={styles.hint}>{logs.length} entrée(s) — Copiez et partagez avec votre développeur</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    pointerEvents: 'box-none' as any,
  },
  panel: {
    backgroundColor: 'rgba(10, 12, 20, 0.97)',
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    maxHeight: 320,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  title: {
    color: '#F9FAFB',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '700',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  btn: {
    backgroundColor: '#1D4ED8',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  btnCopied: {
    backgroundColor: '#065F46',
  },
  btnText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '600',
  },
  scroll: {
    maxHeight: 240,
  },
  scrollContent: {
    padding: 8,
    gap: 2,
  },
  empty: {
    color: '#4B5563',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  ts: {
    color: '#4B5563',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    minWidth: 80,
    lineHeight: 16,
  },
  prefix: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    lineHeight: 16,
    minWidth: 12,
  },
  msg: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    lineHeight: 16,
    flex: 1,
  },
  hint: {
    color: '#374151',
    fontSize: 10,
    textAlign: 'center',
    paddingVertical: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
