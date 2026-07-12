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

  // Restore showProfanity setting on mount
  const setShowProfanity = useChatStore((s) => s.setShowProfanity)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('bharatchat-show-profanity') === 'true'
      setShowProfanity(stored)
    }
  }, [setShowProfanity])

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
        if (res.ok && !cancelled) {
          const data = await res.json()
          setConversations(data.conversations)
        }
      } catch (e) {
        console.error('load conversations failed', e)
      } finally {
        if (!cancelled) setLoadedConvs(true)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [status, setConversations])

  useEffect(() => {
    if (activeId) setMobileShowThread(true)
  }, [activeId])

  if (status === 'loading' || (status === 'authenticated' && !storeCurrentUser)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground font-medium">Connecting to BharatChat...</p>
        </div>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return null
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="flex-1 flex relative">
        <div className={cn(
          "absolute md:relative inset-0 md:flex flex-shrink-0 z-20 md:z-auto transition-transform duration-300",
          mobileShowThread ? "-translate-x-full md:translate-x-0" : "translate-x-0"
        )}>
          <Sidebar currentUser={storeCurrentUser as any} />
        </div>
        <div className={cn(
          "absolute md:relative inset-0 md:flex flex-1 z-10 md:z-auto transition-transform duration-300",
          mobileShowThread ? "translate-x-0" : "translate-x-full md:translate-x-0"
        )}>
          <ChatThread
            currentUserId={userId!}
            onBack={() => setMobileShowThread(false)}
          />
        </div>
      </div>
    </div>
  )
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ')
}
