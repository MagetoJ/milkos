import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.milkos.app',
  appName: 'MilkOS',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    url: 'https://milkos.onrender.com',
    cleartext: true
  }
};

export default config;
