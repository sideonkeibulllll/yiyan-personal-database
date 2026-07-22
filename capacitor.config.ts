import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yiyan.memorydb',
  appName: '记忆库',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0a0f',
    },
    SQLite: {
      iosDatabaseLocation: 'Library/LocalDatabase',
      iosIsEncryption: false,
      iosKeychainPrefix: 'yiyan',
      iosBiometric: {
        biometricAuth: false,
        biometricTitle: 'Biometric login for capacitor sqlite',
      },
      androidDatabaseLocation: 'databases',
      androidIsEncryption: false,
    },
  },
};

export default config;
