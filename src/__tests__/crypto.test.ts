import {
  generateAesKey,
  exportAesKeyB64,
  importAesKeyB64,
  encryptMessage,
  decryptMessage,
  wrapAesKeyFor,
  unwrapAesKey,
  exportPublicKeyB64,
  importPublicKeyB64,
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

  it('should wrap and unwrap AES conversation keys using RSA-OAEP', async () => {
    // Generate RSA keypair for a device
    const rsaKeyPair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt']
    )

    // Export and re-import public key (as would happen across network)
    const pubB64 = await exportPublicKeyB64(rsaKeyPair.publicKey)
    expect(typeof pubB64).toBe('string')
    const importedPubKey = await importPublicKeyB64(pubB64)

    // Generate random AES conversation key
    const conversationAesKey = await generateAesKey()

    // Wrap AES key with recipient's public key
    const wrappedB64 = await wrapAesKeyFor(conversationAesKey, importedPubKey)
    expect(typeof wrappedB64).toBe('string')
    expect(wrappedB64.length).toBeGreaterThan(0)

    // Recipient unwraps with their device's private key
    const unwrappedAesKey = await unwrapAesKey(wrappedB64, rsaKeyPair.privateKey)
    expect(unwrappedAesKey).toBeDefined()

    // Verify unwrapped key can decrypt messages encrypted with original key
    const secretMsg = 'Zero-knowledge private group secret: 987654'
    const ciphertext = await encryptMessage(conversationAesKey, secretMsg)
    const decryptedMsg = await decryptMessage(unwrappedAesKey, secretMsg.length > 0 ? ciphertext : '')
    expect(decryptedMsg).toBe(secretMsg)
  }, 15000)

  it('should invalidate cached AES key when invalidateCachedAesKey is called', async () => {
    const key = await generateAesKey()
    const convId = 'test-conv-invalidation'
    const { cacheAesKey, getCachedAesKey, invalidateCachedAesKey } = await import('../lib/crypto')
    await cacheAesKey(convId, key)

    const cached = await getCachedAesKey(convId)
    expect(cached).toBeDefined()

    await invalidateCachedAesKey(convId)
    const afterInvalidation = await getCachedAesKey(convId)
    expect(afterInvalidation).toBeUndefined()
  })

  it('should allow transparent key refresh and recovery when key rotates', async () => {
    // Device A starts with key 1
    const oldKey = await generateAesKey()
    // Device B generates and wraps new key 2
    const newKey = await generateAesKey()

    const message = 'Hello after new device setup!'
    const ciphertext = await encryptMessage(newKey, message)

    // Decrypting with oldKey fails
    await expect(decryptMessage(oldKey, ciphertext)).rejects.toThrow()

    // After refreshing to newKey, decryption succeeds
    const decrypted = await decryptMessage(newKey, ciphertext)
    expect(decrypted).toBe(message)
  })
})

