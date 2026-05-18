const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts = Array.from(new Set([
  ...config.resolver.assetExts,
  'txt',
]));

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isPdfJs =
    moduleName === '@/lib/pdfjs' ||
    moduleName.endsWith('/lib/pdfjs') ||
    moduleName.endsWith('\\lib\\pdfjs');

  if (isPdfJs && platform !== 'web') {
    return {
      filePath: path.resolve(__dirname, 'lib/pdfjs.ts'),
      type: 'sourceFile',
    };
  }

  return context.resolveRequest(context, moduleName, platform);
};

config.transformer = {
  ...config.transformer,
  transformIgnorePatterns: [
    'node_modules/(?!(' +
      '(jest-)?react-native|' +
      '@react-native(-community)?|' +
      'expo(nent)?|' +
      '@expo(nent)?/.*|' +
      '@expo-google-fonts/.*|' +
      'react-navigation|' +
      '@react-navigation/.*|' +
      '@unimodules/.*|' +
      'unimodules|' +
      'sentry-expo|' +
      'native-base|' +
      'react-native-svg|' +
      'react-native-reanimated|' +
      'react-native-gesture-handler|' +
      'react-native-screens|' +
      'react-native-safe-area-context|' +
      'react-native-keyboard-controller|' +
      'react-native-webview|' +
      '@tanstack/.*|' +
      'p-limit|' +
      'p-retry|' +
      'pdfjs-dist' +
    '))',
  ],
};

module.exports = config;
