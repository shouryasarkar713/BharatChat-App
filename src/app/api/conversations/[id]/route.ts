import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'

// GET /api/conversations/[id] — conversation detail + members
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const { id } = await params

  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: id, userId: user.id } },
    include: {
      conversation: {
        include: {
          members: { include: { user: true } },
        },
      },
    },
  })
  if (!membership) {
    return NextResponse.json({ error: 'Not a member' }, { status: 403 })
  }

  const conv = membership.conversation
  const otherMembers = conv.members.filter((m) => m.userId !== user.id)
  return NextResponse.json({
    id: conv.id,
    type: conv.type,
    name: conv.type === 'GROUP' ? conv.name : otherMembers[0]?.user.name,
    avatarColor: conv.avatarColor,
    members: conv.members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      username: m.user.username,
      avatarColor: m.user.avatarColor,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      lastSeenAt: m.user.lastSeenAt,
    })),
    lastReadAt: membership.lastReadAt,
    createdAt: conv.createdAt,
  })
}

// PATCH /api/conversations/[id] — rename group / update avatar color
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const { id } = await params
  const body = await req.json()
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: id, userId: user.id } },
  })
  if (!membership) {
    return NextResponse.json({ error: 'Not a member' }, { status: 403 })
  }
  const updated = await db.conversation.update({
    where: { id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.avatarColor ? { avatarColor: body.avatarColor } : {}),
      updatedAt: new Date(),
    },
  })
  return NextResponse.json({ id: updated.id })
}
