import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
  ScrollView, Clipboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

function reloadApp() {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.location.reload();
  }
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

function ErrorFallback({
  error,
  componentStack,
}: {
  error: Error | null;
  componentStack: string | null;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const errorName = error?.name ?? 'Error';
  const errorMessage = error?.message ?? t('errorBoundary.defaultMessage');
  const jsStack = error?.stack ?? '';

  const fullLog = [
    `[ERROR] ${errorName}: ${errorMessage}`,
    '',
    jsStack ? `--- JS Stack ---\n${jsStack}` : '',
    componentStack ? `--- Component Stack ---${componentStack}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const handleCopy = () => {
    try {
      Clipboard.setString(fullLog);
    } catch {}
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 24) },
      ]}
    >
      <Text style={styles.title}>{t('errorBoundary.title')}</Text>
      <Text style={styles.errorName}>{errorName}</Text>
      <Text style={styles.message}>{errorMessage}</Text>

      <View style={styles.logBox}>
        <View style={styles.logHeader}>
          <Text style={styles.logHeaderText}>{t('errorBoundary.debugLogs')}</Text>
          <TouchableOpacity style={styles.copyButton} onPress={handleCopy}>
            <Text style={styles.copyButtonText}>{t('errorBoundary.copy')}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          style={styles.logScroll}
          contentContainerStyle={styles.logContent}
          showsVerticalScrollIndicator={true}
          nestedScrollEnabled={true}
        >
          {jsStack ? (
            <>
              <Text style={styles.logSectionLabel}>{t('errorBoundary.jsStack')}</Text>
              <Text style={styles.logText} selectable>{jsStack}</Text>
            </>
          ) : null}
          {componentStack ? (
            <>
              <Text style={[styles.logSectionLabel, { marginTop: 12 }]}>{t('errorBoundary.reactTree')}</Text>
              <Text style={styles.logText} selectable>{componentStack}</Text>
            </>
          ) : null}
          {!jsStack && !componentStack ? (
            <Text style={styles.logText}>{t('errorBoundary.noTrace')}</Text>
          ) : null}
        </ScrollView>
      </View>

      <TouchableOpacity style={styles.button} onPress={reloadApp}>
        <Text style={styles.buttonText}>{t('errorBoundary.restart')}</Text>
      </TouchableOpacity>
    </View>
  );
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    console.error('[ErrorBoundary] Uncaught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          componentStack={this.state.componentStack}
        />
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F1117',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 8,
  },
  errorName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F87171',
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
  },
  logBox: {
    flex: 1,
    width: '100%',
    backgroundColor: '#1A1D27',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2D3148',
    overflow: 'hidden',
    marginVertical: 4,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2D3148',
  },
  logHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  copyButton: {
    backgroundColor: '#374151',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  copyButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#D1D5DB',
  },
  logScroll: {
    flex: 1,
  },
  logContent: {
    padding: 12,
  },
  logSectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4B5563',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  logText: {
    fontSize: 10,
    color: '#D1FAE5',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },
  button: {
    width: '100%',
    backgroundColor: '#1D4ED8',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
