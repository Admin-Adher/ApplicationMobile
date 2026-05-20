import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
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
import {
  TEXT_ASSIST_LANGUAGES,
  TextAssistContext,
  TextAssistLanguage,
  detectTextLanguage,
  textAssistAdvancedCacheKey,
} from '@/lib/textAssist';
import { requestAdvancedTranslation } from '@/lib/textAssistOnline';

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
  style?: StyleProp<TextStyle>;
  inputStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  controlsStyle?: StyleProp<ViewStyle>;
  dictationEnabled?: boolean;
  textAssistEnabled?: boolean;
  textAssistContext?: TextAssistContext;
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

const DictationTextInput = forwardRef<TextInput, DictationTextInputProps>(function DictationTextInput({
  value,
  onChangeText,
  style,
  inputStyle,
  containerStyle,
  controlsStyle,
  dictationEnabled = true,
  textAssistEnabled = false,
  textAssistContext = 'generic',
  editable = true,
  onSelectionChange,
  maxLength,
  ...props
}: DictationTextInputProps, ref) {
  const [language, setLanguage] = useState<DictationLanguage>('fr-FR');
  const [recognizing, setRecognizing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionRange>({ start: value.length, end: value.length });
  const [selectionOverride, setSelectionOverride] = useState<SelectionRange | undefined>(undefined);
  const [assistExpanded, setAssistExpanded] = useState(false);
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistSuggestion, setAssistSuggestion] = useState<{ title: string; text: string } | null>(null);
  const [previousText, setPreviousText] = useState<string | null>(null);

  const activeRef = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const dictationRangeRef = useRef<SelectionRange | null>(null);
  const valueRef = useRef(value);
  const selectionRef = useRef(selection);
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => inputRef.current as TextInput);

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
  const showAssist = textAssistEnabled && editable !== false;
  const controlsDisabled = !showControls;
  const assistSourceLanguage = useMemo(() => detectTextLanguage(value), [value]);

  const limitSuggestion = (text: string) => typeof maxLength === 'number' ? text.slice(0, maxLength) : text;

  const proposeTranslation = async (target: TextAssistLanguage) => {
    if (!showAssist || !value.trim()) return;
    setAssistBusy(true);
    setHint(null);
    try {
      const source = detectTextLanguage(value);
      const targetLabel = TEXT_ASSIST_LANGUAGES.find(l => l.code === target)?.label ?? target.toUpperCase();
      if (source === target) {
        setAssistSuggestion(null);
        setHint(`Le texte est deja en ${targetLabel}.`);
        return;
      }

      const advancedCacheKey = textAssistAdvancedCacheKey(value, target, source);
      const cachedAdvanced = await AsyncStorage.getItem(advancedCacheKey);
      if (cachedAdvanced) {
        setHint('Traduction Azure depuis le cache.');
        setAssistSuggestion({ title: `Traduction ${targetLabel}`, text: limitSuggestion(cachedAdvanced) });
        return;
      }

      const advanced = await requestAdvancedTranslation({
        text: value,
        target,
        source,
        context: textAssistContext,
      });

      if (advanced?.text) {
        AsyncStorage.setItem(advancedCacheKey, advanced.text).catch(() => {});
        setHint(`Traduction en ligne via ${advanced.provider}.`);
        setAssistSuggestion({ title: `Traduction ${targetLabel}`, text: limitSuggestion(advanced.text) });
        return;
      }

      setHint('Traduction Azure indisponible.');
    } catch (err: any) {
      setAssistSuggestion(null);
      setHint(err?.message || 'Traduction Azure indisponible.');
    } finally {
      setAssistBusy(false);
    }
  };

  const applySuggestion = () => {
    if (!assistSuggestion) return;
    setPreviousText(value);
    onChangeText(assistSuggestion.text);
    setAssistSuggestion(null);
    setHint('Texte remplace. Annulation possible.');
  };

  const restorePreviousText = () => {
    if (previousText == null) return;
    onChangeText(previousText);
    setPreviousText(null);
    setHint('Texte precedent restaure.');
  };

  return (
    <View style={[styles.container, containerStyle]}>
      <TextInput
        {...props}
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        maxLength={maxLength}
        onSelectionChange={handleSelectionChange}
        selection={selectionOverride}
        style={[style, inputStyle]}
      />
      {(showControls || showAssist) && (
        <View style={[styles.controls, controlsStyle, controlsDisabled && styles.controlsDisabled]}>
          {showControls && (
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
          )}
          {hint ? <Text style={styles.hint} numberOfLines={2}>{hint}</Text> : <View style={{ flex: 1 }} />}
          {previousText != null && (
            <TouchableOpacity
              style={styles.undoButton}
              onPress={restorePreviousText}
              accessibilityRole="button"
              accessibilityLabel="Annuler la derniere assistance texte"
            >
              <Ionicons name="arrow-undo-outline" size={16} color={C.primary} />
            </TouchableOpacity>
          )}
          {showAssist && (
            <TouchableOpacity
              style={[styles.assistButton, assistExpanded && styles.assistButtonActive]}
              onPress={() => setAssistExpanded(v => !v)}
              accessibilityRole="button"
              accessibilityLabel="Ouvrir la traduction"
            >
              {assistBusy ? (
                <ActivityIndicator size="small" color={assistExpanded ? '#fff' : C.primary} />
              ) : (
                <Ionicons name="sparkles-outline" size={16} color={assistExpanded ? '#fff' : C.primary} />
              )}
            </TouchableOpacity>
          )}
          {showControls && (
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
          )}
        </View>
      )}
      {showAssist && assistExpanded && (
        <View style={styles.assistPanel}>
          <View style={styles.assistHeader}>
            <Text style={styles.assistTitle}>Traduction</Text>
            <Text style={styles.assistSource}>source {assistSourceLanguage.toUpperCase()}</Text>
          </View>
          <View style={styles.assistActions}>
            {TEXT_ASSIST_LANGUAGES.map(item => (
              <TouchableOpacity
                key={item.code}
                style={styles.assistChip}
                onPress={() => proposeTranslation(item.code)}
                disabled={assistBusy || !value.trim()}
                accessibilityRole="button"
                accessibilityLabel={`Traduire en ${item.title}`}
              >
                <Ionicons name="language-outline" size={13} color={C.primary} />
                <Text style={styles.assistChipText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {assistSuggestion && (
            <View style={styles.suggestionCard}>
              <Text style={styles.suggestionTitle}>{assistSuggestion.title}</Text>
              <Text style={styles.suggestionText} numberOfLines={4}>{assistSuggestion.text}</Text>
              <View style={styles.suggestionActions}>
                <TouchableOpacity style={styles.suggestionCancel} onPress={() => setAssistSuggestion(null)}>
                  <Text style={styles.suggestionCancelText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.suggestionApply} onPress={applySuggestion}>
                  <Text style={styles.suggestionApplyText}>Remplacer</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
});

export default DictationTextInput;

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
  undoButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: '#fff',
  },
  assistButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.primary + '35',
    backgroundColor: C.primary + '10',
  },
  assistButtonActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  assistPanel: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: '#fff',
    padding: 10,
    gap: 8,
  },
  assistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  assistTitle: {
    color: C.text,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  assistSource: {
    color: C.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
  },
  assistActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  assistChip: {
    minHeight: 30,
    borderRadius: 9,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: C.primary + '25',
    backgroundColor: C.primary + '08',
  },
  assistChipText: {
    color: C.primary,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  suggestionCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface2,
    padding: 10,
    gap: 7,
  },
  suggestionTitle: {
    color: C.text,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  suggestionText: {
    color: C.textSub,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
  suggestionActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  suggestionCancel: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: '#fff',
  },
  suggestionCancelText: {
    color: C.textSub,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  suggestionApply: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.primary,
  },
  suggestionApplyText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
});
