import React, { useEffect, useRef } from 'react';
import { View, Text, Image, ActivityIndicator, Animated, Easing, StyleSheet, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';

const NAVY   = '#1B2C4A';
const ORANGE = '#F5A623';
const BG     = '#F5F6FA';
const CARD   = 158;
const BAR_W  = 200;
const WEB    = Platform.OS === 'web';

export default function LoadingScreen() {
  return WEB ? <AnimatedLoadingScreen /> : <NativeLoadingScreen />;
}

function NativeLoadingScreen() {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <View style={styles.nativeLogoWrap}>
        <Image
          source={require('../assets/images/icon.png')}
          style={styles.nativeLogoImage}
          resizeMode="contain"
        />
      </View>
      <View style={styles.textBlock}>
        <Text style={styles.appName}>BuildTrack</Text>
        <Text style={styles.tagline}>{t('app.tagline')}</Text>
      </View>
      <View style={styles.nativeLoadingRow}>
        <ActivityIndicator size="small" color={ORANGE} />
        <Text style={styles.loadingLabel}>{t('common.loading')}</Text>
      </View>
      <View style={styles.brandBottom}>
        <View style={styles.brandPill}>
          <View style={styles.bpDot} />
          <Text style={styles.bpLabel}>{t('common.online')}</Text>
        </View>
      </View>
    </View>
  );
}

function AnimatedLoadingScreen() {
  const { t } = useTranslation();

  // ── Ambient blob ─────────────────────────────────────────────────────────
  const ambientScale   = useRef(new Animated.Value(1)).current;
  const ambientOpacity = useRef(new Animated.Value(0.6)).current;

  // ── Card ─────────────────────────────────────────────────────────────────
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardScale   = useRef(new Animated.Value(0.8)).current;
  const cardRevealY = useRef(new Animated.Value(12)).current;
  const cardFloatY  = useRef(new Animated.Value(0)).current;

  // ── Scan line ─────────────────────────────────────────────────────────────
  const scanTop      = useRef(new Animated.Value(0)).current;
  const scanOpacity  = useRef(new Animated.Value(0)).current;
  const trailHeight  = useRef(new Animated.Value(0)).current;
  const trailOpacity = useRef(new Animated.Value(0)).current;

  // Idle scan
  const idleScanTop     = useRef(new Animated.Value(0)).current;
  const idleScanOpacity = useRef(new Animated.Value(0)).current;

  // ── Corner brackets ───────────────────────────────────────────────────────
  const brTL = useRef(new Animated.Value(0)).current;
  const brTR = useRef(new Animated.Value(0)).current;
  const brBL = useRef(new Animated.Value(0)).current;
  const brBR = useRef(new Animated.Value(0)).current;

  // ── Text block ────────────────────────────────────────────────────────────
  const textOpacity    = useRef(new Animated.Value(0)).current;
  const textTranslateY = useRef(new Animated.Value(8)).current;

  // ── Progress bar ─────────────────────────────────────────────────────────
  const progWrapOpacity    = useRef(new Animated.Value(0)).current;
  const progWrapTranslateY = useRef(new Animated.Value(8)).current;
  const progWidth          = useRef(new Animated.Value(0)).current;
  const progTranslateX     = useRef(new Animated.Value(0)).current;
  const progOpacity        = useRef(new Animated.Value(1)).current;

  // ── Dots ──────────────────────────────────────────────────────────────────
  const dot1 = useRef(new Animated.Value(0.2)).current;
  const dot2 = useRef(new Animated.Value(0.2)).current;
  const dot3 = useRef(new Animated.Value(0.2)).current;

  // ── Logo reveal (top → bottom, synced with scan line) ────────────────────
  const logoRevealH = useRef(new Animated.Value(0)).current;

  // ── Bottom pill ───────────────────────────────────────────────────────────
  const pillOpacity    = useRef(new Animated.Value(0)).current;
  const pillTranslateY = useRef(new Animated.Value(8)).current;
  const pillDotScale   = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // 1. Ambient blob (immediate, infinite)
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(ambientScale,   { toValue: 1.15, duration: 1500, useNativeDriver: true }),
          Animated.timing(ambientOpacity, { toValue: 1,    duration: 1500, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(ambientScale,   { toValue: 1,   duration: 1500, useNativeDriver: true }),
          Animated.timing(ambientOpacity, { toValue: 0.6, duration: 1500, useNativeDriver: true }),
        ]),
      ])
    ).start();

    // 2. Card reveal (delay 100ms)
    Animated.sequence([
      Animated.delay(100),
      Animated.parallel([
        Animated.timing(cardOpacity,  { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring (cardScale,   { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
        Animated.spring (cardRevealY, { toValue: 0, tension: 60, friction: 8, useNativeDriver: true }),
      ]),
    ]).start();

    // 3. Logo reveal top→bottom (delay 550ms, 1300ms — same as scan line)
    Animated.sequence([
      Animated.delay(550),
      Animated.timing(logoRevealH, {
        toValue: 100,
        duration: 1300,
        easing: Easing.bezier(0.4, 0, 0.15, 1),
        useNativeDriver: false,
      }),
    ]).start();

    // 4. Scan line (delay 550ms, 1250ms sweep)
    Animated.sequence([
      Animated.delay(550),
      Animated.parallel([
        Animated.timing(scanOpacity,  { toValue: 1, duration: 50,   useNativeDriver: false }),
        Animated.timing(trailOpacity, { toValue: 1, duration: 50,   useNativeDriver: false }),
      ]),
      Animated.parallel([
        Animated.timing(scanTop,     { toValue: CARD, duration: 1250, useNativeDriver: false }),
        Animated.timing(trailHeight, { toValue: CARD, duration: 1250, useNativeDriver: false }),
      ]),
      Animated.parallel([
        Animated.timing(scanOpacity,  { toValue: 0, duration: 50, useNativeDriver: false }),
        Animated.timing(trailOpacity, { toValue: 0, duration: 50, useNativeDriver: false }),
      ]),
    ]).start();

    // 4. Card float (after 1800ms, infinite)
    Animated.sequence([
      Animated.delay(1800),
      Animated.loop(
        Animated.sequence([
          Animated.timing(cardFloatY, { toValue: -4, duration: 1000, useNativeDriver: true }),
          Animated.timing(cardFloatY, { toValue: -2, duration: 1000, useNativeDriver: true }),
          Animated.timing(cardFloatY, { toValue:  0, duration: 2000, useNativeDriver: true }),
        ])
      ),
    ]).start();

    // 5. Idle scan (after 2500ms, looping)
    Animated.sequence([
      Animated.delay(2500),
      Animated.loop(
        Animated.sequence([
          Animated.timing(idleScanOpacity, { toValue: 0.5, duration: 175,  useNativeDriver: false }),
          Animated.timing(idleScanTop,     { toValue: CARD, duration: 3150, useNativeDriver: false }),
          Animated.timing(idleScanOpacity, { toValue: 0,   duration: 175,  useNativeDriver: false }),
          Animated.timing(idleScanTop,     { toValue: 0,   duration: 0,    useNativeDriver: false }),
        ])
      ),
    ]).start();

    // 6. Corner brackets
    const showBracket = (val: Animated.Value, delay: number) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(val, { toValue: 0.55, duration: 300, useNativeDriver: true }),
      ]).start();
    showBracket(brTL, 1850);
    showBracket(brTR, 1900);
    showBracket(brBL, 1950);
    showBracket(brBR, 2000);

    // 7. Text fade-up (delay 300ms)
    Animated.sequence([
      Animated.delay(300),
      Animated.parallel([
        Animated.timing(textOpacity,    { toValue: 1, duration: 450, useNativeDriver: true }),
        Animated.timing(textTranslateY, { toValue: 0, duration: 450, useNativeDriver: true }),
      ]),
    ]).start();

    // 8. Progress wrap fade-up (delay 550ms)
    Animated.sequence([
      Animated.delay(550),
      Animated.parallel([
        Animated.timing(progWrapOpacity,    { toValue: 1, duration: 450, useNativeDriver: true }),
        Animated.timing(progWrapTranslateY, { toValue: 0, duration: 450, useNativeDriver: true }),
      ]),
    ]).start();

    // 9. Progress bar sweep (delay 800ms, loops): grow → slide out + fade
    const sweepBar = () => {
      progWidth.setValue(0);
      progTranslateX.setValue(0);
      progOpacity.setValue(1);
      Animated.sequence([
        Animated.timing(progWidth,      { toValue: BAR_W,    duration: 1560, useNativeDriver: false }),
        Animated.parallel([
          Animated.timing(progTranslateX, { toValue: BAR_W + 4, duration: 840, useNativeDriver: false }),
          Animated.timing(progOpacity,    { toValue: 0,          duration: 840, useNativeDriver: false }),
        ]),
      ]).start(sweepBar);
    };
    const barTimer = setTimeout(sweepBar, 800);

    // 10. Blinking dots (loop)
    const blinkDot = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1,   duration: 280, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0.2, duration: 840, useNativeDriver: true }),
        ])
      ).start();
    blinkDot(dot1, 0);
    blinkDot(dot2, 200);
    blinkDot(dot3, 400);

    // 11. Bottom pill fade-up (delay 900ms)
    Animated.sequence([
      Animated.delay(900),
      Animated.parallel([
        Animated.timing(pillOpacity,    { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(pillTranslateY, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]),
    ]).start();

    // 12. Pill dot pulse (infinite)
    Animated.loop(
      Animated.sequence([
        Animated.timing(pillDotScale, { toValue: 1.5, duration: 1000, useNativeDriver: true }),
        Animated.timing(pillDotScale, { toValue: 1,   duration: 1000, useNativeDriver: true }),
      ])
    ).start();

    return () => clearTimeout(barTimer);
  }, []);

  return (
    <View style={styles.container}>

      {/* Ambient blob */}
      <Animated.View
        style={[
          styles.ambient,
          { opacity: ambientOpacity, transform: [{ scale: ambientScale }] },
        ]}
      />

      {/* Logo card */}
      <Animated.View
        style={[
          styles.logoWrap,
          {
            opacity: cardOpacity,
            transform: [
              { scale: cardScale },
              { translateY: Animated.add(cardRevealY, cardFloatY) as any },
            ],
          },
        ]}
      >
        <View style={styles.logoCard}>

          {/* Main scan line */}
          <Animated.View
            style={[
              styles.scanLine,
              WEB
                ? ({
                    top: scanTop,
                    opacity: scanOpacity,
                    backgroundImage: 'linear-gradient(90deg, transparent 0%, rgba(245,166,35,0.3) 10%, #FFD580 40%, #F5A623 50%, #FFD580 60%, rgba(245,166,35,0.3) 90%, transparent 100%)',
                    boxShadow: '0 0 6px 1px rgba(245,166,35,0.9), 0 0 16px 3px rgba(245,166,35,0.45)',
                  } as any)
                : { top: scanTop, opacity: scanOpacity },
            ]}
          />

          {/* Scan trail */}
          <Animated.View
            style={[styles.scanTrail, { height: trailHeight, opacity: trailOpacity }]}
          />

          {/* Idle scan */}
          <Animated.View
            style={[
              styles.idleScan,
              WEB
                ? ({
                    top: idleScanTop,
                    opacity: idleScanOpacity,
                    backgroundImage: 'linear-gradient(90deg, transparent 0%, rgba(245,166,35,0.5) 40%, rgba(255,213,128,0.7) 50%, rgba(245,166,35,0.5) 60%, transparent 100%)',
                    boxShadow: '0 0 8px 2px rgba(245,166,35,0.3)',
                  } as any)
                : { top: idleScanTop, opacity: idleScanOpacity },
            ]}
          />

          {/* Glass sheen */}
          <View
            style={[
              styles.glassSheen,
              WEB
                ? ({ backgroundImage: 'linear-gradient(150deg, rgba(255,255,255,0.09) 0%, transparent 55%)' } as any)
                : null,
            ]}
          />

          {/* HUD corner brackets */}
          <Animated.View style={[styles.bracket, styles.brTL, { opacity: brTL }]}>
            <View style={[styles.bLine, styles.bV]} />
            <View style={[styles.bLine, styles.bH]} />
          </Animated.View>
          <Animated.View style={[styles.bracket, styles.brTR, { opacity: brTR }]}>
            <View style={[styles.bLine, styles.bV, { right: 0, left: undefined }]} />
            <View style={[styles.bLine, styles.bH, { right: 0, left: undefined }]} />
          </Animated.View>
          <Animated.View style={[styles.bracket, styles.brBL, { opacity: brBL }]}>
            <View style={[styles.bLine, styles.bV]} />
            <View style={[styles.bLine, styles.bH, { bottom: 0, top: undefined }]} />
          </Animated.View>
          <Animated.View style={[styles.bracket, styles.brBR, { opacity: brBR }]}>
            <View style={[styles.bLine, styles.bV, { right: 0, left: undefined }]} />
            <View style={[styles.bLine, styles.bH, { right: 0, left: undefined, bottom: 0, top: undefined }]} />
          </Animated.View>

          {/* Real app icon — revealed top→bottom in sync with scan line */}
          <Animated.View style={styles.logoRevealClip}>
            <Animated.View style={{ height: logoRevealH, overflow: 'hidden', width: 100 }}>
              <Image
                source={require('../assets/images/icon.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </Animated.View>
          </Animated.View>
        </View>
      </Animated.View>

      {/* App name + tagline */}
      <Animated.View
        style={[
          styles.textBlock,
          { opacity: textOpacity, transform: [{ translateY: textTranslateY }] },
        ]}
      >
        <Text style={styles.appName}>BuildTrack</Text>
        <Text style={styles.tagline}>{t('app.tagline')}</Text>
      </Animated.View>

      {/* Progress bar */}
      <Animated.View
        style={[
          styles.progressWrap,
          { opacity: progWrapOpacity, transform: [{ translateY: progWrapTranslateY }] },
        ]}
      >
        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              WEB
                ? ({
                    width: progWidth,
                    opacity: progOpacity,
                    transform: [{ translateX: progTranslateX }],
                    backgroundImage: `linear-gradient(90deg, ${NAVY} 0%, ${ORANGE} 100%)`,
                  } as any)
                : {
                    width: progWidth,
                    opacity: progOpacity,
                    transform: [{ translateX: progTranslateX }],
                  },
            ]}
          />
        </View>
        <View style={styles.loadingRow}>
          <Text style={styles.loadingLabel}>{t('common.loading')}</Text>
          <Animated.Text style={[styles.dot, { opacity: dot1 }]}>.</Animated.Text>
          <Animated.Text style={[styles.dot, { opacity: dot2 }]}>.</Animated.Text>
          <Animated.Text style={[styles.dot, { opacity: dot3 }]}>.</Animated.Text>
        </View>
      </Animated.View>

      {/* Bottom pill */}
      <Animated.View
        style={[
          styles.brandBottom,
          { opacity: pillOpacity, transform: [{ translateY: pillTranslateY }] },
        ]}
      >
        <View style={styles.brandPill}>
          <Animated.View style={[styles.bpDot, { transform: [{ scale: pillDotScale }] }]} />
          <Text style={styles.bpLabel}>{t('common.online')}</Text>
        </View>
      </Animated.View>

    </View>
  );
}

const cardShadow = WEB
  ? { boxShadow: '0 6px 28px rgba(27,44,74,0.26), 0 2px 6px rgba(27,44,74,0.10)' }
  : {};

const pillShadow = WEB
  ? { boxShadow: '0 2px 8px rgba(27,44,74,0.06)' }
  : {};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 44,
  },

  ambient: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(245,166,35,0.07)',
    top: '50%' as any,
    left: '50%' as any,
    marginLeft: -140,
    marginTop: -200,
    pointerEvents: 'none' as any,
  },

  logoWrap: {
    width: CARD,
    height: CARD,
  },
  logoCard: {
    width: CARD,
    height: CARD,
    backgroundColor: NAVY,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...cardShadow,
  },

  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    zIndex: 5,
    backgroundColor: ORANGE,
    pointerEvents: 'none' as any,
  },

  scanTrail: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 4,
    backgroundColor: 'rgba(245,166,35,0.06)',
    pointerEvents: 'none' as any,
  },

  idleScan: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    zIndex: 5,
    backgroundColor: 'rgba(245,166,35,0.5)',
    pointerEvents: 'none' as any,
  },

  glassSheen: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 35,
    zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    pointerEvents: 'none' as any,
  },

  logoRevealClip: {
    position: 'absolute',
    width: 100,
    height: 100,
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },

  logoImage: {
    width: 100,
    height: 100,
    borderRadius: 22,
  },

  bracket: {
    position: 'absolute',
    width: 18,
    height: 18,
    zIndex: 8,
    pointerEvents: 'none' as any,
  },
  bLine: {
    position: 'absolute',
    backgroundColor: ORANGE,
    borderRadius: 1,
  },
  bV: { width: 2, height: '100%' as any, left: 0, top: 0 },
  bH: { width: '100%' as any, height: 2, left: 0, top: 0 },
  brTL: { top: 10,    left: 10   },
  brTR: { top: 10,    right: 10  },
  brBL: { bottom: 10, left: 10   },
  brBR: { bottom: 10, right: 10  },

  textBlock: {
    alignItems: 'center',
    gap: 5,
  },
  appName: {
    fontSize: 22,
    fontWeight: '700',
    color: NAVY,
    letterSpacing: 0,
    fontFamily: 'Inter_700Bold',
  },
  tagline: {
    fontSize: 12,
    color: 'rgba(27,44,74,0.38)',
    letterSpacing: 0,
    fontFamily: 'Inter_400Regular',
  },

  progressWrap: {
    width: BAR_W,
    alignItems: 'center',
    gap: 12,
  },
  progressTrack: {
    width: BAR_W,
    height: 3,
    backgroundColor: 'rgba(27,44,74,0.08)',
    borderRadius: 99,
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    borderRadius: 99,
    backgroundColor: ORANGE,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(27,44,74,0.32)',
    letterSpacing: 0,
    textTransform: 'uppercase',
    fontFamily: 'Inter_500Medium',
  },
  dot: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(27,44,74,0.32)',
    letterSpacing: 0,
  },
  nativeLogoWrap: {
    width: 160,
    height: 160,
    borderRadius: 80,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  nativeLogoImage: {
    width: 136,
    height: 136,
  },
  nativeLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 28,
  },

  brandBottom: {
    position: 'absolute',
    bottom: 30,
  },
  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(27,44,74,0.07)',
    borderRadius: 99,
    paddingVertical: 6,
    paddingRight: 14,
    paddingLeft: 10,
    ...pillShadow,
  },
  bpDot: {
    width: 7,
    height: 7,
    backgroundColor: ORANGE,
    borderRadius: 4,
  },
  bpLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: NAVY,
    fontFamily: 'Inter_600SemiBold',
  },
});
