import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  NativeSyntheticEvent,
  Platform,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextInputSelectionChangeEventData,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import { C } from '@/constants/colors';

type DictationLanguage = 'fr-FR' | 'en-US' | 'es-ES';

const DICTATION_LANGUAGE_KEY = 'buildtrack_dictation_language_v1';

const LANGUAGES: Array<{ code: DictationLanguage; label: string; title: string }> = [
  { code: 'fr-FR', label: 'FR', title: 'Francais' },
  { code: 'en-US', label: 'EN', title: 'Anglais' },
  { code: 'es-ES', label: 'ES', title: 'Espagnol' },
];

type SelectionRange = { start: number; end: number };

type DictationTextInputProps = Omit<TextInputProps, 'value' | 'onChangeText' | 'style'> & {
  value: string;
  onChangeText: (text: string) => void;
  inputStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  controlsStyle?: StyleProp<ViewStyle>;
  dictationEnabled?: boolean;
};

function clampSelection(selection: SelectionRange, text: string): SelectionRange {
  const start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));
  return { start, end };
}

function insertTranscript(
  current: string,
  range: SelectionRange,
  transcript: string,
  maxLength?: number,
) {
  const safeRange = clampSelection(range, current);
  const cleanTranscript = transcript.replace(/\s+/g, ' ').trim();
  const prefix = current.slice(0, safeRange.start);
  const suffix = current.slice(safeRange.end);
  const needsLeadingSpace = !!cleanTranscript && !!prefix && !/\s$/.test(prefix) && !/^[,.;:!?)]/.test(cleanTranscript);
  const needsTrailingSpace = !!cleanTranscript && !!suffix && !/^\s/.test(suffix) && !/^[,.;:!?)]/.test(suffix);
  let insertion = `${needsLeadingSpace ? ' ' : ''}${cleanTranscript}${needsTrailingSpace ? ' ' : ''}`;

  if (typeof maxLength === 'number') {
    const allowed = Math.max(0, maxLength - prefix.length - suffix.length);
    insertion = insertion.slice(0, allowed);
  }

  const text = `${prefix}${insertion}${suffix}`;
  return {
    text,
    range: { start: prefix.length, end: prefix.length + insertion.length },
  };
}

function friendlyDictationError(event: ExpoSpeechRecognitionErrorEvent) {
  switch (event.error) {
    case 'language-not-supported':
      return 'Cette langue de dictee n est pas disponible sur cet appareil.';
    case 'network':
      return 'La dictee vocale a besoin du reseau ou d un moteur vocal local disponible.';
    case 'not-allowed':
      return 'Permission micro ou reconnaissance vocale refusee.';
    case 'service-not-allowed':
      return 'Le service de reconnaissance vocale est indisponible sur cet appareil.';
    case 'busy':
      return 'La reconnaissance vocale est deja en cours.';
    case 'no-speech':
    case 'speech-timeout':
      return 'Aucune parole detectee.';
    default:
      return event.message || 'Dictee vocale indisponible.';
  }
}

export default function DictationTextInput({
  value,
  onChangeText,
  inputStyle,
  containerStyle,
  controlsStyle,
  dictationEnabled = true,
  editable = true,
  onSelectionChange,
  maxLength,
  ...props
}: DictationTextInputProps) {
  const [language, setLanguage] = useState<DictationLanguage>('fr-FR');
  const [recognizing, setRecognizing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionRange>({ start: value.length, end: value.length });
  const [selectionOverride, setSelectionOverride] = useState<SelectionRange | undefined>(undefined);

  const activeRef = useRef(false);
  const dictationRangeRef = useRef<SelectionRange | null>(null);
  const valueRef = useRef(value);
  const selectionRef = useRef(selection);
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    valueRef.current = value;
    setSelection(prev => {
      const next = clampSelection(prev, value);
      selectionRef.current = next;
      return next;
    });
  }, [value]);
  useEffect(() => { selectionRef.current = selection; }, [selection]);

  useEffect(() => {
    AsyncStorage.getItem(DICTATION_LANGUAGE_KEY)
      .then(raw => {
        if (LANGUAGES.some(item => item.code === raw)) {
          setLanguage(raw as DictationLanguage);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (selectionTimerRef.current) {
        clearTimeout(selectionTimerRef.current);
      }
      if (activeRef.current) {
        activeRef.current = false;
        ExpoSpeechRecognitionModule.abort();
      }
    };
  }, []);

  useSpeechRecognitionEvent('start', () => {
    if (!activeRef.current) return;
    setStarting(false);
    setRecognizing(true);
    setHint('Dictee en cours...');
  });

  useSpeechRecognitionEvent('end', () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    dictationRangeRef.current = null;
    setStarting(false);
    setRecognizing(false);
    setHint(null);
  });

  useSpeechRecognitionEvent('result', (event: ExpoSpeechRecognitionResultEvent) => {
    if (!activeRef.current) return;
    const transcript = event.results?.[0]?.transcript ?? '';
    if (!transcript.trim()) return;
    const currentRange = dictationRangeRef.current ?? clampSelection(selectionRef.current, valueRef.current);
    const next = insertTranscript(valueRef.current, currentRange, transcript, maxLength);
    dictationRangeRef.current = next.range;
    valueRef.current = next.text;
    forceSelection(next.range);
    onChangeText(next.text);
  });

  useSpeechRecognitionEvent('error', (event: ExpoSpeechRecognitionErrorEvent) => {
    if (!activeRef.current) return;
    activeRef.current = false;
    dictationRangeRef.current = null;
    setStarting(false);
    setRecognizing(false);
    const message = friendlyDictationError(event);
    setHint(message);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'language-not-supported') {
      Alert.alert('Dictee vocale', message);
    }
  });

  const selectedLanguage = useMemo(
    () => LANGUAGES.find(item => item.code === language) ?? LANGUAGES[0],
    [language],
  );

  const handleLanguageChange = (code: DictationLanguage) => {
    setLanguage(code);
    AsyncStorage.setItem(DICTATION_LANGUAGE_KEY, code).catch(() => {});
  };

  const handleSelectionChange = (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    const nextSelection = event.nativeEvent.selection;
    setSelection(nextSelection);
    onSelectionChange?.(event);
  };

  const forceSelection = (nextSelection: SelectionRange) => {
    setSelection(nextSelection);
    selectionRef.current = nextSelection;
    setSelectionOverride(nextSelection);
    if (selectionTimerRef.current) {
      clearTimeout(selectionTimerRef.current);
    }
    selectionTimerRef.current = setTimeout(() => {
      setSelectionOverride(undefined);
      selectionTimerRef.current = null;
    }, 150);
  };

  const startDictation = async () => {
    if (!dictationEnabled || editable === false || starting) return;
    setHint(null);

    if (recognizing && activeRef.current) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }

    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        Alert.alert('Dictee vocale', 'La reconnaissance vocale est indisponible sur cet appareil.');
        return;
      }

      const permissions = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permissions.granted) {
        Alert.alert('Dictee vocale', 'Autorisez le micro et la reconnaissance vocale pour utiliser la dictee.');
        return;
      }

      activeRef.current = true;
      dictationRangeRef.current = clampSelection(selectionRef.current, valueRef.current);
      setStarting(true);
      setHint(`Langue : ${selectedLanguage.title}`);
      ExpoSpeechRecognitionModule.start({
        lang: language,
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        iosTaskHint: 'dictation',
        addsPunctuation: Platform.OS === 'ios',
      });
    } catch (err: any) {
      activeRef.current = false;
      dictationRangeRef.current = null;
      setStarting(false);
      setRecognizing(false);
      const message = err?.message ?? 'Impossible de lancer la dictee vocale.';
      setHint(message);
      Alert.alert('Dictee vocale', message);
    }
  };

  const showControls = dictationEnabled && editable !== false;
  const controlsDisabled = !showControls;

  return (
    <View style={[styles.container, containerStyle]}>
      <TextInput
        {...props}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        maxLength={maxLength}
        onSelectionChange={handleSelectionChange}
        selection={selectionOverride}
        style={inputStyle}
      />
      {showControls && (
        <View style={[styles.controls, controlsStyle, controlsDisabled && styles.controlsDisabled]}>
          <View style={styles.languageGroup} accessibilityLabel="Langue de dictee">
            {LANGUAGES.map(item => {
              const active = item.code === language;
              return (
                <TouchableOpacity
                  key={item.code}
                  style={[styles.languageButton, active && styles.languageButtonActive]}
                  onPress={() => handleLanguageChange(item.code)}
                  disabled={controlsDisabled || recognizing || starting}
                  accessibilityRole="button"
                  accessibilityLabel={`Dictee ${item.title}`}
                >
                  <Text style={[styles.languageText, active && styles.languageTextActive]}>{item.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {hint ? <Text style={styles.hint} numberOfLines={1}>{hint}</Text> : <View style={{ flex: 1 }} />}
          <TouchableOpacity
            style={[
              styles.micButton,
              recognizing && styles.micButtonActive,
              controlsDisabled && styles.micButtonDisabled,
            ]}
            onPress={startDictation}
            disabled={controlsDisabled || starting}
            accessibilityRole="button"
            accessibilityLabel={recognizing ? 'Arreter la dictee' : 'Demarrer la dictee'}
          >
            {starting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name={recognizing ? 'stop' : 'mic'} size={16} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  controls: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controlsDisabled: { opacity: 0.55 },
  languageGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  languageButton: {
    minWidth: 34,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  languageButtonActive: {
    backgroundColor: C.primary,
  },
  languageText: {
    color: C.textSub,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  languageTextActive: {
    color: '#fff',
  },
  hint: {
    flex: 1,
    color: C.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  micButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.primary,
  },
  micButtonActive: {
    backgroundColor: C.open,
  },
  micButtonDisabled: {
    backgroundColor: C.textMuted,
  },
});
