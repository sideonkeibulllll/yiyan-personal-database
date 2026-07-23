import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yiyan.memorydb',
  appName: '记忆库',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    // 启用原生 HTTP（绕过 WebView 混合内容拦截 + 自签证书问题）
    // 用于数据互通：手机作为发送方时 fetch http://192.168.x.x
    CapacitorHttp: {
      enabled: true,
    },
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
