'use client'

import { useEffect, useState, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'

type Permission = 'default' | 'granted' | 'denied' | 'unsupported'

interface PushNotificationState {
  permission: Permission
  isEnabled: boolean
  isNative: boolean
  requestPermission: () => Promise<boolean>
  enable: () => Promise<boolean>
  disable: () => void
  notify: (title: string, body: string, options?: NotificationOptions) => void
}

const STORAGE_KEY = 'bharatchat.push-enabled'

export function usePushNotifications(): PushNotificationState {
  const [permission, setPermission] = useState<Permission>('default')
  const [isEnabled, setIsEnabled] = useState(false)
  const isNative = typeof window !== 'undefined' && Capacitor.isNativePlatform()

  // Initialize state from browser / native APIs
  useEffect(() => {
    Promise.resolve().then(async () => {
      const storedEnabled = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) === 'true' : false
      setIsEnabled(storedEnabled)

      if (typeof window === 'undefined') return

      if (Capacitor.isNativePlatform()) {
        try {
          const { LocalNotifications } = await import('@capacitor/local-notifications')
          const status = await LocalNotifications.checkPermissions()
          if (status.display === 'granted') {
            setPermission('granted')
          } else if (status.display === 'denied') {
            setPermission('denied')
          } else {
            setPermission('default')
          }
        } catch {
          setPermission('default')
        }
        return
      }

      if (!('Notification' in window)) {
        setPermission('unsupported')
        return
      }
      setPermission(Notification.permission as Permission)
    })
  }, [])

  const requestPermission = useCallback(async () => {
    if (typeof window === 'undefined') return false

    if (Capacitor.isNativePlatform()) {
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications')
        const result = await LocalNotifications.requestPermissions()
        const granted = result.display === 'granted'
        setPermission(granted ? 'granted' : 'denied')
        return granted
      } catch (err) {
        console.warn('Native notification permission error:', err)
        return false
      }
    }

    if (!('Notification' in window)) return false
    const result = await Notification.requestPermission()
    setPermission(result as Permission)
    return result === 'granted'
  }, [])

  const enable = useCallback(async () => {
    const granted = await requestPermission()
    if (granted) {
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, 'true')
      }
      setIsEnabled(true)
      // Welcome notification
      try {
        if (Capacitor.isNativePlatform()) {
          const { LocalNotifications } = await import('@capacitor/local-notifications')
          await LocalNotifications.schedule({
            notifications: [
              {
                title: 'BharatChat Notifications Enabled',
                body: 'You will now receive message notifications on your device.',
                id: 1001,
              },
            ],
          })
        } else {
          const reg = await navigator.serviceWorker?.ready
          if (reg) {
            reg.showNotification('BharatChat notifications enabled', {
              body: 'You will now receive notifications for new messages when this tab is in the background.',
              icon: '/icon-192.png',
              tag: 'bharatchat-welcome',
            })
          } else if ('Notification' in window) {
            new Notification('BharatChat notifications enabled', {
              body: 'You will now receive notifications for new messages when this tab is in the background.',
            })
          }
        }
      } catch {}
      return true
    }
    return false
  }, [requestPermission])

  const disable = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
    }
    setIsEnabled(false)
  }, [])

  const notify = useCallback(
    async (title: string, body: string, options?: NotificationOptions) => {
      if (!isEnabled || permission !== 'granted') return

      if (Capacitor.isNativePlatform()) {
        try {
          const { LocalNotifications } = await import('@capacitor/local-notifications')
          await LocalNotifications.schedule({
            notifications: [
              {
                title,
                body,
                id: Math.floor(Math.random() * 1000000),
                sound: 'default',
              },
            ],
          })
        } catch (e) {
          console.warn('Failed to show native notification', e)
        }
        return
      }

      // Only show notifications when the document is hidden (tab in background)
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        return
      }
      try {
        const opts: any = {
          body,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: options?.tag || 'bharatchat-message',
          renotify: true,
          ...options,
        }
        // Prefer service worker notifications (works when tab is hidden)
        if (navigator.serviceWorker) {
          navigator.serviceWorker.ready
            .then((reg) => reg.showNotification(title, opts))
            .catch(() => {
              if ('Notification' in window) {
                new Notification(title, opts)
              }
            })
        } else if ('Notification' in window) {
          new Notification(title, opts)
        }
      } catch (e) {
        console.warn('Failed to show notification', e)
      }
    },
    [isEnabled, permission]
  )

  return {
    permission,
    isEnabled,
    isNative,
    requestPermission,
    enable,
    disable,
    notify,
  }
}
