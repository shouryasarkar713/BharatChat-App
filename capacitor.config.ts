import type { CapacitorConfig } from '@capacitor/cli'

const DEFAULT_URL = 'https://bharat-chat-app-vqn8.vercel.app'
const rawUrl = process.env.CAPACITOR_SERVER_URL?.trim() || DEFAULT_URL
const serverUrl = rawUrl && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) ? rawUrl : DEFAULT_URL

const config: CapacitorConfig = {
  appId: 'com.bharatchat.app',
  appName: 'BharatChat',
  webDir: 'public',
  server: {
    url: serverUrl,
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
