'use client'

import { useState, useEffect, useRef } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Avatar } from './avatar'
import { ArrowLeft, Search, Loader2, MessageSquare, FileText, Mic, Image as ImageIcon } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'
import { decryptMessage, getCachedAesKey, cacheAesKey } from '@/lib/crypto'
import { format, isToday, isYesterday } from 'date-fns'
import { cn } from '@/lib/utils'

interface MessageSearchProps {
  query: string
  currentUserId: string
  onBack: () => void
  onSelectConversation: (conversationId: string) => void
}

interface SearchResult {
  messageId: string
  conversationId: string
  conversationName: string
  conversationAvatarColor: string
  senderId: string
  senderName: string
  senderAvatarColor: string
  content: string
  contentType: string
  encrypted: boolean
  decryptedContent?: string
  createdAt: string
}

export function MessageSearch({ query, currentUserId, onBack, onSelectConversation }: MessageSearchProps) {
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const conversations = useChatStore((s) => s.conversations)
  const messagesByConv = useChatStore((s) => s.messagesByConversation)
  const decrypted = useChatStore((s) => s.decrypted)
  const reqIdRef = useRef(0)

  useEffect(() => {
    if (!query.trim()) {
      // Use microtask to avoid setState-in-effect warning
      Promise.resolve().then(() => {
        setResults([])
        setSearched(false)
        setLoading(false)
      })
      return
    }
    const reqId = ++reqIdRef.current
    Promise.resolve().then(() => setLoading(true))
    // Debounce
    const t = setTimeout(async () => {
      try {
        const r = await performSearch(query, currentUserId, conversations, messagesByConv, decrypted)
        // Only update if this is still the latest request
        if (reqIdRef.current === reqId) {
          setResults(r)
          setSearched(true)
          setLoading(false)
        }
      } catch (e) {
        console.error('search failed', e)
        if (reqIdRef.current === reqId) {
          setResults([])
          setSearched(true)
          setLoading(false)
        }
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query, conversations, messagesByConv, decrypted])

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="p-3 border-b border-border flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">Messages</p>
          <p className="text-[11px] text-muted-foreground">
            {loading ? 'Searching...' : `${results.length} result${results.length === 1 ? '' : 's'} for "${query}"`}
          </p>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-0.5">
          {loading ? (
            <div className="text-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
              <p className="text-xs text-muted-foreground mt-2">Searching messages...</p>
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Search className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {searched ? `No messages found for "${query}"` : 'Start typing to search'}
              </p>
              <p className="text-[11px] text-muted-foreground/70 mt-1">
                Searches across all your conversations. E2E-encrypted messages are decrypted locally for search.
              </p>
            </div>
          ) : (
            results.map((r) => {
              const isMe = r.senderId === currentUserId
              return (
                <button
                  key={`${r.conversationId}:${r.messageId}`}
                  onClick={() => onSelectConversation(r.conversationId)}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-muted/60 transition-colors flex items-start gap-3"
                >
                  <Avatar name={r.conversationName} color={r.conversationAvatarColor} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground truncate">{r.conversationName}</p>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">
                        {formatTime(r.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {isMe ? 'You: ' : `${r.senderName}: `}
                      <span className="text-foreground">
                        {r.content || r.decryptedContent || (
                          r.encrypted ? '(encrypted)' : ''
                        )}
                      </span>
                    </p>
                    {!r.decryptedContent && r.encrypted && (
                      <p className="text-[10px] text-amber-600 mt-0.5">🔒 Encrypted — tap to view</p>
                    )}
                  </div>
                  <ContentTypeIcon type={r.contentType} className="h-4 w-4 text-muted-foreground mt-1 flex-shrink-0" />
                </button>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function ContentTypeIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'IMAGE') return <ImageIcon className={className} />
  if (type === 'AUDIO') return <Mic className={className} />
  if (type === 'FILE' || type === 'VIDEO') return <FileText className={className} />
  return <MessageSquare className={className} />
}

function formatTime(date: string | Date) {
  const d = new Date(date)
  if (isToday(d)) return format(d, 'HH:mm')
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'MMM d')
}

// Perform search across all conversations. Returns up to 50 results.
async function performSearch(
  query: string,
  currentUserId: string,
  conversations: any[],
  messagesByConv: Record<string, any[]>,
  decrypted: Record<string, string>
): Promise<SearchResult[]> {
  const q = query.toLowerCase()
  if (!q) return []
  const results: SearchResult[] = []

  // Load messages from each conversation we haven't loaded yet (limit to 50 msgs each)
  for (const conv of conversations) {
    let msgs = messagesByConv[conv.id] || []
    if (msgs.length === 0) {
      try {
        const res = await fetch(`/api/conversations/${conv.id}/messages?limit=100`)
        if (res.ok) {
          const data = await res.json()
          msgs = data.messages || []
        }
      } catch {}
    }

    // For E2E messages, we need to decrypt them to search. Get the AES key for this conversation.
    let aesKey: CryptoKey | null = null
    const hasEncrypted = msgs.some((m: any) => m.encrypted && m.contentType === 'TEXT')
    if (hasEncrypted) {
      try {
        aesKey = await getCachedAesKey(conv.id)
        if (!aesKey) {
          // Derive the conversation key (same logic as chat-thread.ts)
          const seed = conv.id + ':pulsechat-e2e-seed-v1'
          const seedBytes = new TextEncoder().encode(seed)
          const hashBuf = await crypto.subtle.digest('SHA-256', seedBytes)
          aesKey = await crypto.subtle.importKey('raw', hashBuf, { name: 'AES-GCM' }, true, ['decrypt'])
          await cacheAesKey(conv.id, aesKey)
        }
      } catch {}
    }

    for (const m of msgs) {
      let searchableText = ''
      if (m.contentType === 'TEXT') {
        if (m.encrypted) {
          // Try cached decrypted value first
          const cached = decrypted[`${conv.id}:${m.id}`]
          if (cached) {
            searchableText = cached
          } else if (aesKey) {
            try {
              searchableText = await decryptMessage(aesKey, m.content)
            } catch {
              searchableText = ''
            }
          }
        } else {
          searchableText = m.content
        }
      } else if (m.attachment?.name) {
        searchableText = m.attachment.name
      }

      if (searchableText && searchableText.toLowerCase().includes(q)) {
        const sender = conv.members.find((mm: any) => mm.id === m.senderId)
        results.push({
          messageId: m.id,
          conversationId: conv.id,
          conversationName: conv.name,
          conversationAvatarColor: conv.avatarColor,
          senderId: m.senderId,
          senderName: sender?.name || 'Unknown',
          senderAvatarColor: sender?.avatarColor || '#0ea5e9',
          content: m.encrypted ? '' : (m.contentType === 'TEXT' ? highlightMatch(searchableText, q) : `[${m.contentType}] ${m.attachment?.name || ''}`),
          contentType: m.contentType,
          encrypted: m.encrypted,
          decryptedContent: m.encrypted ? highlightMatch(searchableText, q) : undefined,
          createdAt: m.createdAt,
        })
        if (results.length >= 50) return results
      }
    }
  }
  return results
}

function highlightMatch(text: string, query: string): string {
  // We return the text up to 100 chars around the first match
  const lower = text.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, 100)
  const start = Math.max(0, idx - 40)
  const end = Math.min(text.length, idx + query.length + 60)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}
