'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useChatStore } from '@/store/chat-store'
import { Avatar } from './avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageSquare, Users, Lock, Send, Paperclip, ArrowLeft, ShieldCheck, Flag, Trash2, Mic } from 'lucide-react'
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
  getCachedAesKey,
  cacheAesKey,
} from '@/lib/crypto'
import { moderateMessage } from '@/lib/moderation'

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

  const conv = conversations.find((c) => c.id === activeId)
  const messages = activeId ? messagesByConv[activeId] || [] : []
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevMsgCountRef = useRef(0)
  const atBottomRef = useRef(true)
  const e2eEnabled = useRef(true) // for demo, all new chats are encrypted

  const loadMessages = useCallback(
    async (convId: string, cursor: string | null, replace: boolean) => {
      try {
        const url = `/api/conversations/${convId}/messages?limit=50${cursor ? `&cursor=${cursor}` : ''}`
        const res = await fetch(url)
        if (!res.ok) return
        const data = await res.json()
        if (replace) {
          useChatStore.getState().setMessages(convId, data.messages.reverse())
          // Mark as read
          updateLastRead(convId)
        } else {
          useChatStore.getState().prependMessages(convId, data.messages.reverse())
        }
        setCursor(data.nextCursor)
        setHasMore(!!data.nextCursor)
      } catch (e) {
        console.error('failed to load messages', e)
      }
    },
    [updateLastRead]
  )

  async function initConversationKey(convId: string) {
    let key = await getCachedAesKey(convId)
    if (!key) {
      // Generate a new key for this conversation (the demo: all clients must derive the same key)
      // For a true E2E flow you'd wrap this with each member's RSA public key. Here we use a
      // deterministic key derived from the conversation id so all members can decrypt.
      const seed = convId + ':pulsechat-e2e-seed-v1'
      const seedBytes = new TextEncoder().encode(seed)
      const hashBuf = await crypto.subtle.digest('SHA-256', seedBytes)
      key = await crypto.subtle.importKey('raw', hashBuf, { name: 'AES-GCM' }, true, [
        'encrypt',
        'decrypt',
      ])
      await cacheAesKey(convId, key)
    }
    // Decrypt any pending messages
    await ensureDecrypted(convId, useChatStore.getState().messagesByConversation[convId] || [], currentUserId)
  }

  // Load messages when conversation changes
  useEffect(() => {
    if (!activeId) return
    // Reset pagination, then fetch — wrap in microtask to avoid setState-in-effect warning
    Promise.resolve().then(() => {
      setCursor(null)
      setHasMore(true)
      loadMessages(activeId, null, true)
      initConversationKey(activeId)
    })
  }, [activeId, loadMessages])

  // Auto-scroll to bottom when new messages arrive (if user is at bottom)
  useEffect(() => {
    if (!scrollRef.current) return
    if (atBottomRef.current || messages.length - prevMsgCountRef.current === 1) {
      const el = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement
      if (el) el.scrollTop = el.scrollHeight
    }
    prevMsgCountRef.current = messages.length
  }, [messages])

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
    let contentToSend = finalText
    let encrypted = false
    if (e2eEnabled.current) {
      const key = await getCachedAesKey(activeId)
      if (key) {
        contentToSend = await encryptMessage(key, finalText)
        encrypted = true
      }
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
      content: contentToSend,
      contentType: 'TEXT',
      encrypted,
      moderation: mod.status,
      createdAt: new Date().toISOString(),
      tempId,
    }
    addMessage(tempMsg)
    if (encrypted) setDecrypted(activeId, tempId, finalText)

    try {
      const sock = await getSocket(currentUserId)
      sock.emit('message:send', {
        conversationId: activeId,
        content: contentToSend,
        contentType: 'TEXT',
        encrypted,
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
    e.target.value = ''
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        toast.error('Upload failed', { description: data.error })
        return
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
        attachment: data,
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
        attachment: data,
        tempId,
      })
      toast.success('File shared')
    } catch (e) {
      toast.error('Upload failed')
    }
    setUploading(false)
  }

  // Send a voice message (already uploaded by the VoiceRecorder component)
  async function handleSendVoice(attachment: any) {
    if (!activeId) return
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
      attachment,
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
        attachment,
        tempId,
      })
    } catch (e) {
      toast.error('Failed to send voice message')
    }
  }

  // Delete a message (sender only). Soft-delete via socket + REST fallback.
  async function handleDeleteMessage(messageId: string) {
    if (!activeId) return
    const prevMessages = useChatStore.getState().messagesByConversation[activeId] || []
    const msg = prevMessages.find((m) => m.id === messageId)
    if (!msg) return
    if (msg.senderId !== currentUserId) {
      toast.error('You can only delete your own messages')
      return
    }
    // Optimistic update
    deleteMessageStore(activeId, messageId)
    try {
      // Emit to socket for real-time broadcast
      const sock = await getSocket(currentUserId)
      sock.emit('message:delete', { conversationId: activeId, messageId })
      // Also hit REST as a fallback (in case socket isn't connected)
      fetch(`/api/messages/${messageId}`, { method: 'DELETE' }).catch(() => {})
      toast.success('Message deleted')
    } catch (e) {
      toast.error('Failed to delete message')
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
          <div className="h-16 w-16 rounded-2xl bg-accent-foreground/10 mx-auto flex items-center justify-center mb-4 border border-accent-foreground/20">
            <MessageSquare className="h-8 w-8 text-accent-foreground" />
          </div>
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
          {messages.length === 0 ? (
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
            />
          )}
          {typingNames.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 bg-muted-foreground/60 rounded-full typing-dot" />
                <span className="h-1.5 w-1.5 bg-muted-foreground/60 rounded-full typing-dot" style={{ animationDelay: '150ms' }} />
                <span className="h-1.5 w-1.5 bg-muted-foreground/60 rounded-full typing-dot" style={{ animationDelay: '300ms' }} />
              </span>
              <span>
                {typingNames.length === 1
                  ? `${typingNames[0]} is typing...`
                  : `${typingNames.slice(0, 2).join(', ')} are typing...`}
              </span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Composer */}
      <footer className="p-4 bg-transparent z-10">
        <div className="max-w-4xl mx-auto flex items-end gap-2.5 p-2 rounded-2xl bg-card/75 border border-border/40 shadow-lift glass relative">
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
            className="flex-shrink-0 h-9.5 w-9.5 rounded-xl border-border/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-all duration-150 bg-transparent shadow-none"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || sending}
            title="Attach file"
          >
            <Paperclip className="h-4.5 w-4.5" />
          </Button>
          <VoiceRecorder onSend={handleSendVoice} disabled={sending || uploading} />
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
            className="flex-1 bg-transparent border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 px-2 min-h-[38px] placeholder:text-muted-foreground/60"
          />
          <Button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="bg-primary hover:bg-[#C87D12] text-primary-foreground font-semibold rounded-xl h-9.5 w-9.5 p-0 flex-shrink-0 transition-transform active:scale-95 shadow-md shadow-primary/10"
            size="icon"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/75 mt-2 text-center tracking-wide">
          All messages are end-to-end encrypted. Press Enter to send, Shift+Enter for newline. Tap 🎤 for voice.
        </p>
      </footer>
    </main>
  )
}

function MessageList({
  messages,
  currentUserId,
  decrypted,
  conversationId,
  onDeleteMessage,
}: {
  messages: any[]
  currentUserId: string
  decrypted: Record<string, string>
  conversationId: string
  onDeleteMessage: (messageId: string) => void
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
          ? decrypted[`${conversationId}:${m.id}`] || 'Decrypting...'
          : m.content

        return (
          <div key={m.id} className="animate-message-in">
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
              displayContent={displayContent}
              showSender={showSender}
              showAvatar={showAvatar}
              onDeleteMessage={onDeleteMessage}
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
  displayContent,
  showSender,
  showAvatar,
  onDeleteMessage,
}: {
  message: any
  isMe: boolean
  displayContent: string
  showSender: boolean
  showAvatar: boolean
  onDeleteMessage: (messageId: string) => void
}) {
  const [showActions, setShowActions] = useState(false)
  const isFlagged = message.moderation === 'FLAGGED'
  const isBlocked = message.moderation === 'BLOCKED'
  const isDeleted = !!message.deletedAt

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
    return (
      <div
        className={cn(
          'flex items-end gap-2 px-1 py-0.5',
          isMe ? 'flex-row-reverse' : 'flex-row'
        )}
      >
        {!isMe && <div className="w-8 flex-shrink-0" />}
        <div className={cn('max-w-[75%] sm:max-w-[60%] flex flex-col', isMe ? 'items-end' : 'items-start')}>
          <div className="px-3 py-2 rounded-2xl bg-muted/60 text-muted-foreground italic text-sm border border-dashed border-border rounded-br-sm">
            🚫 This message was deleted
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
      <div className={cn('max-w-[75%] sm:max-w-[65%] flex flex-col', isMe ? 'items-end' : 'items-start')}>
        {showSender && !isMe && (
          <span className="text-[10px] font-semibold text-muted-foreground/80 mb-0.5 ml-1.5">{message.sender?.name}</span>
        )}
        <div className="relative">
          <div
            className={cn(
              'px-3.5 py-2.5 rounded-2xl break-words shadow-md leading-relaxed text-sm',
              isMe
                ? 'bg-primary text-primary-foreground rounded-tr-none shadow-primary/5'
                : 'bg-card text-card-foreground border border-border/30 rounded-tl-none shadow-sm',
              isFlagged && !isMe && 'ring-1 ring-amber-400/50',
              isBlocked && 'opacity-60 italic'
            )}
          >
            {message.attachment ? (
              <AttachmentView attachment={message.attachment} isMe={isMe} />
            ) : message.contentType === 'TEXT' ? (
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{displayContent}</p>
            ) : null}
          </div>
          {/* Hover actions — delete button for own messages */}
          {isMe && showActions && (
            <button
              onClick={() => onDeleteMessage(message.id)}
              className={cn(
                'absolute top-1/2 -translate-y-1/2 p-1 rounded-md bg-popover text-muted-foreground hover:text-destructive hover:bg-destructive/10 shadow-soft border border-border transition-opacity',
                isMe ? '-left-9' : '-right-9'
              )}
              title="Delete message"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <span className={cn('text-[10px] text-muted-foreground mt-0.5', isMe ? 'mr-1' : 'ml-1')}>
          {format(new Date(message.createdAt), 'HH:mm')}
          {isFlagged && <span className="ml-1 text-amber-600">· filtered</span>}
        </span>
      </div>
    </div>
  )
}

function AttachmentView({ attachment, isMe }: { attachment: any; isMe: boolean }) {
  if (attachment.contentType === 'IMAGE' || attachment.mimeType?.startsWith('image/')) {
    return (
      <a href={attachment.url} target="_blank" rel="noreferrer" className="block">
        <img
          src={attachment.url}
          alt={attachment.name}
          className="max-w-64 max-h-64 rounded-lg"
        />
        <span className={cn('text-[11px] block mt-1', isMe ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
          {attachment.name} · {(attachment.size / 1024).toFixed(1)} KB
        </span>
      </a>
    )
  }
  if (attachment.contentType === 'VIDEO' || attachment.mimeType?.startsWith('video/')) {
    return (
      <div>
        <video src={attachment.url} controls className="max-w-64 max-h-64 rounded-lg" />
        <span className={cn('text-[11px] block mt-1', isMe ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
          {attachment.name}
        </span>
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
          <audio src={attachment.url} controls className="flex-1 h-8 min-w-0" style={{ maxWidth: '220px' }} />
        </div>
        <span className={cn('text-[11px]', isMe ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
          Voice message{attachment.duration ? ` · ${Math.floor(attachment.duration / 60)}:${(attachment.duration % 60).toString().padStart(2, '0')}` : ''}
        </span>
      </div>
    )
  }
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg border',
        isMe ? 'border-primary-foreground/30 text-primary-foreground' : 'border-border text-foreground bg-card'
      )}
    >
      <Paperclip className="h-4 w-4 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{attachment.name}</p>
        <p className={cn('text-[11px]', isMe ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
          {(attachment.size / 1024).toFixed(1)} KB · Click to download
        </p>
      </div>
    </a>
  )
}
