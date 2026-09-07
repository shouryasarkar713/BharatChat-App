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
    select: { id: true, senderId: true, conversationId: true, deletedAt: true, attachment: true },
  })

  if (!message) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  // Allow sender OR conversation members if requested (e.g. self-destruct countdown)
  const isSender = message.senderId === user.id
  if (!isSender) {
    // Check if user is a member of this conversation
    const membership = await db.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: message.conversationId, userId: user.id } },
    })
    if (!membership) {
      return NextResponse.json(
        { error: 'You can only delete messages in your own conversations' },
        { status: 403 }
      )
    }
  }

  if (message.deletedAt) {
    return NextResponse.json({ ok: true, alreadyDeleted: true })
  }

  let wasBurn = false
  // Hard-purge: If message had an uploaded binary file, remove from db.upload
  if (message.attachment) {
    try {
      const att = JSON.parse(message.attachment)
      if (att?.burnAfterSeconds) {
        wasBurn = true
      }
      if (att?.url && typeof att.url === 'string' && att.url.startsWith('/api/uploads/')) {
        const fileId = att.url.replace('/api/uploads/', '')
        if (fileId) {
          await db.upload.delete({ where: { id: fileId } }).catch(() => {})
        }
      }
    } catch {}
  }

  // Wipe content and attachment completely from the database
  await db.message.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      content: '',
      attachment: null,
    },
  })

  return NextResponse.json({ ok: true, deletedAt: new Date().toISOString(), wasBurn })
}
