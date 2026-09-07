describe('Self-Destruct / Burn-After-Reading Logic', () => {
  it('correctly calculates remaining burn time', () => {
    const burnDuration = 30
    const now = Date.now()
    const createdAt = new Date(now - 10 * 1000).toISOString() // 10s ago

    const elapsed = Math.floor((now - new Date(createdAt).getTime()) / 1000)
    const remaining = Math.max(0, burnDuration - elapsed)

    expect(remaining).toBe(20)
  })

  it('clamps remaining burn time to 0 when expired', () => {
    const burnDuration = 10
    const now = Date.now()
    const createdAt = new Date(now - 15 * 1000).toISOString() // 15s ago

    const elapsed = Math.floor((now - new Date(createdAt).getTime()) / 1000)
    const remaining = Math.max(0, burnDuration - elapsed)

    expect(remaining).toBe(0)
  })

  it('serializes and parses burnAfterSeconds in attachment JSON correctly', () => {
    const attachment = {
      burnAfterSeconds: 30,
    }

    const serialized = JSON.stringify(attachment)
    const parsed = JSON.parse(serialized)

    expect(parsed.burnAfterSeconds).toBe(30)
    expect(parsed.url).toBeUndefined()
  })

  it('preserves file attachment properties when self-destruct is combined with file', () => {
    const fileAttachment = {
      url: 'https://example.com/sensitive-doc.pdf',
      name: 'sensitive-doc.pdf',
      size: 1024,
      mimeType: 'application/pdf',
      burnAfterSeconds: 60,
    }

    const serialized = JSON.stringify(fileAttachment)
    const parsed = JSON.parse(serialized)

    expect(parsed.url).toBe('https://example.com/sensitive-doc.pdf')
    expect(parsed.name).toBe('sensitive-doc.pdf')
    expect(parsed.burnAfterSeconds).toBe(60)
  })
})
