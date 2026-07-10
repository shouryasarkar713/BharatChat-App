import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

// Seed database accounts for initial verification and testing.
// Test accounts: alice@chat.dev / bob@chat.dev / carol@chat.dev  (password: password123)
export async function POST() {
  const seedUsers = [
    { name: 'Alice Chen', username: 'alice', email: 'alice@chat.dev', avatarColor: '#10b981' },
    { name: 'Bob Patel', username: 'bob', email: 'bob@chat.dev', avatarColor: '#f59e0b' },
    { name: 'Carol Diaz', username: 'carol', email: 'carol@chat.dev', avatarColor: '#8b5cf6' },
  ]
  const passwordHash = await bcrypt.hash('password123', 10)
  const created: string[] = []
  for (const u of seedUsers) {
    const existing = await db.user.findUnique({ where: { email: u.email } })
    if (existing) {
      created.push(`${u.username} (already existed)`)
      continue
    }
    await db.user.create({
      data: { ...u, passwordHash },
    })
    created.push(u.username)
  }
  return NextResponse.json({ seeded: created })
}
