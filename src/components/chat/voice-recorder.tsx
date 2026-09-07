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
    encrypted?: boolean
  }) => Promise<void>
  disabled?: boolean
  onStateChange?: (state: RecorderState) => void
  onUploadVoice?: (blob: Blob, filename: string) => Promise<{ url: string; encrypted: boolean; size: number } | null>
}

type RecorderState = 'idle' | 'recording' | 'recorded' | 'uploading'

export function VoiceRecorder({ onSend, disabled, onStateChange }: VoiceRecorderProps) {
  const [state, setState] = useState<RecorderState>('idle')
  const [duration, setDuration] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  const updateState = useCallback(
    (nextState: RecorderState) => {
      setState(nextState)
      onStateChange?.(nextState)
    },
    [onStateChange]
  )

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
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
        setAudioBlob(blob)
        setAudioUrl(URL.createObjectURL(blob))
        const exact = await getAudioDuration(blob)
        if (exact > 0) {
          setDuration(Math.round(exact))
        }
      }

      recorder.start()
      startTimeRef.current = Date.now()
      setDuration(0)
      updateState('recording')

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
      updateState('idle')
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (timerRef.current) clearInterval(timerRef.current)
    // Don't stop tracks yet — we need them until onstop fires
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    updateState('recorded')
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
    updateState('idle')
  }

  async function sendVoiceMessage() {
    if (!audioBlob) return
    updateState('uploading')
    try {
      const ext = audioBlob.type.includes('webm') ? 'webm' : audioBlob.type.includes('mp4') ? 'mp4' : 'ogg'
      const filename = `voice-${Date.now()}.${ext}`
      let data: any

      if (onUploadVoice) {
        const uploadResult = await onUploadVoice(audioBlob, filename)
        if (!uploadResult) {
          toast.error('Voice encryption failed')
          updateState('recorded')
          return
        }
        data = {
          url: uploadResult.url,
          name: filename,
          size: uploadResult.size,
          mimeType: audioBlob.type || 'audio/webm',
          contentType: 'AUDIO',
          encrypted: uploadResult.encrypted,
        }
      } else {
        const file = new File([audioBlob], filename, { type: audioBlob.type })
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch('/api/upload', { method: 'POST', body: fd })
        data = await res.json()
        if (!res.ok) {
          toast.error('Upload failed', { description: data.error })
          updateState('recorded')
          return
        }
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
      updateState('idle')
    } catch (e: any) {
      toast.error('Failed to send voice message')
      updateState('recorded')
    }
  }

  if (state === 'idle') {
    return (
      <Button
        variant="outline"
        size="icon"
        type="button"
        className="flex-shrink-0 h-9.5 w-9.5 rounded-xl border-border/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-all duration-150 bg-transparent shadow-none cursor-pointer"
        onClick={startRecording}
        disabled={disabled}
        title="Record voice message"
      >
        <Mic className="h-4.5 w-4.5" />
      </Button>
    )
  }

  if (state === 'recording') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-xl w-full min-w-0 overflow-hidden animate-in fade-in duration-150">
        <span className="h-2.5 w-2.5 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
        <span className="text-xs sm:text-sm font-mono text-red-600 dark:text-red-400 font-semibold flex-shrink-0">
          {formatDuration(duration)}
        </span>
        <span className="text-[11px] sm:text-xs text-red-600/90 dark:text-red-400/90 flex-1 truncate">
          Recording...
        </span>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={cancelRecording}
          className="h-7 px-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg flex-shrink-0 cursor-pointer"
          title="Cancel recording"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          type="button"
          onClick={stopRecording}
          className="h-7 px-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg flex-shrink-0 font-medium text-xs shadow-sm cursor-pointer"
        >
          <Square className="h-3 w-3 mr-1 fill-current" />
          Stop
        </Button>
      </div>
    )
  }

  if (state === 'recorded' || state === 'uploading') {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-card border border-border/50 rounded-xl w-full min-w-0 overflow-hidden shadow-xs animate-in fade-in duration-150">
        <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Mic className="h-3.5 w-3.5 text-primary" />
        </div>
        <span className="text-xs font-mono font-semibold text-foreground flex-shrink-0">
          {formatDuration(duration)}
        </span>
        {audioUrl && (
          <audio src={audioUrl} controls className="flex-1 h-7 min-w-0 max-w-[120px] xs:max-w-[170px] sm:max-w-[220px]" />
        )}
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={cancelRecording}
          disabled={state === 'uploading'}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg flex-shrink-0 cursor-pointer"
          title="Discard recording"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          type="button"
          onClick={sendVoiceMessage}
          disabled={state === 'uploading'}
          className="h-7 px-3 bg-primary hover:bg-[#C87D12] text-primary-foreground font-semibold rounded-lg flex-shrink-0 text-xs shadow-sm cursor-pointer"
        >
          {state === 'uploading' ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5 mr-1" />
          )}
          <span>{state === 'uploading' ? 'Sending...' : 'Send'}</span>
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

async function getAudioDuration(blob: Blob): Promise<number> {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContextClass) return 0
    const audioCtx = new AudioContextClass()
    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
    audioCtx.close()
    return audioBuffer.duration
  } catch (e) {
    console.error('Failed to decode audio duration via AudioContext:', e)
    return 0
  }
}
