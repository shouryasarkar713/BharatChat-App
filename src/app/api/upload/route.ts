import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'

function getContentType(mimeType: string, filename: string): string {
  const lowerName = filename.toLowerCase()
  if (mimeType.startsWith('image/')) return 'IMAGE'
  if (mimeType.startsWith('video/')) return 'VIDEO'
  if (mimeType.startsWith('audio/') || lowerName.endsWith('.webm') || lowerName.endsWith('.wav') || lowerName.endsWith('.mp3') || lowerName.endsWith('.ogg')) return 'AUDIO'
  return 'FILE'
}

async function ensureUploadTableExists() {
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Upload" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "mimeType" TEXT NOT NULL,
        "size" INTEGER NOT NULL,
        "data" BYTEA NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
      );
    `);
  } catch (err) {
    console.error('Failed to create Upload table:', err)
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Ensure the table exists in database
    await ensureUploadTableExists()

    const ext = file.name ? (file.name.includes('.') ? file.name.substring(file.name.lastIndexOf('.')) : '.bin') : '.bin'
    const uniqueId = uuidv4()
    const uniqueName = `${uniqueId}${ext}`

    // Save file data to database
    await db.upload.create({
      data: {
        id: uniqueName,
        name: file.name || 'file',
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        data: buffer
      }
    })

    const contentType = getContentType(file.type || 'application/octet-stream', file.name || '')

    return NextResponse.json({
      url: `/api/uploads/${uniqueName}`,
      name: file.name || 'file',
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      contentType: contentType
    })
  } catch (error: any) {
    console.error('Upload API Error:', error)
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
  }
}
