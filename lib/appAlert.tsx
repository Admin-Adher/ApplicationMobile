import React, { useEffect, useState } from 'react';
import { Alert, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C } from '@/constants/colors';

export type AppAlertButton = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

type AlertRequest = {
  id: number;
  title: string;
  message?: string;
  buttons: AppAlertButton[];
};

let nextId = 1;
let currentRequest: AlertRequest | null = null;
let notify: ((req: AlertRequest | null) => void) | null = null;

/**
 * Remplaçant direct d'Alert.alert qui fonctionne AUSSI sur le web.
 *
 * Sous react-native-web, Alert.alert est un no-op : aucune boîte ne
 * s'affiche et les onPress ne s'exécutent jamais — toutes les
 * confirmations (suppressions, déconnexion, abandons de formulaire…)
 * étaient donc inertes sur navigateur. Sur natif, cette fonction délègue
 * à Alert.alert ; sur web, elle affiche une vraie boîte de dialogue via
 * <AppAlertHost/> (montée une seule fois dans app/_layout.tsx).
 *
 * Signature identique à Alert.alert : le remplacement est mécanique.
 */
export function showAlert(
  title: string,
  message?: string,
  buttons?: AppAlertButton[],
): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons as any);
    return;
  }
  const req: AlertRequest = {
    id: nextId++,
    title,
    message,
    buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }],
  };
  currentRequest = req;
  if (notify) notify(req);
}

/**
 * Hôte web des boîtes de dialogue de showAlert. Ne rend rien sur natif.
 * Le Modal n'est monté qu'à l'apparition d'une demande : il s'empile donc
 * au-dessus de tout modal de page déjà ouvert.
 */
export function AppAlertHost() {
  const [request, setRequest] = useState<AlertRequest | null>(currentRequest);

  useEffect(() => {
    notify = setRequest;
    setRequest(currentRequest);
    return () => {
      if (notify === setRequest) notify = null;
    };
  }, []);

  if (Platform.OS !== 'web' || !request) return null;

  const close = () => {
    currentRequest = null;
    setRequest(null);
  };
  const cancelButton = request.buttons.find(b => b.style === 'cancel');

  function handlePress(btn: AppAlertButton) {
    close();
    btn.onPress?.();
  }

  // Clic sur le fond / Échap = même effet que le bouton « Annuler » s'il existe.
  function handleBackdrop() {
    close();
    cancelButton?.onPress?.();
  }

  const stacked = request.buttons.length > 2;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleBackdrop}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleBackdrop}>
        <TouchableOpacity activeOpacity={1} style={styles.dialog} onPress={() => {}}>
          <Text style={styles.title}>{request.title}</Text>
          {request.message ? <Text style={styles.message}>{request.message}</Text> : null}
          <View style={[styles.actions, stacked && styles.actionsStacked]}>
            {request.buttons.map((btn, i) => {
              const destructive = btn.style === 'destructive';
              const cancel = btn.style === 'cancel';
              return (
                <TouchableOpacity
                  key={`${request.id}-${i}`}
                  style={[
                    styles.btn,
                    cancel ? styles.btnCancel : destructive ? styles.btnDestructive : styles.btnPrimary,
                    stacked && styles.btnStacked,
                  ]}
                  onPress={() => handlePress(btn)}
                >
                  <Text
                    style={[
                      styles.btnText,
                      cancel ? styles.btnTextCancel : destructive ? styles.btnTextDestructive : styles.btnTextPrimary,
                    ]}
                  >
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  dialog: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  title: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text, textAlign: 'center' },
  message: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 19, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionsStacked: { flexDirection: 'column' },
  btn: { flex: 1, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center' },
  btnStacked: { flex: undefined as any, width: '100%' },
  btnPrimary: { backgroundColor: C.primary },
  btnCancel: { backgroundColor: C.surface2 },
  btnDestructive: { backgroundColor: '#DC2626' },
  btnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  btnTextPrimary: { color: '#fff' },
  btnTextCancel: { color: C.textSub },
  btnTextDestructive: { color: '#fff' },
});
