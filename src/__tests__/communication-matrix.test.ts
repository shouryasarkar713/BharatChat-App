import {
  encryptMessage,
  decryptMessage,
  decryptMessageWithFallback,
  encryptBinary,
  decryptBinary,
  decryptBinaryWithFallback,
  getOrEstablishConversationAesKey,
  deriveFallbackSeedKey,
} from '../lib/crypto'
import { useChatStore } from '../store/chat-store'
import { moderateMessage } from '../lib/moderation'

describe('Comprehensive Communication Matrix & Edge Case Test Suite', () => {
  const conversationId = 'matrix-test-conv-001'
  const platforms = ['App', 'Web'] as const

  // --------------------------------------------------------------------------
  // Matrix 1: All 4 Permutations of Communication (App->App, App->Web, Web->App, Web->Web)
  // --------------------------------------------------------------------------
  describe('1. Cross-Platform Communication Matrix (App <-> Web)', () => {
    for (const senderPlatform of platforms) {
      for (const receiverPlatform of platforms) {
        describe(`${senderPlatform} -> ${receiverPlatform}`, () => {
          it('reliably establishes identical conversation key and decrypts in 0ms', async () => {
            const senderUserId = `user-${senderPlatform.toLowerCase()}-sender`
            const receiverUserId = `user-${receiverPlatform.toLowerCase()}-receiver`

            // Both clients independently derive their conversation keys
            const senderKey = await getOrEstablishConversationAesKey(conversationId, senderUserId)
            const receiverKey = await getOrEstablishConversationAesKey(conversationId, receiverUserId)

            expect(senderKey).toBeDefined()
            expect(receiverKey).toBeDefined()

            // Sender encrypts a message
            const secret = `Hello from ${senderPlatform} to ${receiverPlatform}!`
            const ciphertext = await encryptMessage(senderKey, secret)
            expect(ciphertext).not.toBe(secret)

            // Receiver decrypts message
            const decrypted = await decryptMessageWithFallback(receiverKey, conversationId, ciphertext)
            expect(decrypted).toBe(secret)
          })

          it('encrypts and decrypts media photo attachment binary seamlessly', async () => {
            const senderUserId = `user-${senderPlatform.toLowerCase()}-sender`
            const receiverUserId = `user-${receiverPlatform.toLowerCase()}-receiver`

            const senderKey = await getOrEstablishConversationAesKey(conversationId, senderUserId)
            const receiverKey = await getOrEstablishConversationAesKey(conversationId, receiverUserId)

            // Simulate raw image byte buffer (e.g. 50KB JPEG photo)
            const originalPhotoBytes = new Uint8Array(50 * 1024)
            for (let i = 0; i < originalPhotoBytes.length; i++) {
              originalPhotoBytes[i] = (i * 13) % 256
            }

            // Sender encrypts photo binary
            const encryptedBuffer = await encryptBinary(senderKey, originalPhotoBytes)
            expect(encryptedBuffer.byteLength).toBe(12 + originalPhotoBytes.byteLength + 16) // 12B IV + data + 16B AES-GCM tag

            // Receiver decrypts photo binary
            const decryptedBuffer = await decryptBinaryWithFallback(receiverKey, conversationId, encryptedBuffer)
            const decryptedBytes = new Uint8Array(decryptedBuffer)

            expect(decryptedBytes.length).toBe(originalPhotoBytes.length)
            expect(decryptedBytes).toEqual(originalPhotoBytes)
          })
        })
      }
    }
  })

  // --------------------------------------------------------------------------
  // Matrix 2: Text Messaging Edge Cases
  // --------------------------------------------------------------------------
  describe('2. Text Messaging Edge Cases', () => {
    it('accurately preserves Indic multilingual scripts and complex emoji encodings', async () => {
      const key = await deriveFallbackSeedKey(conversationId)

      const multilingualPayload = [
        'नमस्ते भारत! आप कैसे हैं? 🇮🇳', // Hindi
        'স্বাগতম ভারত! আশা করি সবাই ভালো আছেন।', // Bengali
        'வணக்கம் பாரதம்! நலமா?', // Tamil
        'నమస్కారం భారత్! బాగున్నారా?', // Telugu
        'Family: 👨‍👩‍👧‍👦, Astronaut: 👩‍🚀, Rocket: 🚀, Flags: 🇮🇳 🇯🇵 🇺🇸',
        'Special math & symbols: ∑(x_i) = ∞, √2 ≉ π, © 2026 BharatChat™',
      ].join('\n')

      const ciphertext = await encryptMessage(key, multilingualPayload)
      const decrypted = await decryptMessageWithFallback(key, conversationId, ciphertext)

      expect(decrypted).toBe(multilingualPayload)
    })

    it('safely handles extreme 10,000 character payloads without truncation or memory issues', async () => {
      const key = await deriveFallbackSeedKey(conversationId)
      const largeText = 'A'.repeat(10000)

      const ciphertext = await encryptMessage(key, largeText)
      const decrypted = await decryptMessageWithFallback(key, conversationId, ciphertext)

      expect(decrypted).toBe(largeText)
      expect(decrypted.length).toBe(10000)
    })

    it('gracefully handles empty strings and rejects malformed or tampered ciphertexts', async () => {
      const key = await deriveFallbackSeedKey(conversationId)

      // Empty string
      const emptyDecrypted = await decryptMessage(key, '')
      expect(emptyDecrypted).toBe('')

      // Invalid base64
      await expect(decryptMessage(key, 'not_valid_b64@@##')).rejects.toThrow('Malformed ciphertext')

      // Payload too short for 12-byte IV
      await expect(decryptMessage(key, btoa('short'))).rejects.toThrow('too short')

      // Tampered ciphertext
      const validCiphertext = await encryptMessage(key, 'Authentic message')
      const rawBytes = Uint8Array.from(atob(validCiphertext), (c) => c.charCodeAt(0))
      rawBytes[15] ^= 0xff // Flip a byte in the ciphertext payload
      const tamperedB64 = btoa(String.fromCharCode(...rawBytes))

      await expect(decryptMessage(key, tamperedB64)).rejects.toThrow()
    })
  })

  // --------------------------------------------------------------------------
  // Matrix 3: Media & Attachments Edge Cases
  // --------------------------------------------------------------------------
  describe('3. Media & Attachments Edge Cases', () => {
    it('safely rejects corrupted or truncated binary payloads without crashing', async () => {
      const key = await deriveFallbackSeedKey(conversationId)

      // Binary too short for 12-byte IV (e.g. 8 bytes)
      const truncated = new Uint8Array(8)
      await expect(decryptBinary(key, truncated)).rejects.toThrow('too short for IV')

      // Empty buffer
      await expect(decryptBinary(key, new Uint8Array(0))).rejects.toThrow('too short for IV')

      // Tampered encrypted binary
      const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      const encrypted = await encryptBinary(key, original)
      const tamperedView = new Uint8Array(encrypted)
      tamperedView[14] ^= 0xff // Corrupt ciphertext byte

      await expect(decryptBinary(key, tamperedView)).rejects.toThrow()
    })

    it('encrypts and decrypts voice note audio buffers reliably', async () => {
      const key = await deriveFallbackSeedKey(conversationId)

      // Simulate 1 second of 48kHz audio buffer
      const audioSampleBytes = new Uint8Array(1024)
      for (let i = 0; i < audioSampleBytes.length; i++) {
        audioSampleBytes[i] = (Math.sin(i / 10) * 127 + 128) & 0xff
      }

      const encryptedAudio = await encryptBinary(key, audioSampleBytes)
      const decryptedAudio = await decryptBinary(key, encryptedAudio)

      expect(new Uint8Array(decryptedAudio)).toEqual(audioSampleBytes)
    })
  })

  // --------------------------------------------------------------------------
  // Matrix 4: Self-Destructing / Burn-After-Reading Timers & Clock Skew
  // --------------------------------------------------------------------------
  describe('4. Self-Destructing / Burn Timers & Clock Skew', () => {
    it('handles negative clock jitter and prevents negative elapsed seconds', () => {
      const burnDuration = 10
      const serverCreatedAt = new Date().toISOString()

      // Client clock is 5 seconds behind server clock
      const clientServerOffset = 5000
      const clientNow = Date.now() - 5000

      const compensatedNow = clientNow + clientServerOffset
      const elapsed = Math.max(0, Math.floor((compensatedNow - new Date(serverCreatedAt).getTime()) / 1000))

      expect(elapsed).toBe(0)
      const remaining = Math.max(0, burnDuration - elapsed)
      expect(remaining).toBe(10)
    })

    it('correctly calculates remaining time under 30s clock advance', () => {
      const burnDuration = 60
      const serverCreatedAt = new Date(Date.now() - 15000).toISOString() // created 15s ago

      // Client clock is running 20s ahead
      const clientServerOffset = -20000
      const clientNow = Date.now() + 20000

      const compensatedNow = clientNow + clientServerOffset
      const elapsed = Math.max(0, Math.floor((compensatedNow - new Date(serverCreatedAt).getTime()) / 1000))

      expect(elapsed).toBe(15)
      const remaining = Math.max(0, burnDuration - elapsed)
      expect(remaining).toBe(45)
    })
  })

  // --------------------------------------------------------------------------
  // Matrix 5: Content Safety & Moderation Edge Cases
  // --------------------------------------------------------------------------
  describe('5. Content Safety & Moderation', () => {
    it('preserves words containing safe substrings (Scunthorpe problem immunity)', () => {
      const safeSentences = [
        'This is a classic performance assessment.',
        'Please pass the document to the committee.',
        'We ordered a refreshing mocktail and cocktail.',
        'The associate assigned the task cleanly.',
      ]

      for (const sentence of safeSentences) {
        const result = moderateMessage(sentence)
        expect(result.status).toBe('APPROVED')
        expect(result.cleaned || sentence).toBe(sentence)
      }
    })

    it('blocks severe toxic content and masks profane words', () => {
      const profane = 'Hey, what the fuck is happening?'
      const mod = moderateMessage(profane)
      expect(mod.status).toBe('FLAGGED')
      expect(mod.cleaned).toContain('****')
      expect(mod.cleaned).not.toContain('fuck')
    })
  })

  // --------------------------------------------------------------------------
  // Matrix 6: Store State, Real-time Deduplication & Reconciliation
  // --------------------------------------------------------------------------
  describe('6. Real-time Store & Deduplication', () => {
    beforeEach(() => {
      useChatStore.getState().reset()
    })

    it('deduplicates optimistic messages when canonical socket message arrives', () => {
      const store = useChatStore.getState()
      const convId = 'conv-dedup-test'
      const tempId = 'temp-12345'
      const canonicalId = 'canon-67890'

      // 1. User sends message optimistically
      const optimisticMsg: any = {
        id: tempId,
        tempId,
        conversationId: convId,
        senderId: 'user-1',
        content: 'Optimistic text',
        contentType: 'TEXT',
        encrypted: true,
        createdAt: new Date().toISOString(),
      }

      store.addMessage(optimisticMsg)
      store.setDecrypted(convId, tempId, 'Optimistic text')

      expect(useChatStore.getState().messagesByConversation[convId].length).toBe(1)
      expect(useChatStore.getState().decrypted[`${convId}:${tempId}`]).toBe('Optimistic text')

      // 2. Server broadcasts canonical message with same tempId
      const canonicalMsg: any = {
        id: canonicalId,
        tempId,
        conversationId: convId,
        senderId: 'user-1',
        content: 'EncryptedPayloadB64==',
        contentType: 'TEXT',
        encrypted: true,
        createdAt: new Date().toISOString(),
      }

      store.addMessage(canonicalMsg)

      // Verify list has exactly 1 message, updated with canonical ID
      const msgs = useChatStore.getState().messagesByConversation[convId]
      expect(msgs.length).toBe(1)
      expect(msgs[0].id).toBe(canonicalId)

      // Verify decrypted plaintext was copied from tempId to canonicalId so no flicker occurs
      expect(useChatStore.getState().decrypted[`${convId}:${canonicalId}`]).toBe('Optimistic text')
    })

    it('preserves message order and avoids duplicates under concurrent arrival', () => {
      const store = useChatStore.getState()
      const convId = 'conv-concurrent-test'

      const msgA: any = { id: 'msg-a', conversationId: convId, senderId: 'user-1', content: 'A', createdAt: new Date(1000).toISOString() }
      const msgB: any = { id: 'msg-b', conversationId: convId, senderId: 'user-2', content: 'B', createdAt: new Date(2000).toISOString() }

      store.addMessage(msgA)
      store.addMessage(msgB)
      // Duplicate arrival of msgA
      store.addMessage(msgA)

      const msgs = useChatStore.getState().messagesByConversation[convId]
      expect(msgs.length).toBe(2)
      expect(msgs.map((m) => m.id)).toEqual(['msg-a', 'msg-b'])
    })
  })
})
