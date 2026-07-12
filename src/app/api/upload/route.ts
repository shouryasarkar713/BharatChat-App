import { NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import os from 'os'
import { v4 as uuidv4 } from 'uuid'

const UPLOAD_DIR = process.env.VERCEL || process.env.NODE_ENV === 'production'
  ? path.join(os.tmpdir(), 'uploads')
  : path.join(process.cwd(), 'uploads')

function getContentType(mimeType: string, filename: string): string {
  const lowerName = filename.toLowerCase()
  if (mimeType.startsWith('image/')) return 'IMAGE'
  if (mimeType.startsWith('video/')) return 'VIDEO'
  if (mimeType.startsWith('audio/') || lowerName.endsWith('.webm') || lowerName.endsWith('.wav') || lowerName.endsWith('.mp3') || lowerName.endsWith('.ogg')) return 'AUDIO'
  return 'FILE'
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

    // Ensure upload directory exists
    await mkdir(UPLOAD_DIR, { recursive: true })

    const ext = path.extname(file.name) || '.bin'
    // Generate unique file name
    const uniqueName = `${uuidv4()}${ext}`
    const filePath = path.join(UPLOAD_DIR, uniqueName)

    await writeFile(filePath, buffer)

    const contentType = getContentType(file.type, file.name)

    return NextResponse.json({
      url: `/api/uploads/${uniqueName}`,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      contentType: contentType
    })
  } catch (error: any) {
    console.error('Upload API Error:', error)
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
  }
}
