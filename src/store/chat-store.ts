'use client'

import { create } from 'zustand'
import { toast } from 'sonner'

export type PresenceStatus = 'online' | 'away' | 'offline'

export interface ChatUser {
  id: string
  name: string
  username: string
  email?: string
  avatarColor: string
  avatarUrl?: string | null
  bio?: string | null
  role?: string
  lastSeenAt?: string | Date
}

export interface ChatMessage {
  id: string
  conversationId: string
  senderId: string
  sender: ChatUser
  content: string
  contentType: string // TEXT | FILE | IMAGE | VIDEO | AUDIO | SYSTEM
  encrypted: boolean
  moderation: string // APPROVED | FLAGGED | BLOCKED
  attachment?: Attachment | null
  deletedAt?: string | Date | null
  createdAt: string | Date
  tempId?: string
}

export interface Attachment {
  url: string
  name: string
  size: number
  mimeType: string
  contentType: string
}

export interface Conversation {
  id: string
  type: 'PRIVATE' | 'GROUP'
  name: string
  avatarColor: string
  members: ChatUser[]
  lastMessage?: ChatMessage | null
  lastReadAt?: string | Date
  updatedAt?: string | Date
  unreadCount?: number
}

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  messagesByConversation: Record<string, ChatMessage[]>
  presence: Record<string, PresenceStatus>
  typing: Record<string, Record<string, number>> // conversationId -> userId -> timestamp
  currentUser: ChatUser | null
  socketConnected: boolean
  // decryption cache: conversationId -> decrypted content for message id
  decrypted: Record<string, string> // key: `${conversationId}:${messageId}` -> plaintext
  searchTargetMessageId: string | null
  setSearchTargetMessageId: (id: string | null) => void
  showProfanity: boolean
  setShowProfanity: (show: boolean) => void
  setCurrentUser: (u: ChatUser) => void
  setSocketConnected: (c: boolean) => void
  setConversations: (c: Conversation[]) => void
  upsertConversation: (c: Conversation) => void
  setActiveConversation: (id: string | null) => void
  addMessage: (m: ChatMessage) => void
  prependMessages: (conversationId: string, msgs: ChatMessage[]) => void
  setMessages: (conversationId: string, msgs: ChatMessage[]) => void
  setDecrypted: (conversationIdId: string, messageId: string, plaintext: string) => void
  updatePresence: (userId: string, status: PresenceStatus) => void
  setTyping: (conversationId: string, userId: string) => void
  clearTyping: (conversationId: string, userId: string) => void
  updateLastRead: (conversationId: string) => void
  deleteMessage: (conversationId: string, messageId: string) => void
  reset: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messagesByConversation: {},
  presence: {},
  typing: {},
  currentUser: null,
  socketConnected: false,
  decrypted: {},
  searchTargetMessageId: null,
  showProfanity: false,

  setCurrentUser: (u) => set({ currentUser: u }),
  setSocketConnected: (c) => set({ socketConnected: c }),
  setConversations: (c) => set({ conversations: c }),
  upsertConversation: (conv) =>
    set((s) => {
      const idx = s.conversations.findIndex((x) => x.id === conv.id)
      const next = [...s.conversations]
      if (idx === -1) next.unshift(conv)
      else next[idx] = { ...next[idx], ...conv }
      return { conversations: next }
    }),

  setActiveConversation: (id) => {
    set({ activeConversationId: id })
    if (id) get().updateLastRead(id)
  },

  addMessage: (m) =>
    set((s) => {
      const list = s.messagesByConversation[m.conversationId] || []
      // Deduplicate by id or tempId
      const exists = list.some(
        (x) => x.id === m.id || (m.tempId && x.tempId === m.tempId)
      )
      if (exists) {
        // Replace the optimistic message with the canonical one
        const replaced = list.map((x) =>
          x.id === m.id || (m.tempId && x.tempId === m.tempId) ? m : x
        )
        return {
          messagesByConversation: {
            ...s.messagesByConversation,
            [m.conversationId]: replaced,
          },
        }
      }
      return {
        messagesByConversation: {
          ...s.messagesByConversation,
          [m.conversationId]: [...list, m],
        },
      }
    }),

  prependMessages: (conversationId, msgs) =>
    set((s) => {
      const list = s.messagesByConversation[conversationId] || []
      const existingIds = new Set(list.map((m) => m.id))
      const toPrepend = msgs.filter((m) => !existingIds.has(m.id))
      return {
        messagesByConversation: {
          ...s.messagesByConversation,
          [conversationId]: [...toPrepend, ...list],
        },
      }
    }),

  setMessages: (conversationId, msgs) =>
    set((s) => ({
      messagesByConversation: {
        ...s.messagesByConversation,
        [conversationId]: msgs,
      },
    })),

  setDecrypted: (conversationId, messageId, plaintext) =>
    set((s) => ({
      decrypted: { ...s.decrypted, [`${conversationId}:${messageId}`]: plaintext },
    })),

  updatePresence: (userId, status) =>
    set((s) => ({ presence: { ...s.presence, [userId]: status } })),

  setTyping: (conversationId, userId) =>
    set((s) => ({
      typing: {
        ...s.typing,
        [conversationId]: {
          ...(s.typing[conversationId] || {}),
          [userId]: Date.now(),
        },
      },
    })),

  clearTyping: (conversationId, userId) =>
    set((s) => {
      const conv = s.typing[conversationId] || {}
      const next = { ...conv }
      delete next[userId]
      return { typing: { ...s.typing, [conversationId]: next } }
    }),

  updateLastRead: (conversationId) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, lastReadAt: new Date().toISOString(), unreadCount: 0 }
          : c
      ),
    })),

  deleteMessage: (conversationId, messageId) =>
    set((s) => {
      const list = s.messagesByConversation[conversationId] || []
      return {
        messagesByConversation: {
          ...s.messagesByConversation,
          [conversationId]: list.map((m) =>
            m.id === messageId ? { ...m, deletedAt: new Date().toISOString() } : m
          ),
        },
      }
    }),

  setSearchTargetMessageId: (id) => set({ searchTargetMessageId: id }),
  setShowProfanity: (show) => {
    set({ showProfanity: show })
    if (typeof window !== 'undefined') {
      localStorage.setItem('bharatchat-show-profanity', show ? 'true' : 'false')
    }
  },

  reset: () =>
    set({
      conversations: [],
      activeConversationId: null,
      messagesByConversation: {},
      presence: {},
      typing: {},
      currentUser: null,
      socketConnected: false,
      decrypted: {},
      searchTargetMessageId: null,
      showProfanity: false,
    }),
}))

// Helper: compute unread count for a conversation
export function computeUnread(conv: Conversation, currentUserId: string): number {
  if (!conv.lastMessage) return 0
  if (conv.lastMessage.senderId === currentUserId) return 0
  const lastRead = conv.lastReadAt ? new Date(conv.lastReadAt).getTime() : 0
  const msgTime = new Date(conv.lastMessage.createdAt).getTime()
  return msgTime > lastRead ? 1 : 0
}
