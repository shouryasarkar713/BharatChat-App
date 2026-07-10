'use client'

import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar } from './avatar'
import { Search, Check, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { useChatStore } from '@/store/chat-store'
import { cn } from '@/lib/utils'

interface UserResult {
  id: string
  name: string
  username: string
  email: string
  avatarColor: string
  lastSeenAt: string
}

export function NewConversationDialog({
  open,
  onOpenChange,
  currentUserId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  currentUserId: string
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserResult[]>([])
  const [selected, setSelected] = useState<UserResult[]>([])
  const [groupName, setGroupName] = useState('')
  const [encrypted, setEncrypted] = useState(true)
  const [creating, setCreating] = useState(false)
  const upsertConversation = useChatStore((s) => s.upsertConversation)
  const setActive = useChatStore((s) => s.setActiveConversation)

  // Debounced search using a ref-based timer
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!query.trim()) {
      // Schedule empty results on next tick to avoid setState-in-effect warning
      searchTimerRef.current = setTimeout(() => setResults([]), 0)
      return
    }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setResults(data.users || [])
      } catch {}
    }, 200)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [query])

  // Handle close: reset state via callback instead of effect
  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuery('')
      setResults([])
      setSelected([])
      setGroupName('')
      setEncrypted(true)
    }
    onOpenChange(next)
  }

  const isGroup = selected.length >= 2

  function toggleSelect(user: UserResult) {
    setSelected((prev) => {
      const exists = prev.find((u) => u.id === user.id)
      if (exists) return prev.filter((u) => u.id !== user.id)
      return [...prev, user]
    })
  }

  async function handleCreate() {
    if (selected.length === 0) {
      toast.error('Select at least one user')
      return
    }
    if (isGroup && !groupName.trim()) {
      toast.error('Enter a group name')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: isGroup ? 'GROUP' : 'PRIVATE',
          name: isGroup ? groupName : undefined,
          memberIds: selected.map((u) => u.id),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error('Failed to create conversation', { description: data.error })
      } else {
        // Fetch the conversation detail
        const detailRes = await fetch(`/api/conversations/${data.id}`)
        const detail = await detailRes.json()
        upsertConversation({
          id: detail.id,
          type: detail.type,
          name: detail.name,
          avatarColor: detail.avatarColor,
          members: detail.members,
          lastReadAt: detail.lastReadAt,
          updatedAt: new Date().toISOString(),
          unreadCount: 0,
        })
        setActive(detail.id)
        toast.success(isGroup ? 'Group created' : 'Conversation started')
        onOpenChange(false)
      }
    } catch (e) {
      toast.error('Failed to create conversation')
    }
    setCreating(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>
            Search for users to start a private chat or group.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isGroup && (
            <div className="space-y-1.5">
              <Label htmlFor="g-name">Group name</Label>
              <Input
                id="g-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Design Team"
              />
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search by name, username or email..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 p-2 bg-muted rounded-md">
              {selected.map((u) => (
                <span
                  key={u.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/15 text-primary text-xs rounded-full"
                >
                  {u.name}
                  <button
                    onClick={() => toggleSelect(u)}
                    className="hover:text-primary/80"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <ScrollArea className="h-64 rounded-md border border-border">
            <div className="p-1">
              {query.trim() && results.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">No users found</p>
              ) : !query.trim() ? (
                <p className="text-center text-sm text-muted-foreground/70 py-8">Start typing to search</p>
              ) : (
                results.map((u) => {
                  const isSelected = !!selected.find((s) => s.id === u.id)
                  return (
                    <button
                      key={u.id}
                      onClick={() => toggleSelect(u)}
                      className={cn(
                        'w-full flex items-center gap-3 p-2 rounded-md hover:bg-muted/60 transition-colors',
                        isSelected && 'bg-primary/10'
                      )}
                    >
                      <Avatar name={u.name} color={u.avatarColor} size="sm" src={u.avatarUrl} />
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{u.name}</p>
                        <p className="text-xs text-muted-foreground truncate">@{u.username}</p>
                      </div>
                      {isSelected && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  )
                })
              )}
            </div>
          </ScrollArea>

          <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 text-primary" />
            <span>End-to-end encryption is enabled by default for new chats.</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleCreate}
            disabled={creating || selected.length === 0 || (isGroup && !groupName.trim())}
            className="bg-primary hover:bg-primary/90"
          >
            {creating ? 'Creating...' : isGroup ? 'Create group' : 'Start chat'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
