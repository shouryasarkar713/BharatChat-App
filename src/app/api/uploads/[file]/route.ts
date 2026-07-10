import { readFile, stat } from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'

const UPLOAD_DIR = path.join(process.cwd(), 'uploads')

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
  '.webm': 'audio/webm', // voice messages from MediaRecorder are audio/webm
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params
  // Sanitize: only allow simple filenames (UUID + extension)
  if (!/^[a-zA-Z0-9-]+\.[a-zA-Z0-9]+$/.test(file)) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  }
  const filePath = path.join(UPLOAD_DIR, file)
  try {
    const data = await readFile(filePath)
    const ext = path.extname(file).toLowerCase()
    const mime = MIME_EXT[ext] || 'application/octet-stream'
    return new NextResponse(data as any, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
