'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Sidebar } from './sidebar'
import { ChatThread } from './chat-thread'
import { useChatRealtime } from '@/hooks/use-chat-realtime'
import { useChatStore } from '@/store/chat-store'
import { usePushNotifications } from '@/hooks/use-push-notifications'
import { Loader2 } from 'lucide-react'

export function ChatApp() {
  const { data: session, status } = useSession()
  // Initialise the socket + presence wiring
  useChatRealtime()
  // Initialise push notifications manager (exposed on window for the realtime hook)
  const push = usePushNotifications()

  const setCurrentUser = useChatStore((s) => s.setCurrentUser)
  const setConversations = useChatStore((s) => s.setConversations)
  const conversations = useChatStore((s) => s.conversations)
  const activeId = useChatStore((s) => s.activeConversationId)
  const storeCurrentUser = useChatStore((s) => s.currentUser)
  const [mobileShowThread, setMobileShowThread] = useState(false)
  const [loadedConvs, setLoadedConvs] = useState(false)

  const userId = (session?.user as any)?.id as string | undefined
  const userName = session?.user?.name as string | undefined

  // Expose push notification manager on window for the realtime hook to use
  useEffect(() => {
    ;(window as any).__pulsechatPush = push
  }, [push])

  // Persist current user to store
  useEffect(() => {
    if (!userId || !userName) return
    // Fetch user details
    fetch('/api/users/me').then(async (r) => {
      if (r.ok) {
        const u = await r.json()
        setCurrentUser({
          id: u.id,
          name: u.name,
          username: u.username,
          avatarColor: u.avatarColor,
          avatarUrl: u.avatarUrl,
          email: u.email,
          bio: u.bio,
        } as any)
      }
    }).catch(() => {})
  }, [userId, userName, setCurrentUser])

  // Load conversations
  useEffect(() => {
    if (status !== 'authenticated') return
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/conversations')
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        setConversations(
          data.conversations.map((c: any) => ({
            ...c,
            unreadCount: 0,
          }))
        )
        setLoadedConvs(true)
      } catch (e) {
        console.error('failed to load conversations', e)
      }
    }
    load()
    // Refresh every 30s as a fallback (the socket handles real-time updates)
    const interval = setInterval(load, 30 * 1000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [status, setConversations])

  // For mobile: when activeId changes, show the thread
  useEffect(() => {
    Promise.resolve().then(() => {
      if (activeId) setMobileShowThread(true)
      else setMobileShowThread(false)
    })
  }, [activeId])

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (status !== 'authenticated' || !userId) {
    return null
  }

  const currentUser = storeCurrentUser
  const sidebarUser = currentUser
    ? {
        id: currentUser.id,
        name: currentUser.name,
        avatarColor: currentUser.avatarColor,
        avatarUrl: currentUser.avatarUrl,
        username: currentUser.username,
        email: currentUser.email,
        bio: currentUser.bio ?? null,
      }
    : { id: userId, name: userName || '', avatarColor: '#10b981', username: '', email: '', bio: null, avatarUrl: null }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <div className={`${mobileShowThread ? 'hidden md:flex' : 'flex'} w-full md:w-auto flex-shrink-0`}>
        <Sidebar currentUser={sidebarUser} />
      </div>
      <div className={`${mobileShowThread ? 'flex' : 'hidden md:flex'} flex-1 min-w-0`}>
        <ChatThread currentUserId={userId} onBack={() => setMobileShowThread(false)} />
      </div>
    </div>
  )
}
