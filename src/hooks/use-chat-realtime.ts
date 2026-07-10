'use client'

import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { getSocket, disconnectSocket, getExistingSocket } from '@/lib/socket'
import { useChatStore } from '@/store/chat-store'
import { toast } from 'sonner'
import { decryptMessage, getCachedAesKey, getOrCreateRsaKeyPair, exportPublicKeyB64 } from '@/lib/crypto'

// Use a ref-based guard so StrictMode double-invocation doesn't break us
let activeUserId: string | null = null

export function useChatRealtime() {
  const { data: session, status } = useSession()
  const userId = (session?.user as any)?.id as string | undefined
  const userName = session?.user?.name as string | undefined

  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const typingCleanupRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rsaPublishedRef = useRef(false)

  // Publish RSA public key on first login (for E2E key wrapping)
  useEffect(() => {
    if (!userId || rsaPublishedRef.current) return
    rsaPublishedRef.current = true
    ;(async () => {
      try {
        const pair = await getOrCreateRsaKeyPair(userId)
        const pubB64 = await exportPublicKeyB64(pair.publicKey)
        await fetch('/api/users/key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicKey: pubB64 }),
        })
      } catch (e) {
        console.warn('Failed to publish public key', e)
      }
    })()
  }, [userId])

  // Connect socket when user is available
  useEffect(() => {
    if (status !== 'authenticated' || !userId) return
    // If we already have an active socket for this user, just refresh event handlers
    if (activeUserId === userId && getExistingSocket()) {
      // Already initialized
    } else {
      activeUserId = userId
    }

    let cancelled = false
    let sock: any = null
    ;(async () => {
      sock = await getSocket(userId)
      if (cancelled) return

      // Wire up event handlers WITHOUT removing the socket.ts auto-join handler.
      // We use named wrappers + removeListener so re-renders don't stack handlers.
      const onConnect = () => useChatStore.getState().setSocketConnected(true)
      const onDisconnect = () => useChatStore.getState().setSocketConnected(false)
      const onMessageNew = (msg: any) => {
        const store = useChatStore.getState()
        store.addMessage(msg)
        const isActive = store.activeConversationId === msg.conversationId
        const existing = store.conversations.find((c) => c.id === msg.conversationId)
        if (existing) {
          store.upsertConversation({
            ...existing,
            lastMessage: msg,
            updatedAt: msg.createdAt,
          })
        }
        if (isActive) {
          sock.emit('read:receipt', { conversationId: msg.conversationId, messageId: msg.id })
        }
        // Always show a toast for messages from other users when the conversation
        // is NOT the active one OR the document is hidden (tab in background).
        if (msg.senderId !== userId) {
          const shouldShowToast = !isActive || (typeof document !== 'undefined' && document.visibilityState === 'hidden')
          if (shouldShowToast) {
            toast(`💬 ${msg.sender?.name || 'New message'}`, {
              description: msg.contentType === 'TEXT' && !msg.encrypted ? msg.content : `[${msg.contentType}]`,
              duration: 4000,
            })
          }
          // Push notification (only fires when tab is hidden + push is enabled)
          const pushState = (window as any).__pulsechatPush
          if (pushState?.isEnabled && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            const senderName = msg.sender?.name || 'New message'
            const body = msg.contentType === 'TEXT' && !msg.encrypted
              ? msg.content
              : msg.contentType === 'AUDIO'
              ? '🎤 Voice message'
              : msg.contentType === 'IMAGE'
              ? '📷 Photo'
              : msg.contentType === 'FILE'
              ? '📎 File'
              : `New ${msg.contentType.toLowerCase()} message`
            pushState.notify(`${senderName}`, body, {
              tag: `msg-${msg.conversationId}`,
              data: { url: '/' },
            })
          }
        }
      }
      const onTypingStart = ({ conversationId, userId: otherUserId }: any) => {
        if (otherUserId === userId) return
        useChatStore.getState().setTyping(conversationId, otherUserId)
      }
      const onTypingStop = ({ conversationId, userId: otherUserId }: any) => {
        if (otherUserId === userId) return
        useChatStore.getState().clearTyping(conversationId, otherUserId)
      }
      const onPresenceUpdate = ({ userId: presenceUserId, status }: any) => {
        useChatStore.getState().updatePresence(presenceUserId, status)
      }
      const onMessageDeleted = ({ conversationId, messageId, deletedAt }: any) => {
        useChatStore.getState().deleteMessage(conversationId, messageId)
      }
      const onError = ({ message }: any) => {
        toast.error('Socket error', { description: message })
      }

      sock.on('connect', onConnect)
      sock.on('disconnect', onDisconnect)
      sock.on('message:new', onMessageNew)
      sock.on('message:deleted', onMessageDeleted)
      sock.on('typing:start', onTypingStart)
      sock.on('typing:stop', onTypingStop)
      sock.on('presence:update', onPresenceUpdate)
      sock.on('error', onError)

      // Set initial state (socket may already be connected)
      if (sock.connected) {
        useChatStore.getState().setSocketConnected(true)
      }
    })()

    // Heartbeat every 25s so the server keeps us marked online
    heartbeatRef.current = setInterval(async () => {
      const s = getExistingSocket()
      if (s) s.emit('presence:heartbeat')
    }, 25 * 1000)

    // Typing cleanup: clear stale typing indicators after 4s
    typingCleanupRef.current = setInterval(() => {
      const now = Date.now()
      const typing = useChatStore.getState().typing
      for (const convId of Object.keys(typing)) {
        for (const uid of Object.keys(typing[convId] || {})) {
          if (now - typing[convId][uid] > 4000) {
            useChatStore.getState().clearTyping(convId, uid)
          }
        }
      }
    }, 1000)

    return () => {
      cancelled = true
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
      if (typingCleanupRef.current) clearInterval(typingCleanupRef.current)
      // Note: we DON'T disconnect the socket here, because StrictMode will
      // immediately re-run the effect. The socket is a singleton keyed by userId.
    }
  }, [status, userId])

  return { connected: useChatStore((s) => s.socketConnected), userId, userName }
}

// Decrypt all encrypted messages in a conversation that haven't been decrypted yet.
// Called from the conversation view.
export async function ensureDecrypted(conversationId: string, messages: any[], _currentUserId: string) {
  const aesKey = await getCachedAesKey(conversationId)
  if (!aesKey) return
  const store = useChatStore.getState()
  for (const m of messages) {
    if (m.encrypted && m.contentType === 'TEXT' && !store.decrypted[`${conversationId}:${m.id}`]) {
      try {
        const plaintext = await decryptMessage(aesKey, m.content)
        store.setDecrypted(conversationId, m.id, plaintext)
      } catch (e) {
        // Key mismatch — try to fetch fresh key
        console.warn('decrypt failed', e)
      }
    }
  }
}
