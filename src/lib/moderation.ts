// Simple moderation: blocklist + simple spam/length checks.
// In production, replace with a real moderation service (Perspective API, OpenAI moderation, etc.).

const BLOCKLIST = [
  'fuck', 'shit', 'bitch', 'asshole', 'dick', 'cunt', 'nigger', 'faggot',
  'retard', 'whore', 'slut',
  'chutiya', 'madarchod', 'behenchod', 'bhosdike', 'harami', 'kamina',
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

  const hits: string[] = []
  let cleaned = content

  // Use word boundaries (\b) so innocent substrings (e.g. "Charles Dickens", "assessment") are not falsely flagged
  for (const w of BLOCKLIST) {
    const re = new RegExp(`\\b${w}\\b`, 'gi')
    if (re.test(content)) {
      hits.push(w)
      cleaned = cleaned.replace(new RegExp(`\\b${w}\\b`, 'gi'), '*'.repeat(w.length))
    }
  }

  if (hits.length === 0) return { status: 'APPROVED' }

  return {
    status: hits.length >= 3 ? 'BLOCKED' : 'FLAGGED',
    reason: `Contains ${hits.length} blocked word(s): ${hits.join(', ')}`,
    cleaned,
  }
}
