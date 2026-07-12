'use client'

import { useState, useMemo } from 'react'
import { useChatStore, computeUnread } from '@/store/chat-store'
import { Avatar } from './avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Plus, Search, MessageSquare, Users, LogOut, Wifi, WifiOff, Settings, X } from 'lucide-react'
import { signOut } from 'next-auth/react'
import { format, isToday, isYesterday } from 'date-fns'
import { cn } from '@/lib/utils'
import { NewConversationDialog } from './new-conversation-dialog'
import { ProfileDialog } from './profile-dialog'
import { MessageSearch } from './message-search'
import { ThemeToggle } from './theme-toggle'

interface SidebarUser {
  id: string
  name: string
  avatarColor: string
  username: string
  email?: string
  avatarUrl?: string | null
  bio?: string | null
}

export function Sidebar({ currentUser }: { currentUser: SidebarUser }) {
  const conversations = useChatStore((s) => s.conversations)
  const activeId = useChatStore((s) => s.activeConversationId)
  const setActive = useChatStore((s) => s.setActiveConversation)
  const presence = useChatStore((s) => s.presence)
  const socketConnected = useChatStore((s) => s.socketConnected)
  const [showNew, setShowNew] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [searchMode, setSearchMode] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => conversations.filter((c) =>
    !search ? true : c.name.toLowerCase().includes(search.toLowerCase())
  ), [conversations, search])

  return (
    <aside className="flex flex-col h-full w-full md:w-80 border-r border-border/40 bg-sidebar/95 backdrop-blur-md relative">
      {/* Header */}
      <div className="p-4 border-b border-border/40 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-2xl bg-primary flex items-center justify-center shadow-md shadow-primary/20 transform hover:rotate-3 transition-transform">
              <MessageSquare className="h-5.5 w-5.5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-extrabold leading-tight tracking-wide text-md text-foreground">
                <span className="jaali-underline-wordmark">BharatChat</span>
              </h1>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold mt-0.5">
                {socketConnected ? (
                  <>
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-emerald-600 dark:text-emerald-400">Connected</span>
                  </>
                ) : (
                  <>
                    <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                    <span className="text-amber-600 dark:text-amber-400">Reconnecting...</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowProfile(true)}
              title="Edit profile"
              className="text-muted-foreground hover:text-foreground h-8.5 w-8.5 rounded-xl hover:bg-muted/50"
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => signOut({ redirect: false })}
              title="Sign out"
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8.5 w-8.5 rounded-xl"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Current user — clickable to open profile */}
        <button
          onClick={() => setShowProfile(true)}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-muted/40 hover:bg-muted/75 transition-all text-left border border-border/20 shadow-sm"
        >
          <Avatar
            name={currentUser.name}
            color={currentUser.avatarColor}
            size="sm"
            src={currentUser.avatarUrl}
            showStatus
            online={true}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground truncate">{currentUser.name}</p>
            <p className="text-[10px] font-medium text-muted-foreground/80 truncate">@{currentUser.username}</p>
          </div>
          <Settings className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
        </button>

        {/* Search + New */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/75" />
            <Input
              placeholder="Search chats..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setSearchMode(true)}
              className="pl-9 h-9.5 text-sm bg-muted/40 border-border/30 rounded-xl focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all placeholder:text-muted-foreground/60"
            />
            {search && (
              <button
                onClick={() => {
                  setSearch('')
                  setSearchMode(false)
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {search && (
            <Button
              size="sm"
              variant="outline"
              className="h-9.5 text-xs whitespace-nowrap rounded-xl border-border/40 hover:bg-muted/65"
              onClick={() => setSearchMode(true)}
            >
              In messages
            </Button>
          )}
          <Button
            size="icon"
            className="h-9.5 w-9.5 bg-primary hover:bg-[#C87D12] text-primary-foreground font-semibold rounded-xl flex-shrink-0 transition-all hover:translate-y-[-1px] active:translate-y-[0px]"
            onClick={() => setShowNew(true)}
            title="New conversation"
          >
            <Plus className="h-4.5 w-4.5" />
          </Button>
        </div>
      </div>

      {/* Either conversation list or message search results */}
      {searchMode && search.trim() ? (
        <MessageSearch
          query={search.trim()}
          currentUserId={currentUser.id}
          onBack={() => {
            setSearchMode(false)
            setSearch('')
          }}
          onSelectConversation={(id) => {
            setActive(id)
            setSearchMode(false)
            setSearch('')
          }}
        />
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2 space-y-0.5">
            {filtered.length === 0 ? (
              <div className="text-center py-12 px-4">
                <Users className="h-10 w-10 text-muted-foreground/50 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No conversations yet</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setShowNew(true)}
                >
                  Start a new chat
                </Button>
              </div>
            ) : (
              filtered.map((c) => {
                const isActive = c.id === activeId
                const otherMember = c.members.find((m) => m.id !== currentUser.id)
                const presenceStatus = otherMember ? presence[otherMember.id] : undefined
                const isOnline = presenceStatus === 'online'
                const unread = c.unreadCount ?? computeUnread(c, currentUser.id)
                const lastMsg = c.lastMessage
                const lastMsgText = lastMsg
                  ? lastMsg.contentType === 'TEXT'
                    ? (lastMsg.content.length > 60 ? lastMsg.content.slice(0, 60) + '…' : lastMsg.content)
                    : `[${lastMsg.contentType}]`
                  : 'No messages yet'

                return (
                  <button
                    key={c.id}
                    onClick={() => setActive(c.id)}
                    className={cn(
                      'w-full text-left px-3 py-3 rounded-xl flex items-center gap-3 transition-all relative border border-transparent duration-200',
                      isActive
                        ? 'bg-primary/8 shadow-sm border-l-4 border-l-primary rounded-l-none'
                        : 'hover:bg-muted/45 hover:translate-x-[2px]'
                    )}
                  >
                    <Avatar
                      name={c.name}
                      color={c.avatarColor}
                      size="md"
                      showStatus={c.type === 'PRIVATE'}
                      online={c.type === 'PRIVATE' ? isOnline : undefined}
                      src={c.type === 'PRIVATE' ? otherMember?.avatarUrl : undefined}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn('text-sm font-semibold truncate', isActive ? 'text-foreground' : 'text-foreground/90')}>
                          {c.name}
                        </p>
                        <span className="text-[9.5px] font-medium text-muted-foreground/80 flex-shrink-0">
                          {lastMsg ? formatTime(lastMsg.createdAt) : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p className={cn('text-xs truncate flex-1', isActive ? 'text-muted-foreground' : 'text-muted-foreground/85')}>
                          {lastMsg && lastMsg.senderId === currentUser.id ? (
                            <span className="font-semibold text-muted-foreground/60 mr-0.5">You:</span>
                          ) : ''}
                          {lastMsg?.encrypted ? '🔒 Encrypted' : lastMsg?.deletedAt ? '🚫 Message deleted' : lastMsgText}
                        </p>
                        {unread > 0 && (
                          <span className="bg-primary text-primary-foreground text-[9.5px] font-extrabold h-4.5 min-w-4.5 px-1.5 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm">
                            {unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </ScrollArea>
      )}

      <NewConversationDialog open={showNew} onOpenChange={setShowNew} currentUserId={currentUser.id} />
      <ProfileDialog open={showProfile} onOpenChange={setShowProfile} user={currentUser as any} />
    </aside>
  )
}

function formatTime(date: string | Date) {
  const d = new Date(date)
  if (isToday(d)) return format(d, 'HH:mm')
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'MMM d')
}
