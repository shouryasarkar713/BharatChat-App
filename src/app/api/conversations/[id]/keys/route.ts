import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'

// GET /api/conversations/[id]/keys — fetch wrapped AES key for the current user
// (the wrapped key is stored per-member when the conversation is created)
// The conversation key is stored encrypted
// with each member's RSA public key. If no key exists yet, the current user
// generates one and wraps it for all members.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const { id } = await params

  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: id, userId: user.id } },
  })
  if (!membership) {
    return NextResponse.json({ error: 'Not a member' }, { status: 403 })
  }

  return NextResponse.json({ conversationId: id })
}
