import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.milkos.app',
  appName: 'MilkOS',
  webDir: 'out',
  server: {
    androidScheme: 'https'
  }
};

export default config;
