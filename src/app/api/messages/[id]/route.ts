import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'

// DELETE /api/messages/[id] — soft-delete a message (sender only)
// Sets deletedAt but keeps the row for audit purposes
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const { id } = await params

  const message = await db.message.findUnique({
    where: { id },
    select: { id: true, senderId: true, deletedAt: true },
  })

  if (!message) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  if (message.senderId !== user.id) {
    return NextResponse.json(
      { error: 'You can only delete your own messages' },
      { status: 403 }
    )
  }

  if (message.deletedAt) {
    return NextResponse.json({ ok: true, alreadyDeleted: true })
  }

  await db.message.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  return NextResponse.json({ ok: true, deletedAt: new Date().toISOString() })
}
