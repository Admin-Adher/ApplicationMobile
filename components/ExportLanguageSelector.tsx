import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_APP_LANGUAGES, type AppLanguage } from '@/constants/language';
import { C } from '@/constants/colors';

type Props = {
  value: AppLanguage;
  onChange: (language: AppLanguage) => void | Promise<void>;
  compact?: boolean;
  showHeading?: boolean;
};

export default function ExportLanguageSelector({ value, onChange, compact = false, showHeading = true }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.root} accessibilityRole="radiogroup" accessibilityLabel={t('settings.exportLanguage')}>
      {showHeading ? (
        <View style={styles.heading}>
          <View style={styles.iconWrap}><Ionicons name="language-outline" size={18} color={C.primary} /></View>
          <View style={styles.headingCopy}>
            <Text style={styles.title}>{t('settings.exportLanguage')}</Text>
            {!compact ? <Text style={styles.subtitle}>{t('settings.exportLanguageDescription')}</Text> : null}
          </View>
        </View>
      ) : null}
      <View style={styles.options}>
        {SUPPORTED_APP_LANGUAGES.map(option => {
          const selected = option.code === value;
          return (
            <TouchableOpacity
              key={option.code}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${option.nativeName} (${option.label})`}
              activeOpacity={0.78}
              onPress={() => { void onChange(option.code); }}
              style={[styles.option, compact && styles.optionCompact, selected && styles.optionSelected]}
            >
              <Text style={[styles.code, selected && styles.codeSelected]}>{option.label}</Text>
              {!compact ? <Text numberOfLines={1} style={[styles.name, selected && styles.nameSelected]}>{option.nativeName}</Text> : null}
              {selected ? <Ionicons name="checkmark-circle" size={16} color={C.primary} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primaryBg },
  headingCopy: { flex: 1 },
  title: { color: C.text, fontFamily: 'Inter_700Bold', fontSize: 14 },
  subtitle: { color: C.textSub, fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 2 },
  options: { flexDirection: 'row', gap: 8 },
  option: { flex: 1, minHeight: 52, paddingHorizontal: 9, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  optionCompact: { minHeight: 44, flexDirection: 'row', gap: 5, paddingHorizontal: 8, paddingVertical: 6 },
  optionSelected: { borderColor: C.primary, backgroundColor: C.primaryBg },
  code: { color: C.textSub, fontFamily: 'Inter_800ExtraBold', fontSize: 12, letterSpacing: 0.8 },
  codeSelected: { color: C.primary },
  name: { color: C.textMuted, fontFamily: 'Inter_500Medium', fontSize: 9, marginTop: 2 },
  nameSelected: { color: C.primary },
});
