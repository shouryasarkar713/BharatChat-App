import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'

// POST /api/users/key — publish the current user's RSA public key (base64 SPKI)
// Used for E2E key wrapping when distributing conversation AES keys.
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const body = await req.json()
  const { publicKey } = body as { publicKey?: string }
  if (!publicKey || typeof publicKey !== 'string') {
    return NextResponse.json({ error: 'publicKey required' }, { status: 400 })
  }
  await db.user.update({
    where: { id: user.id },
    data: { publicKey },
  })
  return NextResponse.json({ ok: true })
}

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
