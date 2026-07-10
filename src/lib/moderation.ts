// Simple moderation: blocklist + simple spam/length checks.
// In production, replace with a real moderation service (Perspective API, OpenAI moderation, etc.).

const BLOCKLIST = [
  'fuck', 'shit', 'bitch', 'asshole', 'dick', 'cunt', 'nigger', 'faggot',
  'retard', 'whore', 'slut',
]

export interface ModerationResult {
  status: 'APPROVED' | 'FLAGGED' | 'BLOCKED'
  reason?: string
  cleaned?: string
}

export function moderateMessage(content: string): ModerationResult {
  if (!content || !content.trim()) {
    return { status: 'BLOCKED', reason: 'Empty message' }
  }
  if (content.length > 8000) {
    return { status: 'BLOCKED', reason: 'Message exceeds 8000 chars' }
  }
  const lower = content.toLowerCase()
  const hits = BLOCKLIST.filter((w) => lower.includes(w))
  if (hits.length === 0) return { status: 'APPROVED' }

  // Censor the words but still let the message through with FLAGGED status.
  let cleaned = content
  for (const w of hits) {
    const re = new RegExp(w, 'gi')
    cleaned = cleaned.replace(re, '*'.repeat(w.length))
  }
  return {
    status: hits.length >= 3 ? 'BLOCKED' : 'FLAGGED',
    reason: `Contains ${hits.length} blocked word(s): ${hits.join(', ')}`,
    cleaned,
  }
}
