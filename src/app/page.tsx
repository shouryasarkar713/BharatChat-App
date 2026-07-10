'use client'

import { useSession } from 'next-auth/react'
import { AuthScreen } from '@/components/chat/auth-screen'
import { ChatApp } from '@/components/chat/chat-app'

export default function Home() {
  const { status } = useSession()

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="h-8 w-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (status !== 'authenticated') {
    return <AuthScreen />
  }

  return <ChatApp />
}
