import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, unauthorized } from '@/lib/session'

async function ensureConversationKeyTableExists() {
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ConversationKey" (
        "id" TEXT NOT NULL,
        "conversationId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "encryptedKey" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ConversationKey_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "ConversationKey_conversationId_userId_key" ON "ConversationKey"("conversationId", "userId");
    `);
  } catch (err) {
    console.error('Failed to ensure ConversationKey table:', err)
  }
}

// GET /api/conversations/[id]/keys — fetch wrapped AES key for the current user & member public keys
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const { id } = await params

  // Verify membership
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: id, userId: user.id } },
    include: {
      conversation: {
        include: {
          members: {
            include: {
              user: {
                select: { id: true, publicKey: true, name: true }
              }
            }
          }
        }
      }
    }
  })

  if (!membership) {
    return NextResponse.json({ error: 'Not a member' }, { status: 403 })
  }

  await ensureConversationKeyTableExists()

  // Fetch caller's wrapped key
  let callerKey: string | null = null
  try {
    const rows = await db.$queryRawUnsafe<{ encryptedKey: string }[]>(
      `SELECT "encryptedKey" FROM "ConversationKey" WHERE "conversationId" = $1 AND "userId" = $2 LIMIT 1`,
      id,
      user.id
    )
    if (rows && rows.length > 0) {
      callerKey = rows[0].encryptedKey
    }
  } catch {}

  const members = membership.conversation.members.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    publicKey: m.user.publicKey,
  }))

  return NextResponse.json({
    conversationId: id,
    encryptedKey: callerKey,
    members,
  })
}

// POST /api/conversations/[id]/keys — upload wrapped keys for conversation members
export async function POST(
  req: Request,
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

  await ensureConversationKeyTableExists()

  const body = await req.json()
  const { keys } = body as { keys: Record<string, string> } // { [userId]: wrappedKeyBase64 }
  if (!keys || typeof keys !== 'object') {
    return NextResponse.json({ error: 'keys object required' }, { status: 400 })
  }

  for (const [targetUserId, encryptedKey] of Object.entries(keys)) {
    if (typeof encryptedKey !== 'string') continue
    const rowId = `${id}_${targetUserId}`
    try {
      await db.$executeRawUnsafe(
        `INSERT INTO "ConversationKey" ("id", "conversationId", "userId", "encryptedKey")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("conversationId", "userId")
         DO UPDATE SET "encryptedKey" = EXCLUDED."encryptedKey"`,
        rowId,
        id,
        targetUserId,
        encryptedKey
      )
    } catch (e) {
      console.error(`Failed to store wrapped key for ${targetUserId}:`, e)
    }
  }

  return NextResponse.json({ ok: true })
}
