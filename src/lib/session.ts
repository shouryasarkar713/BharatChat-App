import { getServerSession } from 'next-auth'
import { authOptions } from './auth'
import { db } from './db'
import { NextResponse } from 'next/server'

export async function getCurrentUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  const userId = (session.user as any).id as string | undefined
  if (!userId) return null
  return db.user.findUnique({ where: { id: userId } })
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
