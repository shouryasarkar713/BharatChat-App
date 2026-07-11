import { moderateMessage } from '../lib/moderation'

describe('moderateMessage', () => {
  it('should approve clean messages', () => {
    const result = moderateMessage('Hello, how are you today?')
    expect(result.status).toBe('APPROVED')
    expect(result.cleaned).toBeUndefined()
  })

  it('should block empty messages', () => {
    const result = moderateMessage('   ')
    expect(result.status).toBe('BLOCKED')
    expect(result.reason).toBe('Empty message')
  })

  it('should block messages that are too long', () => {
    const longMessage = 'a'.repeat(8001)
    const result = moderateMessage(longMessage)
    expect(result.status).toBe('BLOCKED')
    expect(result.reason).toBe('Message exceeds 8000 chars')
  })

  it('should flag and censor messages with 1 or 2 blocked words', () => {
    const result = moderateMessage('This is a shit message!')
    expect(result.status).toBe('FLAGGED')
    expect(result.cleaned).toBe('This is a **** message!')
    expect(result.reason).toContain('Contains 1 blocked word')
  })

  it('should block messages with 3 or more blocked words', () => {
    const result = moderateMessage('fuck this shit and that bitch')
    expect(result.status).toBe('BLOCKED')
    expect(result.cleaned).toBe('**** this **** and that *****')
    expect(result.reason).toContain('Contains 3 blocked word(s)')
  })
})
