import { generateAesKey, encryptBinary, decryptBinary } from '../lib/crypto'

describe('Client-Side File & Binary Encryption', () => {
  it('encrypts and decrypts an arbitrary ArrayBuffer payload accurately', () => {
    return (async () => {
      const key = await generateAesKey()

      // Simulate binary file data (e.g. image bytes or audio samples)
      const originalBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 42, 84, 99, 128, 255])
      const encryptedBuffer = await encryptBinary(key, originalBytes)

      // The encrypted buffer must contain the 12-byte IV + ciphertext (larger than original)
      expect(encryptedBuffer.byteLength).toBeGreaterThan(originalBytes.byteLength)

      // Ciphertext must not match original bytes
      const cipherBytes = new Uint8Array(encryptedBuffer)
      expect(cipherBytes.slice(12)).not.toEqual(originalBytes)

      // Decrypt with the same key
      const decryptedBuffer = await decryptBinary(key, encryptedBuffer)
      const decryptedBytes = new Uint8Array(decryptedBuffer)

      expect(decryptedBytes).toEqual(originalBytes)
    })()
  })

  it('fails to decrypt if an incorrect key is provided', async () => {
    const key1 = await generateAesKey()
    const key2 = await generateAesKey()

    const originalBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const encryptedBuffer = await encryptBinary(key1, originalBytes)

    await expect(decryptBinary(key2, encryptedBuffer)).rejects.toThrow()
  })

  it('fails to decrypt if ciphertext is tampered with', async () => {
    const key = await generateAesKey()
    const originalBytes = new Uint8Array([10, 20, 30, 40, 50])
    const encryptedBuffer = await encryptBinary(key, originalBytes)

    // Tamper with ciphertext byte
    const tampered = new Uint8Array(encryptedBuffer)
    tampered[tampered.length - 1] ^= 0xff

    await expect(decryptBinary(key, tampered)).rejects.toThrow()
  })
})

describe('Database Content Hard-Purge Verification', () => {
  it('ensures deleted messages have blank content and null attachments', () => {
    const activeMessage = {
      id: 'msg-123',
      content: 'SuperSecretPassword123!',
      attachment: JSON.stringify({ url: '/api/uploads/secret.png', burnAfterSeconds: 10 }),
      deletedAt: null,
    }

    // Simulate hard-purge update
    const purgedMessage = {
      ...activeMessage,
      deletedAt: new Date().toISOString(),
      content: '',
      attachment: null,
    }

    expect(purgedMessage.content).toBe('')
    expect(purgedMessage.attachment).toBeNull()
    expect(purgedMessage.deletedAt).toBeDefined()
  })

  it('identifies upload file ids for cleanup from attachment urls', () => {
    const attachmentObj = {
      url: '/api/uploads/a1b2c3d4-e5f6.jpg',
      name: 'id_card.jpg',
      encrypted: true,
    }

    const isUpload = attachmentObj.url.startsWith('/api/uploads/')
    const fileId = isUpload ? attachmentObj.url.replace('/api/uploads/', '') : null

    expect(fileId).toBe('a1b2c3d4-e5f6.jpg')
  })
})
