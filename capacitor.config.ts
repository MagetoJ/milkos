import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.milkos.app',
  appName: 'MilkOS',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    url: 'https://dairyflo.netlify.app',
    cleartext: true
  }
};

export default config;
