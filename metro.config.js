const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = true;

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
      'pdfjs-dist' +
    '))',
  ],
};

module.exports = config;
