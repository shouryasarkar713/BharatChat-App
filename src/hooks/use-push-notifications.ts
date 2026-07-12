'use client'

import { useEffect, useState, useCallback } from 'react'

type Permission = 'default' | 'granted' | 'denied' | 'unsupported'

interface PushNotificationState {
  permission: Permission
  isEnabled: boolean
  requestPermission: () => Promise<boolean>
  enable: () => Promise<boolean>
  disable: () => void
  notify: (title: string, body: string, options?: NotificationOptions) => void
}

const STORAGE_KEY = 'bharatchat.push-enabled'

export function usePushNotifications(): PushNotificationState {
  const [permission, setPermission] = useState<Permission>('default')
  const [isEnabled, setIsEnabled] = useState(false)

  // Initialize state from browser APIs
  useEffect(() => {
    Promise.resolve().then(() => {
      if (typeof window === 'undefined' || !('Notification' in window)) {
        setPermission('unsupported')
        return
      }
      setPermission(Notification.permission as Permission)
      setIsEnabled(localStorage.getItem(STORAGE_KEY) === 'true')
    })
  }, [])

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return false
    const result = await Notification.requestPermission()
    setPermission(result as Permission)
    return result === 'granted'
  }, [])

  const enable = useCallback(async () => {
    const granted = await requestPermission()
    if (granted) {
      localStorage.setItem(STORAGE_KEY, 'true')
      setIsEnabled(true)
      // Welcome notification
      try {
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
      } catch {}
      return true
    }
    return false
  }, [requestPermission])

  const disable = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setIsEnabled(false)
  }, [])

  const notify = useCallback(
    (title: string, body: string, options?: NotificationOptions) => {
      if (!isEnabled || permission !== 'granted') return
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
    requestPermission,
    enable,
    disable,
    notify,
  }
}
