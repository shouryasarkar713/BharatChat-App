import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'

// GET /api/users/me — current user's full profile
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const full = await db.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      avatarColor: true,
      avatarUrl: true,
      bio: true,
      lastSeenAt: true,
      createdAt: true,
    },
  })
  if (!full) return unauthorized()
  return NextResponse.json(full)
}
