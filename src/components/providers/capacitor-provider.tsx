'use client'

import { useEffect } from 'react'
import { useChatStore } from '@/store/chat-store'

export function CapacitorProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Dynamic import to ensure zero build errors or overhead on web
    let isMounted = true

    async function initCapacitor() {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return

        // 1. Configure Status Bar
        try {
          const { StatusBar, Style } = await import('@capacitor/status-bar')
          await StatusBar.setStyle({ style: Style.Dark })
          await StatusBar.setBackgroundColor({ color: '#1C1C1E' })
        } catch (e) {
          console.warn('[Capacitor] StatusBar error:', e)
        }

        // 2. Hide Splash Screen cleanly
        try {
          const { SplashScreen } = await import('@capacitor/splash-screen')
          await SplashScreen.hide()
        } catch (e) {
          console.warn('[Capacitor] SplashScreen error:', e)
        }

        // 3. Hardware Back Button Handling
        try {
          const { App } = await import('@capacitor/app')
          App.addListener('backButton', () => {
            const store = useChatStore.getState()
            if (store.activeConversationId) {
              // Navigate back to the conversation list
              store.setActiveConversation(null)
            } else {
              // Exit application if at root
              App.exitApp()
            }
          })
        } catch (e) {
          console.warn('[Capacitor] App backButton error:', e)
        }
      } catch (err) {
        console.warn('[Capacitor] Platform check skipped:', err)
      }
    }

    initCapacitor()

    return () => {
      isMounted = false
    }
  }, [])

  return <>{children}</>
}

// Utility to trigger native haptic feedback on mobile devices
export async function triggerHaptic() {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (Capacitor.isNativePlatform()) {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
      await Haptics.impact({ style: ImpactStyle.Light })
    }
  } catch {}
}
