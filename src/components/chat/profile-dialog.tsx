'use client'

import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Avatar } from './avatar'
import { Loader2, Check, Camera, Trash2, Bell, BellOff } from 'lucide-react'
import { toast } from 'sonner'
import { useChatStore } from '@/store/chat-store'
import { usePushNotifications } from '@/hooks/use-push-notifications'
import { cn } from '@/lib/utils'

const AVATAR_COLORS = ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#0ea5e9', '#6366f1', '#84cc16']

interface ProfileDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  user: {
    id: string
    name: string
    username: string
    email: string
    avatarColor: string
    avatarUrl?: string | null
    bio?: string | null
  }
}

export function ProfileDialog({ open, onOpenChange, user }: ProfileDialogProps) {
  const [name, setName] = useState(user.name)
  const [username, setUsername] = useState(user.username)
  const [bio, setBio] = useState(user.bio || '')
  const [avatarColor, setAvatarColor] = useState(user.avatarColor)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl || null)
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sync state when dialog opens (avoids setState-in-effect)
  useEffect(() => {
    if (open) {
      Promise.resolve().then(() => {
        setName(user.name)
        setUsername(user.username)
        setBio(user.bio || '')
        setAvatarColor(user.avatarColor)
        setAvatarUrl(user.avatarUrl || null)
      })
    }
  }, [open])

  const setCurrentUser = useChatStore((s) => s.setCurrentUser)
  const push = usePushNotifications()
  const [pushEnabled, setPushEnabled] = useState(false)

  useEffect(() => {
    Promise.resolve().then(() => setPushEnabled(push.isEnabled))
  }, [push.isEnabled])

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5MB')
      return
    }
    setUploadingAvatar(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        toast.error('Upload failed', { description: data.error })
      } else {
        setAvatarUrl(data.url)
        toast.success('Profile picture updated')
      }
    } catch (e) {
      toast.error('Upload failed')
    }
    setUploadingAvatar(false)
  }

  async function handleTogglePush() {
    if (pushEnabled) {
      push.disable()
      setPushEnabled(false)
      toast.success('Push notifications disabled')
    } else {
      const ok = await push.enable()
      if (ok) {
        setPushEnabled(true)
        toast.success('Push notifications enabled')
      } else {
        toast.error('Permission denied', {
          description: 'Please allow notifications in your browser settings.',
        })
      }
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    if (username.length < 3) {
      toast.error('Username must be at least 3 characters')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/users/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          username: username.trim(),
          bio: bio.trim() || null,
          avatarColor,
          avatarUrl: avatarUrl || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error('Failed to update profile', { description: data.error })
      } else {
        // Refetch the full user profile to ensure store has latest bio too
        const meRes = await fetch('/api/users/me')
        if (meRes.ok) {
          const me = await meRes.json()
          setCurrentUser({
            id: me.id,
            name: me.name,
            username: me.username,
            email: me.email,
            avatarColor: me.avatarColor,
            avatarUrl: me.avatarUrl,
            bio: me.bio,
          } as any)
        }
        toast.success('Profile updated')
        onOpenChange(false)
      }
    } catch (e) {
      toast.error('Failed to update profile')
    }
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Update your personal information, profile picture, and notification settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto">
          {/* Avatar with upload overlay */}
          <div className="flex items-center gap-4">
            <div className="relative group">
              <Avatar name={name || user.name} color={avatarColor} size="xl" src={avatarUrl} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                title="Change profile picture"
              >
                {uploadingAvatar ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Camera className="h-5 w-5" />
                )}
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleAvatarUpload}
                className="hidden"
                accept="image/*"
              />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{name || user.name}</p>
              <p className="text-xs text-muted-foreground">@{username || user.username}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>
              {avatarUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 text-xs text-destructive hover:text-destructive"
                  onClick={() => setAvatarUrl(null)}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Remove picture
                </Button>
              )}
            </div>
          </div>

          {/* Avatar color picker (only shown when no profile picture) */}
          {!avatarUrl && (
            <div className="space-y-2">
              <Label>Avatar color</Label>
              <div className="flex flex-wrap gap-2">
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setAvatarColor(color)}
                    className={cn(
                      'h-8 w-8 rounded-full flex items-center justify-center transition-transform hover:scale-110',
                      avatarColor === color && 'ring-2 ring-offset-2 ring-foreground'
                    )}
                    style={{ backgroundColor: color }}
                  >
                    {avatarColor === color && <Check className="h-4 w-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="p-name">Full name</Label>
            <Input
              id="p-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-username">Username</Label>
            <Input
              id="p-username"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              maxLength={20}
              className="font-mono"
            />
            <p className="text-[11px] text-muted-foreground">Lowercase letters, numbers, underscores.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-bio">Bio</Label>
            <Textarea
              id="p-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={280}
              rows={3}
              placeholder="Tell us about yourself..."
            />
            <p className="text-[11px] text-muted-foreground text-right">{bio.length}/280</p>
          </div>

          {/* Push notifications */}
          <div className="space-y-2 pt-2 border-t">
            <Label>Notifications</Label>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2">
                {pushEnabled ? (
                  <Bell className="h-4 w-4 text-accent-foreground" />
                ) : (
                  <BellOff className="h-4 w-4 text-muted-foreground" />
                )}
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Push notifications
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {push.permission === 'unsupported'
                      ? 'Not supported in this browser'
                      : pushEnabled
                      ? 'Enabled — get notified of new messages'
                      : 'Get notified when this tab is in the background'}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant={pushEnabled ? 'outline' : 'default'}
                size="sm"
                onClick={handleTogglePush}
                disabled={push.permission === 'unsupported' || push.permission === 'denied'}
                className="h-8"
              >
                {pushEnabled ? 'Disable' : 'Enable'}
              </Button>
            </div>
            {push.permission === 'denied' && (
              <p className="text-[11px] text-destructive">
                Notifications are blocked. Please enable them in your browser's site settings.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary hover:bg-[#C87D12] text-primary-foreground font-semibold"
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
