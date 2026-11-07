'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { TEXT_LANG_OPTIONS, defaultTextLang, appendDictationText, speechRecognitionErrorMessage, requestWebTranslation, type TextLang } from '@/lib/text-assist-client';
import styles from './web.module.css';


type TextAssistProps = {
  value: string;
  onChange: (value: string) => void;
  context: string;
  label?: string;
  compact?: boolean;
  maxLength?: number;
  disabled?: boolean;
};

export default function TextAssistControls({ compact = false, label = 'ce texte', ...props }: TextAssistProps) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (!compact) return <TextAssistPanel {...props} />;
  return <div className={styles.assistDisclosure}>
    <button type="button" className={styles.assistToggle} disabled={props.disabled} aria-expanded={expanded}
      aria-controls={id} aria-label={`Dictée et traduction — ${label}`} onClick={() => setExpanded(value => !value)}>
      Dictée et traduction <span aria-hidden="true">{expanded ? '−' : '+'}</span>
    </button>
    <div id={id} role="group" aria-label={`Assistance — ${label}`} hidden={!expanded}>
      {expanded ? <TextAssistPanel {...props} compact /> : null}
    </div>
  </div>;
}

function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
    </svg>
  );
}

function TextAssistPanel({
  value,
  onChange,
  context,
  maxLength,
  disabled = false,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  context: string;
  maxLength?: number;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [dictationOpen, setDictationOpen] = useState(false);
  const [lang, setLang] = useState<TextLang>(() => defaultTextLang());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const recognitionRef = useRef<any>(null);
  const manualStopRef = useRef(false);
  const receivedResultRef = useRef(false);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const activeRef = useRef(true);
  const disabledRef = useRef(disabled);
  const [previous, setPrevious] = useState<{ before: string; after: string } | null>(null);
  useEffect(() => { valueRef.current = value; onChangeRef.current = onChange; }, [value, onChange]);
  useEffect(() => {
    disabledRef.current = disabled;
    if (disabled) {
      try { recognitionRef.current?.abort?.(); } catch { /* Already stopped. */ }
      recognitionRef.current = null;
      setBusy(null);
    }
  }, [disabled]);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      try {
        recognitionRef.current?.abort?.();
      } catch {
        // Some browsers throw when speech recognition is already closed.
      }
      recognitionRef.current = null;
    };
  }, []);

  function setPreferredLang(next: TextLang) {
    setLang(next);
    try { window.localStorage.setItem('buildtrack-web-dictation-lang', next); } catch { /* Keep the in-memory choice. */ }
  }

  function stopDictation() {
    manualStopRef.current = true;
    try {
      recognitionRef.current?.stop?.();
    } catch {
      // Some browsers throw when speech recognition is already closed.
    }
    recognitionRef.current = null;
    setBusy(null);
  }

  async function startDictation(nextLang: TextLang) {
    if (disabled || (busy && busy !== 'dictation')) return;
    setPreferredLang(nextLang);
    setDictationOpen(true);
    setMessage('');
    if (typeof window === 'undefined') return;
    if (busy === 'dictation') {
      stopDictation();
      return;
    }
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      setMessage("La dictée vocale n'est pas disponible dans ce navigateur. Essayez Chrome ou Edge.");
      return;
    }

    if (window.isSecureContext === false) {
      setMessage('La dictée nécessite une page sécurisée en HTTPS.');
      return;
    }

    setBusy('microphone');
    setMessage('Préparation du microphone...');
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      } catch (micError: any) {
        const code = micError?.name === 'NotFoundError' || micError?.name === 'DevicesNotFoundError'
          ? 'audio-capture'
          : 'not-allowed';
        if (!activeRef.current) return;
        setBusy(null);
        setMessage(speechRecognitionErrorMessage(code));
        return;
      }
    }

    if (!activeRef.current || disabledRef.current) return;
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    manualStopRef.current = false;
    receivedResultRef.current = false;
    recognition.lang = TEXT_LANG_OPTIONS.find(item => item.value === nextLang)?.speech ?? 'fr-FR';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    setBusy('dictation');
    recognition.onstart = () => { if (activeRef.current) setMessage('Parlez maintenant...'); };
    recognition.onresult = (event: any) => {
      const text = event?.results?.[0]?.[0]?.transcript;
      if (text && activeRef.current && !disabledRef.current) {
        receivedResultRef.current = true;
        const next = appendDictationText(valueRef.current, text).slice(0, maxLength);
        valueRef.current = next;
        onChangeRef.current(next);
        setMessage('Dictée ajoutée.');
      }
    };
    recognition.onerror = (event: any) => {
      if (!activeRef.current) return;
      const code = String(event?.error ?? '');
      if (manualStopRef.current && code === 'aborted') return;
      setMessage(speechRecognitionErrorMessage(code));
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (!activeRef.current) return;
      setBusy(null);
      if (manualStopRef.current) setMessage('');
      if (receivedResultRef.current) window.setTimeout(() => setMessage(''), 1800);
    };
    try {
      recognition.start();
    } catch (startError: any) {
      recognitionRef.current = null;
      setBusy(null);
      setMessage(startError?.name === 'InvalidStateError'
        ? 'Une dictée est déjà en cours. Patientez une seconde puis réessayez.'
        : 'Impossible de démarrer la dictée. Réessayez dans quelques secondes.');
    }
  }

  async function translate(target: TextLang) {
    if (!value.trim() || disabled || busy) return;
    const original = value;
    setMessage('');
    setBusy(`translate-${target}`);
    try {
      const translated = await requestWebTranslation({ text: original, source: 'auto', target, context });
      if (!activeRef.current) return;
      if (valueRef.current !== original) {
        setMessage('Le texte a changé pendant la traduction. Relancez-la pour traduire la version actuelle.');
        return;
      }
      if (maxLength && translated.length > maxLength) {
        setMessage(`La traduction dépasse la limite de ${maxLength} caractères. Raccourcissez le texte puis réessayez.`);
        return;
      }
      setPrevious({ before: original, after: translated });
      valueRef.current = translated;
      onChangeRef.current(translated);
    } catch (err: unknown) {
      if (activeRef.current) setMessage(err instanceof Error ? err.message : 'Traduction indisponible.');
    } finally {
      if (activeRef.current) setBusy(null);
    }
  }

  return (
    <div className={styles.textAssist} data-compact={compact || undefined}>
      <div className={styles.textAssistGrid}>
        <section className={`${styles.textAssistSection} ${dictationOpen || busy === 'dictation' ? styles.textAssistSectionOpen : ''}`}>
          <div className={styles.textAssistSectionHeader}>
            <button
              type="button"
              disabled={disabled || Boolean(busy && busy !== 'dictation')}
              onClick={() => {
                if (busy === 'dictation') {
                  stopDictation();
                } else if (dictationOpen) {
                  void startDictation(lang);
                } else {
                  setDictationOpen(true);
                }
              }}
              className={`${styles.microIconButton} ${busy === 'dictation' ? styles.textAssistActive : ''}`}
              aria-label={busy === 'dictation' ? 'Arrêter la dictée' : dictationOpen ? `Démarrer la dictée en ${TEXT_LANG_OPTIONS.find(option => option.value === lang)?.name ?? 'français'}` : 'Choisir la langue de dictée'}
              aria-expanded={dictationOpen || busy === 'dictation'}
              title={busy === 'dictation' ? 'Arrêter la dictée' : dictationOpen ? 'Démarrer la dictée' : 'Choisir la langue de dictée'}
            >
              <MicrophoneIcon />
            </button>
            <div>
              <strong>{busy === 'dictation' ? 'Écoute en cours' : 'Dictée vocale'}</strong>
              <small>
                {busy === 'dictation'
                  ? `Parlez en ${TEXT_LANG_OPTIONS.find(option => option.value === lang)?.name ?? 'français'}`
                  : `Langue parlée sélectionnée : ${TEXT_LANG_OPTIONS.find(option => option.value === lang)?.label ?? 'FR'}`}
              </small>
            </div>
          </div>
          {dictationOpen || busy === 'dictation' ? (
            <div className={styles.dictationPanelWeb}>
              <div className={styles.dictationPicker}>
                {TEXT_LANG_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    className={lang === option.value ? styles.dictationLangActive : styles.dictationLang}
                    onClick={() => {
                      if (busy === 'dictation') return;
                      setPreferredLang(option.value);
                      setMessage('');
                    }}
                    disabled={disabled || Boolean(busy)}
                    aria-pressed={lang === option.value}
                  >
                    <span>{option.label}</span>
                    <small>{option.name}</small>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={styles.dictationStartButtonWeb}
                disabled={disabled || Boolean(busy && busy !== 'dictation')}
                onClick={() => (busy === 'dictation' ? stopDictation() : startDictation(lang))}
              >
                {busy === 'dictation' ? 'Arrêter' : `Dicter en ${TEXT_LANG_OPTIONS.find(option => option.value === lang)?.label ?? 'FR'}`}
              </button>
            </div>
          ) : null}
        </section>

        <section className={styles.textAssistSection}>
          <div className={styles.textAssistSectionHeader}>
            <div className={styles.translationIconWeb}>文</div>
            <div>
              <strong>Traduction</strong>
              <small>Remplace le texte par la langue choisie</small>
            </div>
          </div>
          <div className={styles.translationPickerWeb}>
            {TEXT_LANG_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => translate(option.value)}
                disabled={disabled || !value.trim() || Boolean(busy)}
              >
                {busy === `translate-${option.value}` ? '...' : `Vers ${option.label}`}
              </button>
            ))}
          </div>
        </section>
      </div>
      {previous && value === previous.after ? <button type="button" className={styles.assistUndo} disabled={disabled || Boolean(busy)} onClick={() => {
        valueRef.current = previous.before;
        onChangeRef.current(previous.before);
        setPrevious(null);
      }}>Annuler la traduction</button> : null}
      {message ? <small role="status" className={styles.textAssistMessage}>{message}</small> : null}
    </div>
  );
}

