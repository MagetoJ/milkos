import type { CapacitorConfig } from '@capacitor/cli';

const local = process.env.MILKOS_LOCAL === '1';

const config: CapacitorConfig = {
  appId: 'com.milkos.app',
  appName: 'MilkOS',
  webDir: 'out',
  server: {
    androidScheme: local ? 'http' : 'https',
    cleartext: local,
  },
  android: {
    allowMixedContent: local,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
