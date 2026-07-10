'use client'

import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null
let connectingUserId: string | null = null

const CHAT_PORT = 3003

export async function getSocket(userId: string): Promise<Socket> {
  if (socket && connectingUserId === userId && socket.connected) {
    return socket
  }
  if (socket) {
    socket.disconnect()
    socket = null
  }
  connectingUserId = userId

  let socketUrl: string | undefined = undefined
  if (typeof window !== 'undefined' && window.location.port === '3000') {
    socketUrl = 'http://127.0.0.1:3003'
  }
  socket = io(socketUrl, {
    path: '/',
    transports: ['websocket'],
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 15000,
    query: { XTransformPort: CHAT_PORT },
  })

  socket.on('connect_error', (err: any) => {
    console.error('[socket] connect_error', err.message)
  })
  socket.on('disconnect', (reason: string) => console.log('[socket] disconnected', reason))

  // Auto-join on connect
  const joinHandler = () => {
    socket?.emit('user:join', { userId })
  }
  socket.on('connect', joinHandler)
  socket.on('reconnect', joinHandler)

  // If already connected (rare race), emit immediately
  if (socket.connected) {
    joinHandler()
  }

  return socket
}

export function getExistingSocket(): Socket | null {
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
    connectingUserId = null
  }
}
