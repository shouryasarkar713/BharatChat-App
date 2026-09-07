import type { CapacitorConfig } from '@capacitor/cli'

const rawUrl = process.env.CAPACITOR_SERVER_URL?.trim()
const serverUrl = rawUrl && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) ? rawUrl : undefined

const config: CapacitorConfig = {
  appId: 'com.bharatchat.app',
  appName: 'BharatChat',
  webDir: 'public',
  server: {
    ...(serverUrl ? { url: serverUrl } : {}),
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
