import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '@/lib/db'

const AVATAR_COLORS = ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']

const registerSchema = z.object({
  name: z.string().min(1).max(60),
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
  email: z.string().email(),
  password: z.string().min(6).max(100),
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      )
    }
    const { name, username, email, password } = parsed.data
    const lowerEmail = email.toLowerCase()
    const lowerUsername = username.toLowerCase()

    const existing = await db.user.findFirst({
      where: {
        OR: [{ email: lowerEmail }, { username: lowerUsername }],
      },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'Email or username already in use' },
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await db.user.create({
      data: {
        name,
        username: lowerUsername,
        email: lowerEmail,
        passwordHash,
        avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      },
    })

    return NextResponse.json({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      avatarColor: user.avatarColor,
    })
  } catch (e) {
    console.error('register error', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
