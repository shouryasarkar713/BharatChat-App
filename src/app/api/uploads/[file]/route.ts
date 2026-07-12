import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const MIME_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.webm': 'audio/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params
  if (!/^[a-zA-Z0-9-]+\.[a-zA-Z0-9]+$/.test(file)) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  }

  await ensureUploadTableExists()

  try {
    const upload = await db.upload.findUnique({
      where: { id: file }
    })
    if (!upload) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    return new NextResponse(upload.data, {
      headers: {
        'Content-Type': upload.mimeType,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (error) {
    console.error('File retrieve error:', error)
    return NextResponse.json({ error: 'File retrieve failed' }, { status: 500 })
  }
}
