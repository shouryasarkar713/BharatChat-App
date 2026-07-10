'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Mic, Square, Send, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface VoiceRecorderProps {
  onSend: (attachment: {
    url: string
    name: string
    size: number
    mimeType: string
    contentType: string
    duration: number
  }) => Promise<void>
  disabled?: boolean
}

type RecorderState = 'idle' | 'recording' | 'recorded' | 'uploading'

export function VoiceRecorder({ onSend, disabled }: VoiceRecorderProps) {
  const [state, setState] = useState<RecorderState>('idle')
  const [duration, setDuration] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null
      mediaRecorderRef.current.onstop = null
      mediaRecorderRef.current = null
    }
    chunksRef.current = []
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return cleanup
  }, [cleanup])

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      // Pick a supported mime type
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
        setAudioBlob(blob)
        setAudioUrl(URL.createObjectURL(blob))
      }

      recorder.start()
      startTimeRef.current = Date.now()
      setDuration(0)
      setState('recording')

      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 250)
    } catch (e: any) {
      console.error('mic error', e)
      if (e.name === 'NotAllowedError') {
        toast.error('Microphone permission denied', {
          description: 'Please allow microphone access to record voice messages.',
        })
      } else {
        toast.error('Failed to start recording', { description: e.message })
      }
      cleanup()
      setState('idle')
    }
  }

  async function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (timerRef.current) clearInterval(timerRef.current)
    // Don't stop tracks yet — we need them until onstop fires
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setState('recorded')
  }

  function cancelRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    cleanup()
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(null)
    setAudioUrl(null)
    setDuration(0)
    setState('idle')
  }

  async function sendVoiceMessage() {
    if (!audioBlob) return
    setState('uploading')
    try {
      const ext = audioBlob.type.includes('webm') ? 'webm' : audioBlob.type.includes('mp4') ? 'mp4' : 'ogg'
      const file = new File([audioBlob], `voice-${Date.now()}.${ext}`, { type: audioBlob.type })
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        toast.error('Upload failed', { description: data.error })
        setState('recorded')
        return
      }
      await onSend({
        ...data,
        contentType: 'AUDIO',
        duration,
      })
      // Reset
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      setAudioBlob(null)
      setAudioUrl(null)
      setDuration(0)
      setState('idle')
    } catch (e: any) {
      toast.error('Failed to send voice message')
      setState('recorded')
    }
  }

  if (state === 'idle') {
    return (
      <Button
        variant="outline"
        size="icon"
        className="flex-shrink-0 h-10 w-10 border-slate-200"
        onClick={startRecording}
        disabled={disabled}
        title="Record voice message"
      >
        <Mic className="h-4 w-4" />
      </Button>
    )
  }

  if (state === 'recording') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg flex-1">
        <span className="h-2.5 w-2.5 bg-red-500 rounded-full animate-pulse" />
        <span className="text-sm font-mono text-red-700">{formatDuration(duration)}</span>
        <span className="text-xs text-red-600 flex-1">Recording...</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={cancelRecording}
          className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-100"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          onClick={stopRecording}
          className="h-7 px-2 bg-red-600 hover:bg-red-700"
        >
          <Square className="h-3 w-3 mr-1" />
          Stop
        </Button>
      </div>
    )
  }

  if (state === 'recorded' || state === 'uploading') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg flex-1">
        <Mic className="h-4 w-4 text-emerald-600 flex-shrink-0" />
        <span className="text-sm font-mono text-emerald-700">{formatDuration(duration)}</span>
        {audioUrl && (
          <audio src={audioUrl} controls className="flex-1 h-7 min-w-0" style={{ maxWidth: '200px' }} />
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={cancelRecording}
          disabled={state === 'uploading'}
          className="h-7 px-2 text-slate-500 hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          onClick={sendVoiceMessage}
          disabled={state === 'uploading'}
          className="h-7 px-3 bg-emerald-600 hover:bg-emerald-700"
        >
          {state === 'uploading' ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5 mr-1" />
          )}
          {state === 'uploading' ? 'Sending...' : 'Send'}
        </Button>
      </div>
    )
  }

  return null
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c
  }
  return undefined
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}
