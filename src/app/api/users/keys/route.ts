import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'

// GET /api/users/keys?ids=u1,u2 — fetch public keys for a list of users
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const url = new URL(req.url)
  const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean)
  if (ids.length === 0) return NextResponse.json({ keys: {} })
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, publicKey: true },
  })
  const keys: Record<string, string | null> = {}
  for (const u of users) keys[u.id] = u.publicKey
  return NextResponse.json({ keys })
}
