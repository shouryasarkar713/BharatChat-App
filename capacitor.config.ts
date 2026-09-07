import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.bharatchat.app',
  appName: 'BharatChat',
  webDir: 'public',
  server: {
    // Set to your deployed URL when building an APK for family distribution
    // e.g. 'https://bharatchat-app.vercel.app'
    url: process.env.CAPACITOR_SERVER_URL,
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#1C1C1E',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1C1C1E',
    },
  },
}

export default config
