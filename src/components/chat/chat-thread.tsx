'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useChatStore } from '@/store/chat-store'
import { Avatar } from './avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageSquare, Users, Lock, Send, Paperclip, ArrowLeft, ShieldCheck, Flag, Trash2, Mic, X, Download, FileText, Flame, Check, Timer, Loader2, AlertCircle } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getSocket } from '@/lib/socket'
import { format, isSameDay } from 'date-fns'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { VoiceRecorder } from './voice-recorder'
import {
  ensureDecrypted,
  useChatRealtime,
} from '@/hooks/use-chat-realtime'
import {
  generateAesKey,
  exportAesKeyB64,
  importAesKeyB64,
  encryptMessage,
  decryptMessage,
  encryptBinary,
  decryptBinary,
  decryptBinaryWithFallback,
  getCachedAesKey,
  cacheAesKey,
  getOrEstablishConversationAesKey,
} from '@/lib/crypto'
import { moderateMessage } from '@/lib/moderation'

// Module-level clock skew compensation (serverTime - Date.now())
let clientServerTimeOffset = 0

export function setClientServerTimeOffset(serverTime: number) {
  if (typeof serverTime === 'number' && !isNaN(serverTime)) {
    clientServerTimeOffset = serverTime - Date.now()
  }
}

const BURN_DURATIONS = [
  { label: 'Off', value: null, description: 'Standard permanent message' },
  { label: '10s', value: 10, description: 'Ultra-fast burn (ideal for OTPs)' },
  { label: '30s', value: 30, description: 'Quick burn (recommended for passwords)' },
  { label: '1 min', value: 60, description: '1 minute temporary note' },
  { label: '5 min', value: 300, description: '5 minutes confidential text' },
] as const

interface ChatThreadProps {
  currentUserId: string
  onBack?: () => void
}

export function ChatThread({ currentUserId, onBack }: ChatThreadProps) {
  const activeId = useChatStore((s) => s.activeConversationId)
  const conversations = useChatStore((s) => s.conversations)
  const messagesByConv = useChatStore((s) => s.messagesByConversation)
  const presence = useChatStore((s) => s.presence)
  const typing = useChatStore((s) => s.typing)
  const decrypted = useChatStore((s) => s.decrypted)
  const addMessage = useChatStore((s) => s.addMessage)
  const setDecrypted = useChatStore((s) => s.setDecrypted)
  const setActive = useChatStore((s) => s.setActiveConversation)
  const updateLastRead = useChatStore((s) => s.updateLastRead)
  const deleteMessageStore = useChatStore((s) => s.deleteMessage)
  const searchTargetMessageId = useChatStore((s) => s.searchTargetMessageId)
  const setSearchTargetMessageId = useChatStore((s) => s.setSearchTargetMessageId)

  const conv = conversations.find((c) => c.id === activeId)
  const messages = activeId ? messagesByConv[activeId] || [] : []
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [initialLoading, setInitialLoading] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string; messageId?: string; isMe?: boolean } | null>(null)
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'recorded' | 'uploading'>('idle')
  const [burnDuration, setBurnDuration] = useState<number | null>(null)
  const [isBurnPopoverOpen, setIsBurnPopoverOpen] = useState(false)
  const isVoiceActive = voiceState !== 'idle'

  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevMsgCountRef = useRef(0)
  const atBottomRef = useRef(true)
  const prevActiveIdRef = useRef<string | null>(null)
  const e2eEnabled = useRef(true) // for demo, all new chats are encrypted

  const loadMessages = useCallback(
    async (convId: string, cursor: string | null, replace: boolean) => {
      try {
        const url = `/api/conversations/${convId}/messages?limit=50${cursor ? `&cursor=${cursor}` : ''}`
        const res = await fetch(url)
        if (!res.ok) return
        const data = await res.json()
        if (data.serverTime) {
          setClientServerTimeOffset(data.serverTime)
        }
        const msgs = data.messages.reverse()
        if (replace) {
          useChatStore.getState().setMessages(convId, msgs)
          // Mark as read
          updateLastRead(convId)
          ensureDecrypted(convId, msgs, currentUserId).catch(() => {})
        } else {
          useChatStore.getState().prependMessages(convId, msgs)
          ensureDecrypted(convId, msgs, currentUserId).catch(() => {})
        }
        setCursor(data.nextCursor)
        setHasMore(!!data.nextCursor)
      } catch (e) {
        console.error('failed to load messages', e)
      } finally {
        setInitialLoading(false)
      }
    },
    [updateLastRead, currentUserId]
  )

  async function initConversationKey(convId: string) {
    await getOrEstablishConversationAesKey(convId, currentUserId)
    // Decrypt any pending cached messages immediately
    await ensureDecrypted(convId, useChatStore.getState().messagesByConversation[convId] || [], currentUserId)
  }

  // Load messages when conversation changes
  useEffect(() => {
    if (!activeId) return
    const hasCached = (useChatStore.getState().messagesByConversation[activeId] || []).length > 0
    if (!hasCached) {
      setInitialLoading(true)
    } else {
      setInitialLoading(false)
    }

    Promise.resolve().then(() => {
      setCursor(null)
      setHasMore(true)
      initConversationKey(activeId)
      loadMessages(activeId, null, true)
    })
  }, [activeId, loadMessages])

  // Auto-scroll to bottom when new messages arrive (if user is at bottom)
  useEffect(() => {
    if (!scrollRef.current) return
    
    // Check if the conversation ID has changed since the last render
    const isNewConv = activeId !== prevActiveIdRef.current
    prevActiveIdRef.current = activeId

    if (isNewConv) {
      // If we switched conversations, we should scroll to bottom ONLY if we don't have a search target
      if (searchTargetMessageId) {
        atBottomRef.current = false
      } else {
        atBottomRef.current = true
        const el = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
        if (el) el.scrollTop = el.scrollHeight
      }
      prevMsgCountRef.current = messages.length
      return
    }

    // If it's the same conversation, use normal auto-scroll logic
    const wasNewMessage = messages.length - prevMsgCountRef.current === 1
    const targetMsgId = useChatStore.getState().searchTargetMessageId

    if (!targetMsgId && (atBottomRef.current || wasNewMessage)) {
      const el = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
      if (el) el.scrollTop = el.scrollHeight
    }
    prevMsgCountRef.current = messages.length
  }, [messages, activeId, searchTargetMessageId])

  // Scroll to search target message when selected
  useEffect(() => {
    if (!searchTargetMessageId || messages.length === 0) return

    // Find the message element in the DOM
    const targetEl = document.getElementById(`msg-${searchTargetMessageId}`)
    if (targetEl) {
      // Scroll the target element into view smoothly and center it
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })

      // Highlight the target bubble
      const bubble = targetEl.querySelector('.rounded-2xl') as HTMLElement
      if (bubble) {
        bubble.classList.add('ring-4', 'ring-primary/50', 'bg-primary/10', 'animate-pulse')
        setTimeout(() => {
          bubble.classList.remove('ring-4', 'ring-primary/50', 'bg-primary/10', 'animate-pulse')
        }, 2200)
      }

      // Reset the target ID in the store
      setSearchTargetMessageId(null)
    }
  }, [searchTargetMessageId, messages, setSearchTargetMessageId])

  // Try to decrypt new encrypted messages as they arrive
  useEffect(() => {
    if (!activeId) return
    ensureDecrypted(activeId, messages, currentUserId)
  }, [messages, activeId, decrypted])

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (el.scrollTop < 50 && hasMore && !loadingMore) {
      setLoadingMore(true)
      loadMessages(activeId!, cursor, false).finally(() => setLoadingMore(false))
    }
  }

  async function handleSend() {
    if (!input.trim() || !activeId || !conv) return
    const plaintext = input.trim()
    setInput('')
    setSending(true)

    // Moderation (client-side preview; server-side also runs)
    const mod = moderateMessage(plaintext)
    const finalText = mod.cleaned || plaintext
    if (mod.status === 'BLOCKED') {
      toast.error('Message blocked', { description: mod.reason })
      setSending(false)
      return
    }
    if (mod.status === 'FLAGGED') {
      toast.warning('Profanity filtered', { description: mod.reason })
    }

    // Encrypt if E2E is on
    let contentToSend = plaintext
    let encrypted = false
    if (e2eEnabled.current) {
      let key = await getCachedAesKey(activeId)
      if (!key) {
        key = await getOrEstablishConversationAesKey(activeId, currentUserId)
      }
      if (key) {
        contentToSend = await encryptMessage(key, plaintext)
        encrypted = true
      }
    }

    const burnMeta = burnDuration ? { burnAfterSeconds: burnDuration } : null
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const tempMsg: any = {
      id: tempId,
      conversationId: activeId,
      senderId: currentUserId,
      sender: {
        id: currentUserId,
        name: useChatStore.getState().currentUser?.name || 'You',
        username: useChatStore.getState().currentUser?.username || '',
        avatarColor: useChatStore.getState().currentUser?.avatarColor || '#10b981',
      },
      content: contentToSend,
      contentType: 'TEXT',
      encrypted,
      attachment: burnMeta,
      moderation: mod.status,
      createdAt: new Date().toISOString(),
      tempId,
    }
    addMessage(tempMsg)
    if (encrypted) setDecrypted(activeId, tempId, plaintext)

    try {
      const sock = await getSocket(currentUserId)
      sock.emit('message:send', {
        conversationId: activeId,
        content: contentToSend,
        contentType: 'TEXT',
        encrypted,
        attachment: burnMeta,
        tempId,
      })
    } catch (e) {
      toast.error('Failed to send message')
    }
    setSending(false)
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeId) return
    if (file.size > 4.5 * 1024 * 1024) {
      toast.error('File too large', { description: 'Maximum upload size is 4.5MB' })
      return
    }
    e.target.value = ''
    setUploading(true)
    try {
      const rawBytes = await file.arrayBuffer()
      let fileToSend: Blob = file
      let isFileEncrypted = false

      if (e2eEnabled.current) {
        const key = await getOrEstablishConversationAesKey(activeId, currentUserId)
        if (key) {
          const encryptedBuffer = await encryptBinary(key, rawBytes)
          fileToSend = new Blob([encryptedBuffer], { type: 'application/octet-stream' })
          isFileEncrypted = true
        }
      }

      const fd = new FormData()
      fd.append('file', fileToSend, file.name)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        toast.error('Upload failed', { description: data.error })
        return
      }

      // Pre-seed local cache with the plaintext file object URL so the sender has instant 0ms preview without "decrypting..."
      try {
        const localUrl = URL.createObjectURL(file)
        decryptedAttachmentCache.set(data.url, localUrl)
      } catch {}

      const attachmentData = {
        ...data,
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        encrypted: isFileEncrypted,
        ...(burnDuration ? { burnAfterSeconds: burnDuration } : {}),
      }
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const tempMsg: any = {
        id: tempId,
        conversationId: activeId,
        senderId: currentUserId,
        sender: {
          id: currentUserId,
          name: useChatStore.getState().currentUser?.name || 'You',
          username: useChatStore.getState().currentUser?.username || '',
          avatarColor: useChatStore.getState().currentUser?.avatarColor || '#10b981',
        },
        content: data.name,
        contentType: data.contentType,
        encrypted: false,
        moderation: 'APPROVED',
        attachment: attachmentData,
        createdAt: new Date().toISOString(),
        tempId,
      }
      addMessage(tempMsg)
      const sock = await getSocket(currentUserId)
      sock.emit('message:send', {
        conversationId: activeId,
        content: data.name,
        contentType: data.contentType,
        encrypted: false,
        attachment: attachmentData,
        tempId,
      })
      if (isFileEncrypted) {
        sock.emit('conversation:keys_updated', { conversationId: activeId })
      }
      toast.success(isFileEncrypted ? 'Encrypted file shared' : 'File shared')
    } catch (e) {
      toast.error('Upload failed')
    }
    setUploading(false)
  }

  // Encrypt and upload voice notes client-side
  async function handleUploadVoice(blob: Blob, filename: string) {
    if (!activeId) return null
    try {
      const rawBytes = await blob.arrayBuffer()
      let blobToSend: Blob = blob
      let isEncrypted = false

      if (e2eEnabled.current) {
        const key = await getOrEstablishConversationAesKey(activeId, currentUserId)
        if (key) {
          const enc = await encryptBinary(key, rawBytes)
          blobToSend = new Blob([enc], { type: 'application/octet-stream' })
          isEncrypted = true
        }
      }

      const fd = new FormData()
      fd.append('file', blobToSend, filename)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) return null
      if (isEncrypted) {
        try {
          const localUrl = URL.createObjectURL(blob)
          decryptedAttachmentCache.set(data.url, localUrl)
        } catch {}
      }
      return { url: data.url, encrypted: isEncrypted, size: blob.size }
    } catch {
      return null
    }
  }

  // Send a voice message (already encrypted & uploaded by the VoiceRecorder component)
  async function handleSendVoice(attachment: any) {
    if (!activeId) return
    const attachmentData = burnDuration ? { ...attachment, burnAfterSeconds: burnDuration } : attachment
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const tempMsg: any = {
      id: tempId,
      conversationId: activeId,
      senderId: currentUserId,
      sender: {
        id: currentUserId,
        name: useChatStore.getState().currentUser?.name || 'You',
        username: useChatStore.getState().currentUser?.username || '',
        avatarColor: useChatStore.getState().currentUser?.avatarColor || '#10b981',
      },
      content: attachment.name,
      contentType: 'AUDIO',
      encrypted: false,
      moderation: 'APPROVED',
      attachment: attachmentData,
      createdAt: new Date().toISOString(),
      tempId,
    }
    addMessage(tempMsg)
    try {
      const sock = await getSocket(currentUserId)
      sock.emit('message:send', {
        conversationId: activeId,
        content: attachment.name,
        contentType: 'AUDIO',
        encrypted: false,
        attachment: attachmentData,
        tempId,
      })
      if (attachment.encrypted) {
        sock.emit('conversation:keys_updated', { conversationId: activeId })
      }
    } catch (e) {
      toast.error('Failed to send voice message')
    }
  }

  // Delete a message (sender or self-destruct expire). Soft-delete via socket + REST fallback.
  async function handleDeleteMessage(messageId: string, silent = false) {
    if (!activeId) return
    const prevMessages = useChatStore.getState().messagesByConversation[activeId] || []
    const msg = prevMessages.find((m) => m.id === messageId)
    if (!msg) return
    if (!silent && msg.senderId !== currentUserId) {
      toast.error('You can only delete your own messages')
      return
    }

    // Clean up cached blob URL if any
    if (msg.attachment?.url && decryptedAttachmentCache.has(msg.attachment.url)) {
      const blobUrl = decryptedAttachmentCache.get(msg.attachment.url)
      if (blobUrl && blobUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(blobUrl) } catch {}
      }
      decryptedAttachmentCache.delete(msg.attachment.url)
    }

    const wasBurn = Boolean((msg as any).wasBurn || msg.attachment?.burnAfterSeconds)

    // Optimistic update with RAM wipe and wasBurn
    deleteMessageStore(activeId, messageId, wasBurn)
    try {
      // Emit to socket for real-time broadcast
      const sock = await getSocket(currentUserId)
      sock.emit('message:delete', { conversationId: activeId, messageId })
      // Also hit REST as a fallback (in case socket isn't connected)
      fetch(`/api/messages/${messageId}`, { method: 'DELETE' }).catch(() => {})
      if (!silent) toast.success('Message deleted')
    } catch (e) {
      if (!silent) toast.error('Failed to delete message')
    }
  }

  // Typing indicator emit (debounced via ref)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  async function handleTyping() {
    if (!activeId) return
    const sock = await getSocket(currentUserId)
    sock.emit('typing:start', { conversationId: activeId })
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(async () => {
      const s = await getSocket(currentUserId)
      s.emit('typing:stop', { conversationId: activeId! })
    }, 1500)
  }

  if (!activeId || !conv) {
    return (
      <main className="flex-1 flex items-center justify-center bg-background bg-mesh relative overflow-hidden">
        <div className="absolute inset-0 jaali-watermark pointer-events-none" aria-hidden="true" />
        <div className="text-center max-w-md p-8 relative z-10">
          <img
            src="/icon-192.png"
            alt="BharatChat"
            className="h-16 w-16 rounded-2xl object-cover mx-auto mb-4 shadow-lg border border-primary/20"
          />
          <h2 className="text-xl font-semibold text-foreground mb-1">Welcome to BharatChat</h2>
          <p className="text-sm text-muted-foreground">
            Select a conversation to start messaging, or create a new one. All messages are
            end-to-end encrypted and delivered in real-time via WebSockets.
          </p>
        </div>
      </main>
    )
  }

  const otherMembers = conv.members.filter((m) => m.id !== currentUserId)
  const isGroup = conv.type === 'GROUP'
  const onlineCount = isGroup
    ? conv.members.filter((m) => m.id !== currentUserId && presence[m.id] === 'online').length
    : 0
  const otherUser = otherMembers[0]
  const otherPresence = otherUser ? presence[otherUser.id] : undefined
  const isOtherOnline = otherPresence === 'online'
  const isOtherAway = otherPresence === 'away'

  const typingUsers = activeId ? Object.keys(typing[activeId] || {}).filter((uid) => uid !== currentUserId) : []
  const typingNames = typingUsers
    .map((uid) => conv.members.find((m) => m.id === uid)?.name?.split(' ')[0])
    .filter(Boolean)

  return (
    <main className="flex-1 flex flex-col h-full bg-background/40 bg-mesh min-w-0 relative">
      <div className="absolute inset-0 jaali-watermark pointer-events-none" aria-hidden="true" />
      {/* Header */}
      <header className="flex items-center gap-3 p-3.5 border-b border-border/40 bg-card/85 backdrop-blur-md relative z-20">
        {onBack && (
          <Button variant="ghost" size="icon" className="md:hidden flex-shrink-0 rounded-xl" onClick={onBack}>
            <ArrowLeft className="h-4.5 w-4.5" />
          </Button>
        )}
        <Avatar
          name={conv.name}
          color={conv.avatarColor}
          size="md"
          showStatus={!isGroup}
          online={!isGroup ? isOtherOnline : undefined}
          src={!isGroup ? otherUser?.avatarUrl : undefined}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="font-semibold text-foreground truncate text-sm sm:text-base">{conv.name}</h2>
            <Lock className="h-3 w-3 text-accent-foreground flex-shrink-0" />
          </div>
          <p className="text-[10px] sm:text-xs text-muted-foreground/80 truncate">
            {isGroup ? (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {conv.members.length} members · {onlineCount} online
              </span>
            ) : (
              <>
                <span className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full mr-1",
                  isOtherOnline ? "bg-emerald-500 animate-pulse" : isOtherAway ? "bg-amber-500" : "bg-muted-foreground/40"
                )} />
                {isOtherOnline ? 'Active now' : isOtherAway ? 'Away' : 'Offline'}
                {!isOtherOnline && otherUser?.lastSeenAt && (
                  <span className="ml-1 text-[9px] sm:text-[10px] text-muted-foreground/60">
                    · Last seen {format(new Date(otherUser.lastSeenAt), 'MMM d, HH:mm')}
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-bold text-accent-foreground bg-accent border border-accent-foreground/15 px-2.5 py-1 rounded-full">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>E2E encrypted</span>
        </div>
      </header>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef} onScroll={handleScroll}>
        <div className="p-4 space-y-1">
          {loadingMore && (
            <div className="text-center py-2">
              <span className="text-xs text-muted-foreground">Loading older messages...</span>
            </div>
          )}
          {initialLoading && messages.length === 0 ? (
            <div className="p-4 space-y-4 animate-pulse">
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-full bg-muted/70 flex-shrink-0" />
                <div className="space-y-1.5 max-w-[65%]">
                  <div className="h-3 w-16 bg-muted/60 rounded" />
                  <div className="h-9 w-44 bg-muted/70 rounded-2xl rounded-tl-none" />
                </div>
              </div>
              <div className="flex items-end justify-end gap-2.5">
                <div className="h-10 w-52 bg-primary/20 rounded-2xl rounded-tr-none" />
              </div>
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-full bg-muted/70 flex-shrink-0" />
                <div className="space-y-1.5 max-w-[65%]">
                  <div className="h-3 w-20 bg-muted/60 rounded" />
                  <div className="h-14 w-60 bg-muted/70 rounded-2xl rounded-tl-none" />
                </div>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12">
              <div className="h-14 w-14 rounded-2xl bg-accent/40 mx-auto flex items-center justify-center mb-3 border border-accent-foreground/15">
                <MessageSquare className="h-7 w-7 text-accent-foreground/80" />
              </div>
              <p className="text-sm text-muted-foreground">No messages yet — say hello!</p>
            </div>
          ) : (
            <MessageList
              messages={messages}
              currentUserId={currentUserId}
              decrypted={decrypted}
              conversationId={activeId}
              onDeleteMessage={handleDeleteMessage}
              onPreviewImage={setPreviewImage}
            />
          )}
        </div>
      </ScrollArea>

      {/* Typing Indicator */}
      {typingNames.length > 0 && (
        <div className="px-6 py-1.5 text-xs text-muted-foreground flex items-center gap-2 animate-fade-in z-10">
          <span className="flex gap-1">
            <span className="h-1.5 w-1.5 bg-muted-foreground/60 rounded-full typing-dot" />
            <span className="h-1.5 w-1.5 bg-muted-foreground/60 rounded-full typing-dot" style={{ animationDelay: '150ms' }} />
            <span className="h-1.5 w-1.5 bg-muted-foreground/60 rounded-full typing-dot" style={{ animationDelay: '300ms' }} />
          </span>
          <span className="font-medium">
            {typingNames.length === 1
              ? `${typingNames[0]} is typing...`
              : `${typingNames.slice(0, 2).join(', ')} are typing...`}
          </span>
        </div>
      )}

      {/* Composer */}
      <footer className="p-3 sm:p-4 bg-transparent z-10">
        {burnDuration && !isVoiceActive && (
          <div className="max-w-4xl mx-auto mb-2 px-3.5 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-between text-amber-600 dark:text-amber-400 text-xs animate-in fade-in slide-in-from-bottom-1">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 fill-amber-500/30 text-amber-500 animate-pulse flex-shrink-0" />
              <span className="font-semibold">
                Burn-After-Reading active:
              </span>
              <span className="text-[11px] text-muted-foreground">
                Next message auto-deletes in {burnDuration < 60 ? `${burnDuration}s` : `${burnDuration / 60}m`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setBurnDuration(null)}
              className="text-[11px] font-semibold hover:text-foreground p-0.5 rounded transition-colors cursor-pointer flex items-center gap-1 text-muted-foreground hover:text-destructive"
              title="Turn off burn-after-reading"
            >
              <X className="h-3.5 w-3.5" />
              <span>Turn off</span>
            </button>
          </div>
        )}

        <div className="max-w-4xl mx-auto flex items-center gap-2 p-2 rounded-2xl bg-card/75 border border-border/40 shadow-lift glass relative">
          {!isVoiceActive && (
            <>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                className="hidden"
                accept="image/*,application/pdf,text/plain,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.mp4,.webm,.mp3,.wav"
              />
              <Button
                variant="outline"
                size="icon"
                type="button"
                className="flex-shrink-0 h-9.5 w-9.5 rounded-xl border-border/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-all duration-150 bg-transparent shadow-none cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || sending}
                title="Attach file"
              >
                <Paperclip className="h-4.5 w-4.5" />
              </Button>

              <Popover open={isBurnPopoverOpen} onOpenChange={setIsBurnPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    className={cn(
                      "flex-shrink-0 h-9.5 w-9.5 rounded-xl border transition-all duration-150 cursor-pointer relative",
                      burnDuration
                        ? "bg-amber-500/20 border-amber-500/50 text-amber-500 shadow-sm"
                        : "border-border/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground bg-transparent shadow-none"
                    )}
                    title={burnDuration ? `Burn-after-reading: ${burnDuration}s` : "Set burn-after-reading / self-destruct timer"}
                  >
                    <Flame className={cn("h-4.5 w-4.5", burnDuration && "text-amber-500 fill-amber-500/30 animate-pulse")} />
                    {burnDuration && (
                      <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-extrabold text-black shadow-xs">
                        {burnDuration < 60 ? `${burnDuration}` : `${burnDuration / 60}m`}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" side="top" sideOffset={10} className="w-64 p-2.5 rounded-2xl bg-card border border-border/70 shadow-xl backdrop-blur-xl z-50">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 pb-2 border-b border-border/40">
                      <div className="h-7 w-7 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-500">
                        <Flame className="h-4 w-4 fill-amber-500/30" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-foreground">Burn-After-Reading</h4>
                        <p className="text-[10px] text-muted-foreground">Auto-delete passwords & OTPs</p>
                      </div>
                    </div>
                    <div className="grid gap-1">
                      {BURN_DURATIONS.map((opt) => {
                        const isSelected = burnDuration === opt.value
                        return (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() => {
                              setBurnDuration(opt.value)
                              setIsBurnPopoverOpen(false)
                              if (opt.value) {
                                toast.info(`Self-destruct timer set to ${opt.label}`, {
                                  description: 'Next message will auto-delete after this duration.',
                                })
                              }
                            }}
                            className={cn(
                              'flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors cursor-pointer',
                              isSelected
                                ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 font-medium'
                                : 'hover:bg-muted/60 text-foreground'
                            )}
                          >
                            <div>
                              <span className="font-semibold text-xs block">{opt.label}</span>
                              <span className="text-[10px] text-muted-foreground block">{opt.description}</span>
                            </div>
                            {isSelected && <Check className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 ml-2" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </>
          )}

          <VoiceRecorder
            onSend={handleSendVoice}
            disabled={sending || uploading}
            onStateChange={setVoiceState}
            onUploadVoice={handleUploadVoice}
          />

          {!isVoiceActive && (
            <>
              <Input
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  handleTyping()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder={uploading ? 'Uploading...' : 'Type a message...'}
                disabled={sending || uploading}
                className="flex-1 bg-transparent border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 px-2 min-h-[38px] placeholder:text-muted-foreground/60 text-sm"
              />
              <Button
                type="button"
                onClick={handleSend}
                disabled={sending || !input.trim()}
                className="bg-primary hover:bg-[#C87D12] text-primary-foreground font-semibold rounded-xl h-9.5 w-9.5 p-0 flex-shrink-0 transition-transform active:scale-95 shadow-md shadow-primary/10 cursor-pointer"
                size="icon"
              >
                <Send className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/75 mt-2 text-center tracking-wide">
          All messages are end-to-end encrypted. Tap 🔥 for self-destruct, 🎤 for voice.
        </p>
      </footer>

      {/* In-app Image Lightbox Modal */}
      {previewImage && (
        <LightboxModal
          previewImage={previewImage}
          onClose={() => setPreviewImage(null)}
          onDeleteMessage={handleDeleteMessage}
        />
      )}
    </main>
  )
}

function MessageList({
  messages,
  currentUserId,
  decrypted,
  conversationId,
  onDeleteMessage,
  onPreviewImage,
}: {
  messages: any[]
  currentUserId: string
  decrypted: Record<string, string>
  conversationId: string
  onDeleteMessage: (messageId: string, silent?: boolean) => void
  onPreviewImage?: (attachment: { url: string; name: string; messageId?: string; isMe?: boolean }) => void
}) {
  return (
    <>
      {messages.map((m, i) => {
        const isMe = m.senderId === currentUserId
        const dateLabel = format(new Date(m.createdAt), 'yyyy-MM-dd')
        const prevMsg = messages[i - 1]
        const showDate = !prevMsg || format(new Date(prevMsg.createdAt), 'yyyy-MM-dd') !== dateLabel
        const showSender = !isMe && (!prevMsg || prevMsg.senderId !== m.senderId || showDate)
        const showAvatar = !isMe && (!prevMsg || prevMsg.senderId !== m.senderId)

        const displayContent = m.encrypted
          ? decrypted[`${conversationId}:${m.id}`] || (m.tempId ? decrypted[`${conversationId}:${m.tempId}`] : undefined) || 'Decrypting...'
          : m.content

        return (
          <div key={m.id} id={`msg-${m.id}`} className="animate-message-in">
            {showDate && (
              <div className="flex items-center gap-4 my-4 relative" aria-label={format(new Date(m.createdAt), 'MMMM d, yyyy')}>
                <div className="flex-1 jaali-line" aria-hidden="true" />
                <span className="text-[11px] font-semibold text-muted-foreground bg-background/80 backdrop-blur-sm px-3 py-0.5 rounded-md relative z-10">
                  {format(new Date(m.createdAt), 'MMMM d, yyyy')}
                </span>
                <div className="flex-1 jaali-line" aria-hidden="true" />
              </div>
            )}
            <MessageBubble
              message={m}
              isMe={isMe}
              conversationId={conversationId}
              currentUserId={currentUserId}
              displayContent={displayContent}
              showSender={showSender}
              showAvatar={showAvatar}
              onDeleteMessage={onDeleteMessage}
              onPreviewImage={onPreviewImage}
            />
          </div>
        )
      })}
    </>
  )
}

function MessageBubble({
  message,
  isMe,
  conversationId,
  currentUserId,
  displayContent,
  showSender,
  showAvatar,
  onDeleteMessage,
  onPreviewImage,
}: {
  message: any
  isMe: boolean
  conversationId: string
  currentUserId: string
  displayContent: string
  showSender: boolean
  showAvatar: boolean
  onDeleteMessage: (messageId: string, silent?: boolean) => void
  onPreviewImage?: (attachment: { url: string; name: string; messageId?: string; isMe?: boolean }) => void
}) {
  const showProfanity = useChatStore((s) => s.showProfanity)
  const [showActions, setShowActions] = useState(false)
  const isFlagged = message.moderation === 'FLAGGED'
  const isBlocked = message.moderation === 'BLOCKED'
  const isDeleted = !!message.deletedAt

  let textToRender = displayContent
  if (!showProfanity && displayContent && displayContent !== 'Decrypting...') {
    const mod = moderateMessage(displayContent)
    if (mod.cleaned) {
      textToRender = mod.cleaned
    }
  }

  if (message.contentType === 'SYSTEM') {
    return (
      <div className="text-center my-2">
        <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    )
  }

  // Deleted message placeholder
  if (isDeleted) {
    const wasBurn = Boolean((message as any).wasBurn || message.attachment?.burnAfterSeconds)
    return (
      <div
        className={cn(
          'flex items-end gap-2 px-1 py-0.5',
          isMe ? 'flex-row-reverse' : 'flex-row'
        )}
      >
        {!isMe && <div className="w-8 flex-shrink-0" />}
        <div className={cn('max-w-[75%] sm:max-w-[60%] flex flex-col', isMe ? 'items-end' : 'items-start')}>
          <div className="px-3 py-2 rounded-2xl bg-muted/60 text-muted-foreground italic text-xs sm:text-sm border border-dashed border-border rounded-br-sm flex items-center gap-1.5">
            {wasBurn ? (
              <>
                <Flame className="h-3.5 w-3.5 text-amber-500/70 flex-shrink-0" />
                <span>This message self-destructed</span>
              </>
            ) : (
              <span>🚫 This message was deleted</span>
            )}
          </div>
          <span className={cn('text-[10px] text-muted-foreground mt-0.5', isMe ? 'mr-1' : 'ml-1')}>
            {format(new Date(message.createdAt), 'HH:mm')}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'group relative flex items-end gap-2 px-1 py-0.5',
        isMe ? 'flex-row-reverse' : 'flex-row'
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {!isMe && (
        <div className="w-8 flex-shrink-0">
          {showAvatar && (
            <Avatar
              name={message.sender?.name || ''}
              color={message.sender?.avatarColor}
              size="sm"
              src={message.sender?.avatarUrl}
            />
          )}
        </div>
      )}
      <div className={cn('max-w-[80%] sm:max-w-[65%] flex flex-col', isMe ? 'items-end' : 'items-start')}>
        {showSender && !isMe && (
          <span className="text-[10px] font-semibold text-muted-foreground/80 mb-0.5 ml-1.5">{message.sender?.name}</span>
        )}
        <div className="relative flex items-center gap-1.5">
          {/* Delete action button for sender (left of bubble if isMe, accessible via hover on desktop or tap on phone) */}
          {isMe && (
            <div
              className={cn(
                'transition-all duration-150 flex-shrink-0',
                showActions
                  ? 'opacity-100 pointer-events-auto scale-100'
                  : 'opacity-0 pointer-events-none scale-95 md:group-hover:opacity-100 md:group-hover:pointer-events-auto md:group-hover:scale-100'
              )}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteMessage(message.id)
                }}
                className="p-1.5 rounded-lg bg-popover text-muted-foreground hover:text-destructive hover:bg-destructive/10 shadow-xs border border-border/50 transition-colors cursor-pointer"
                title="Delete message"
                aria-label="Delete message"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div
            onClick={() => isMe && setShowActions((v) => !v)}
            className={cn(
              'px-3.5 py-2.5 rounded-2xl break-words shadow-md leading-relaxed text-sm transition-all',
              isMe
                ? 'bg-primary text-primary-foreground rounded-tr-none shadow-primary/5 cursor-pointer active:brightness-95'
                : 'bg-card text-card-foreground border border-border/30 rounded-tl-none shadow-sm',
              isFlagged && !isMe && 'ring-1 ring-amber-400/50',
              isBlocked && 'opacity-60 italic'
            )}
          >
            {message.attachment?.burnAfterSeconds && (
              <BurnCountdownBadge
                burnAfterSeconds={message.attachment.burnAfterSeconds}
                createdAt={message.createdAt}
                isMe={isMe}
                onExpire={() => onDeleteMessage(message.id, true)}
              />
            )}

            {message.attachment && (message.attachment.url || message.attachment.contentType === 'IMAGE' || message.attachment.contentType === 'AUDIO' || message.attachment.contentType === 'VIDEO' || message.attachment.mimeType) ? (
              <AttachmentView
                attachment={message.attachment}
                isMe={isMe}
                conversationId={conversationId}
                currentUserId={currentUserId}
                messageId={message.id}
                onDeleteMessage={onDeleteMessage}
                onPreviewImage={onPreviewImage}
              />
            ) : null}

            {message.contentType === 'TEXT' ? (
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{textToRender}</p>
            ) : null}
          </div>
        </div>
        <span className={cn('text-[10px] text-muted-foreground mt-0.5', isMe ? 'mr-1' : 'ml-1')}>
          {format(new Date(message.createdAt), 'HH:mm')}
          {isFlagged && <span className="ml-1 text-amber-600">· filtered</span>}
        </span>
      </div>
    </div>
  )
}

function BurnCountdownBadge({
  burnAfterSeconds,
  createdAt,
  onExpire,
  isMe,
}: {
  burnAfterSeconds: number
  createdAt: string
  onExpire: () => void
  isMe: boolean
}) {
  const computeRemaining = useCallback(() => {
    // Incorporate server clock offset to protect against skewed local clocks
    const now = Date.now() + clientServerTimeOffset
    const created = new Date(createdAt).getTime()
    const elapsed = Math.max(0, Math.floor((now - created) / 1000))
    return Math.max(0, burnAfterSeconds - elapsed)
  }, [burnAfterSeconds, createdAt])

  const [timeLeft, setTimeLeft] = useState<number>(computeRemaining)

  useEffect(() => {
    const initialRemaining = computeRemaining()
    setTimeLeft(initialRemaining)

    if (initialRemaining <= 0) {
      onExpire()
      return
    }

    const interval = setInterval(() => {
      const remaining = computeRemaining()
      setTimeLeft(remaining)
      if (remaining <= 0) {
        clearInterval(interval)
        onExpire()
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [computeRemaining, onExpire])

  const isUrgent = timeLeft <= 5

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold tracking-wide border mb-1.5 transition-all select-none',
        isUrgent
          ? 'bg-rose-500/25 text-rose-100 border-rose-500/50 animate-pulse'
          : isMe
            ? 'bg-primary-foreground/20 text-primary-foreground border-primary-foreground/30'
            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
      )}
      title={`Self-destructs in ${timeLeft}s`}
    >
      <Flame className={cn('h-3.5 w-3.5 flex-shrink-0', isUrgent ? 'text-rose-300 animate-bounce' : 'text-amber-500 fill-amber-500/30')} />
      <span>Self-destructs in {timeLeft}s</span>
    </div>
  )
}

const decryptedAttachmentCache = new Map<string, string>()

function useDecryptedAttachment(attachment: any, conversationId: string, currentUserId: string) {
  const [url, setUrl] = useState<string>(() => {
    if (!attachment?.url) return ''
    if (!attachment.encrypted) return attachment.url
    return decryptedAttachmentCache.get(attachment.url) || ''
  })
  const [loading, setLoading] = useState<boolean>(() => {
    if (!attachment?.url) return false
    if (!attachment.encrypted) return false
    return !decryptedAttachmentCache.has(attachment.url)
  })
  const [isExpired, setIsExpired] = useState<boolean>(false)
  const [decryptionError, setDecryptionError] = useState<boolean>(false)
  const [retryCount, setRetryCount] = useState<number>(0)

  const retry = useCallback(() => {
    setRetryCount((c) => c + 1)
  }, [])

  useEffect(() => {
    if (!attachment?.url) return
    if (!attachment.encrypted) {
      setUrl(attachment.url)
      setLoading(false)
      setIsExpired(false)
      setDecryptionError(false)
      return
    }

    if (decryptedAttachmentCache.has(attachment.url)) {
      setUrl(decryptedAttachmentCache.get(attachment.url)!)
      setLoading(false)
      setIsExpired(false)
      setDecryptionError(false)
      return
    }

    let isMounted = true
    setLoading(true)
    setIsExpired(false)
    setDecryptionError(false)

    ;(async () => {
      try {
        let key = await getOrEstablishConversationAesKey(conversationId, currentUserId)
        if (!key) throw new Error('No encryption key')

        const res = await fetch(attachment.url)
        if (!res.ok) {
          if (res.status === 404 || res.status === 410) {
            if (isMounted) {
              setIsExpired(true)
              setLoading(false)
            }
            return
          }
          throw new Error('Failed to fetch encrypted attachment')
        }
        const encBytes = await res.arrayBuffer()
        let decBytes: ArrayBuffer
        try {
          decBytes = await decryptBinaryWithFallback(key, conversationId, encBytes)
        } catch (decryptErr) {
          // If decryption fails with cached key, force refresh key from server and retry
          try {
            key = await getOrEstablishConversationAesKey(conversationId, currentUserId, true)
            decBytes = await decryptBinaryWithFallback(key, conversationId, encBytes)
          } catch (retryErr) {
            console.error('Failed to decrypt attachment after key refresh:', retryErr)
            if (isMounted) {
              setDecryptionError(true)
              setLoading(false)
            }
            return
          }
        }
        const blob = new Blob([decBytes], { type: attachment.mimeType || 'application/octet-stream' })
        const objectUrl = URL.createObjectURL(blob)

        decryptedAttachmentCache.set(attachment.url, objectUrl)
        if (isMounted) {
          setUrl(objectUrl)
          setLoading(false)
        }
      } catch (err) {
        console.error('Failed to load attachment:', err)
        if (isMounted) {
          setLoading(false)
        }
      }
    })()

    return () => {
      isMounted = false
    }
  }, [attachment?.url, attachment?.encrypted, attachment?.mimeType, conversationId, currentUserId, retryCount])

  return { url, loading, isExpired, decryptionError, retry }
}

function AttachmentView({
  attachment,
  isMe,
  conversationId,
  currentUserId,
  messageId,
  onDeleteMessage,
  onPreviewImage,
}: {
  attachment: any
  isMe: boolean
  conversationId: string
  currentUserId: string
  messageId?: string
  onDeleteMessage?: (messageId: string) => void
  onPreviewImage?: (attachment: { url: string; name: string; messageId?: string; isMe?: boolean }) => void
}) {
  const { url: mediaUrl, loading, isExpired, decryptionError, retry } = useDecryptedAttachment(attachment, conversationId, currentUserId)

  const handleDownloadFile = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      if (attachment.encrypted && mediaUrl) {
        const a = document.createElement('a')
        a.href = mediaUrl
        a.download = attachment.name || 'document'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        toast.success(`Downloading ${attachment.name}`)
        return
      }

      const downloadUrl = (mediaUrl || attachment.url).includes('?')
        ? `${mediaUrl || attachment.url}&download=1`
        : `${mediaUrl || attachment.url}?download=1`
      const res = await fetch(downloadUrl)
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = attachment.name || 'document'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
      toast.success(`Downloading ${attachment.name}`)
    } catch {
      const a = document.createElement('a')
      a.href = mediaUrl || (attachment.url.includes('?') ? `${attachment.url}&download=1` : `${attachment.url}?download=1`)
      a.download = attachment.name || 'document'
      a.target = '_blank'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  if (isExpired) {
    return (
      <div className="flex items-center gap-2 p-2.5 rounded-xl bg-muted/40 border border-border/50 text-xs text-muted-foreground/80 my-1">
        <Lock className="h-3.5 w-3.5 text-muted-foreground/70 flex-shrink-0" />
        <span className="italic">Attachment expired or removed</span>
      </div>
    )
  }

  if (decryptionError) {
    return (
      <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive my-1">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>Could not decrypt attachment</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            retry()
          }}
          className="text-[11px] underline font-medium hover:text-destructive/80"
        >
          Retry
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-xl bg-card/60 text-muted-foreground text-xs animate-pulse">
        <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
        <span>Decrypting file...</span>
      </div>
    )
  }

  if (attachment.contentType === 'IMAGE' || attachment.mimeType?.startsWith('image/')) {
    return (
      <div className="relative group/img select-none text-left">
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onPreviewImage?.({ url: mediaUrl, name: attachment.name, messageId, isMe })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation()
              onPreviewImage?.({ url: mediaUrl, name: attachment.name, messageId, isMe })
            }
          }}
          className="block cursor-pointer"
          title="Click to view full photo"
        >
          <div className="relative overflow-hidden rounded-xl">
            <img
              src={mediaUrl}
              alt={attachment.name}
              className="max-w-60 max-h-60 rounded-xl object-cover hover:scale-[1.02] transition-transform duration-200"
            />
            <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors rounded-xl flex items-center justify-center pointer-events-none">
              <span className="opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/65 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-xs font-medium">
                View photo
              </span>
            </div>
          </div>
        </div>

        {/* Delete action overlay for media sender (easy 1-tap on mobile & click on desktop) */}
        {isMe && messageId && onDeleteMessage && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDeleteMessage(messageId)
            }}
            className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/65 hover:bg-destructive text-white backdrop-blur-sm shadow-md transition-all cursor-pointer z-10"
            title="Delete photo"
            aria-label="Delete photo"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}

        <div className="flex items-center gap-1.5 mt-1">
          {attachment.encrypted && (
            <span className="inline-flex items-center text-[10px] font-medium text-emerald-500 gap-0.5" title="End-to-end encrypted">
              <ShieldCheck className="h-3 w-3" />
              <span>E2EE</span>
            </span>
          )}
          <span className={cn('text-[11px]', isMe ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
            {attachment.name} · {(attachment.size / 1024).toFixed(1)} KB
          </span>
        </div>
      </div>
    )
  }

  if (attachment.contentType === 'VIDEO' || attachment.mimeType?.startsWith('video/')) {
    return (
      <div className="relative">
        <video src={mediaUrl} controls className="max-w-64 max-h-64 rounded-lg" />
        {isMe && messageId && onDeleteMessage && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDeleteMessage(messageId)
            }}
            className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/65 hover:bg-destructive text-white backdrop-blur-sm shadow-md transition-all cursor-pointer z-10"
            title="Delete video"
            aria-label="Delete video"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="flex items-center gap-1.5 mt-1">
          {attachment.encrypted && (
            <span className="inline-flex items-center text-[10px] font-medium text-emerald-500 gap-0.5" title="End-to-end encrypted">
              <ShieldCheck className="h-3 w-3" />
              <span>E2EE</span>
            </span>
          )}
          <span className={cn('text-[11px]', isMe ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
            {attachment.name}
          </span>
        </div>
      </div>
    )
  }

  if (attachment.contentType === 'AUDIO' || attachment.mimeType?.startsWith('audio/')) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <div className={cn(
            'h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0',
            isMe ? 'bg-primary-foreground/15' : 'bg-primary/10'
          )}>
            <Mic className={cn('h-4 w-4', isMe ? 'text-primary-foreground' : 'text-primary')} />
          </div>
          <audio src={mediaUrl} controls className="flex-1 h-8 min-w-0" style={{ maxWidth: '220px' }} />
        </div>
        <div className="flex items-center gap-1.5">
          {attachment.encrypted && (
            <span className="inline-flex items-center text-[10px] font-medium text-emerald-500 gap-0.5" title="End-to-end encrypted">
              <ShieldCheck className="h-3 w-3" />
              <span>E2EE</span>
            </span>
          )}
          <span className={cn('text-[11px]', isMe ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
            Voice message{attachment.duration ? ` · ${Math.floor(attachment.duration / 60)}:${(attachment.duration % 60).toString().padStart(2, '0')}` : ''}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 p-2.5 rounded-xl border max-w-xs transition-colors',
        isMe
          ? 'border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground'
          : 'border-border/60 text-foreground bg-card'
      )}
    >
      <div
        className={cn(
          'h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0',
          isMe ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/10 text-primary'
        )}
      >
        <FileText className="h-4.5 w-4.5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {attachment.encrypted && (
            <ShieldCheck className="h-3 w-3 text-emerald-500 inline-block flex-shrink-0" title="End-to-end encrypted document" />
          )}
          <p className="text-xs font-semibold truncate leading-tight">{attachment.name}</p>
        </div>
        <p className={cn('text-[10px] mt-0.5', isMe ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
          {(attachment.size / 1024).toFixed(1)} KB
        </p>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={handleDownloadFile}
          className={cn(
            'p-1.5 rounded-lg transition-colors cursor-pointer flex items-center justify-center',
            isMe
              ? 'bg-primary-foreground/20 hover:bg-primary-foreground/30 text-primary-foreground'
              : 'bg-muted hover:bg-accent text-foreground hover:text-accent-foreground'
          )}
          title={`Download ${attachment.name}`}
          aria-label={`Download ${attachment.name}`}
        >
          <Download className="h-4 w-4" />
        </button>

        {isMe && messageId && onDeleteMessage && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDeleteMessage(messageId)
            }}
            className={cn(
              'p-1.5 rounded-lg transition-colors cursor-pointer flex items-center justify-center',
              isMe
                ? 'bg-destructive/80 hover:bg-destructive text-white'
                : 'bg-muted hover:bg-destructive/10 text-muted-foreground hover:text-destructive'
            )}
            title="Delete file"
            aria-label="Delete file"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}

function LightboxModal({
  previewImage,
  onClose,
  onDeleteMessage,
}: {
  previewImage: { url: string; name: string; messageId?: string; isMe?: boolean }
  onClose: () => void
  onDeleteMessage: (messageId: string) => void
}) {
  useEffect(() => {
    if (typeof window === 'undefined') return

    if (!window.history.state?.lightbox) {
      window.history.pushState({ ...(window.history.state || {}), lightbox: true }, '')
    }

    const handlePopState = () => {
      onClose()
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [onClose])

  const handleClose = () => {
    if (typeof window !== 'undefined' && window.history.state?.lightbox) {
      window.history.back()
    } else {
      onClose()
    }
  }

  const handleDownload = async () => {
    try {
      if (previewImage.url.startsWith('blob:')) {
        const a = document.createElement('a')
        a.href = previewImage.url
        a.download = previewImage.name || 'image'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        toast.success('Image downloaded')
        return
      }

      const downloadUrl = previewImage.url.includes('?')
        ? `${previewImage.url}&download=1`
        : `${previewImage.url}?download=1`
      const res = await fetch(downloadUrl)
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = previewImage.name || 'image'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
      toast.success('Image downloaded')
    } catch {
      const a = document.createElement('a')
      a.href = previewImage.url.includes('?') ? `${previewImage.url}&download=1` : `${previewImage.url}?download=1`
      a.download = previewImage.name || 'image'
      a.target = '_blank'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-3 animate-in fade-in duration-200"
      onClick={handleClose}
    >
      <div
        className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between text-white bg-gradient-to-b from-black/80 to-transparent z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium truncate max-w-[50vw] sm:max-w-[65vw]">{previewImage.name}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownload}
            className="p-2 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors flex items-center justify-center cursor-pointer"
            title="Download image"
          >
            <Download className="h-4.5 w-4.5" />
          </button>

          {previewImage.isMe && previewImage.messageId && (
            <button
              type="button"
              onClick={() => {
                onDeleteMessage(previewImage.messageId!)
                handleClose()
              }}
              className="p-2 rounded-xl bg-destructive/80 hover:bg-destructive text-white transition-colors flex items-center justify-center cursor-pointer"
              title="Delete image"
              aria-label="Delete image"
            >
              <Trash2 className="h-4.5 w-4.5" />
            </button>
          )}

          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors cursor-pointer flex items-center justify-center"
            title="Close"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>
      <div
        className="max-w-full max-h-[82vh] flex items-center justify-center p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={previewImage.url}
          alt={previewImage.name}
          className="max-w-full max-h-[82vh] object-contain rounded-xl shadow-2xl"
        />
      </div>
    </div>
  )
}
