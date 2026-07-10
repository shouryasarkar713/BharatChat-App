import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'

const AVATAR_COLORS = ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#0ea5e9', '#6366f1', '#84cc16']

const profileSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/).optional(),
  bio: z.string().max(280).nullable().optional(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
})

// PATCH /api/users/me/profile — update current user's profile
export async function PATCH(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const parsed = profileSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const data = parsed.data
  const updates: any = {}
  if (data.name !== undefined) updates.name = data.name
  if (data.bio !== undefined) updates.bio = data.bio
  if (data.avatarColor !== undefined) updates.avatarColor = data.avatarColor
  if (data.avatarUrl !== undefined) updates.avatarUrl = data.avatarUrl

  // Username change requires uniqueness check
  if (data.username !== undefined) {
    const lowerUsername = data.username.toLowerCase()
    if (lowerUsername !== user.name) {
      const existing = await db.user.findFirst({
        where: {
          username: lowerUsername,
          id: { not: user.id },
        },
      })
      if (existing) {
        return NextResponse.json(
          { error: 'Username already taken' },
          { status: 409 }
        )
      }
    }
    updates.username = lowerUsername
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, message: 'No changes' })
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: updates,
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      avatarColor: true,
      avatarUrl: true,
      bio: true,
      lastSeenAt: true,
    },
  })

  return NextResponse.json(updated)
}

export { AVATAR_COLORS }
