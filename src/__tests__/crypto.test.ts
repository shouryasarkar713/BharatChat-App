import {
  generateAesKey,
  exportAesKeyB64,
  importAesKeyB64,
  encryptMessage,
  decryptMessage,
} from '../lib/crypto'

describe('Crypto E2E Helpers', () => {
  it('should generate an AES CryptoKey', async () => {
    const key = await generateAesKey()
    expect(key).toBeDefined()
    expect(key.type).toBe('secret')
    expect(key.algorithm.name).toBe('AES-GCM')
  })

  it('should export and import an AES key to/from base64', async () => {
    const originalKey = await generateAesKey()
    const b64 = await exportAesKeyB64(originalKey)
    expect(typeof b64).toBe('string')
    expect(b64.length).toBeGreaterThan(0)

    const importedKey = await importAesKeyB64(b64)
    expect(importedKey).toBeDefined()
    expect(importedKey.type).toBe('secret')
    expect(importedKey.algorithm.name).toBe('AES-GCM')
  })

  it('should successfully encrypt and decrypt a message', async () => {
    const aesKey = await generateAesKey()
    const plaintext = 'Secret BharatChat Message!'

    const ciphertext = await encryptMessage(aesKey, plaintext)
    expect(typeof ciphertext).toBe('string')
    expect(ciphertext).not.toBe(plaintext)

    const decrypted = await decryptMessage(aesKey, ciphertext)
    expect(decrypted).toBe(plaintext)
  })
})
