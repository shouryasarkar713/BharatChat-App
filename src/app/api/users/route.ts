import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'

// GET /api/users?q=<query> — search users by name/username for adding to conversations
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').trim().toLowerCase()
  if (!q || q.length < 1) {
    return NextResponse.json({ users: [] })
  }
  const users = await db.user.findMany({
    where: {
      AND: [
        { id: { not: user.id } },
        {
          OR: [
            { name: { contains: q } },
            { username: { contains: q } },
            { email: { contains: q } },
          ],
        },
      ],
    },
    take: 20,
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      avatarColor: true,
      lastSeenAt: true,
    },
  })
  return NextResponse.json({ users })
}
