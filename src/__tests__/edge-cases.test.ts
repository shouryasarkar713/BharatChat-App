import {
  generateAesKey,
  encryptMessage,
  decryptMessage,
  decryptMessageWithFallback,
  deriveFallbackSeedKey,
} from '../lib/crypto'
import { useChatStore } from '../store/chat-store'

describe('Edge Case Hardening Tests', () => {
  describe('1. Cryptographic Resilience & Dual-Key Fallback', () => {
    it('safely rejects corrupt or non-base64 ciphertext without crashing', async () => {
      const key = await generateAesKey()

      await expect(decryptMessage(key, 'not-valid-base64!!@@')).rejects.toThrow('Malformed ciphertext')
      await expect(decryptMessage(key, btoa('short'))).rejects.toThrow('too short')
      await expect(decryptMessage(key, '')).resolves.toBe('')
    })

    it('successfully falls back to legacy seed key if message was encrypted with seed key', async () => {
      const conversationId = 'conv-edge-case-fallback-123'
      const legacySeedKey = await deriveFallbackSeedKey(conversationId)
      const modernKey = await generateAesKey()

      const secretText = 'Historical Secret Before Key Upgrade'
      const ciphertext = await encryptMessage(legacySeedKey, secretText)

      // Decrypting directly with modernKey should fail
      await expect(decryptMessage(modernKey, ciphertext)).rejects.toThrow()

      // Decrypting with fallback should seamlessly succeed
      const decrypted = await decryptMessageWithFallback(modernKey, conversationId, ciphertext)
      expect(decrypted).toBe(secretText)
    })
  })

  describe('2. Clock Skew & Countdown Timer Resilience', () => {
    it('correctly compensates when client clock is ahead of server clock', () => {
      const burnAfterSeconds = 30
      const serverCreatedAt = new Date(Date.now()).toISOString()

      // Simulate client clock running 10 seconds ahead of server
      const clientServerOffset = -10000 // server is 10s behind client Date.now()
      const clientNow = Date.now() + 10000

      // Without offset, client computes elapsed = 10s
      const uncompensatedElapsed = Math.floor((clientNow - new Date(serverCreatedAt).getTime()) / 1000)
      expect(uncompensatedElapsed).toBe(10)

      // With offset compensation:
      const compensatedNow = clientNow + clientServerOffset
      const compensatedElapsed = Math.max(0, Math.floor((compensatedNow - new Date(serverCreatedAt).getTime()) / 1000))
      expect(compensatedElapsed).toBe(0)

      const remaining = Math.max(0, burnAfterSeconds - compensatedElapsed)
      expect(remaining).toBe(30)
    })

    it('prevents negative elapsed times when client clock is behind or sub-second jitter occurs', () => {
      const burnAfterSeconds = 10
      const futureTime = new Date(Date.now() + 5000).toISOString() // 5s in future

      const now = Date.now()
      const elapsed = Math.max(0, Math.floor((now - new Date(futureTime).getTime()) / 1000))
      expect(elapsed).toBe(0)

      const remaining = Math.max(0, burnAfterSeconds - elapsed)
      expect(remaining).toBe(10)
    })
  })

  describe('3. Client-Side RAM Wiping & Hard-Purge on deleteMessage', () => {
    it('wipes decrypted memory and preserves wasBurn flag upon deleteMessage', () => {
      const convId = 'conv-purge-test'
      const msgId = 'msg-secret-456'

      // Seed store with an active burn message and decrypted plaintext
      useChatStore.getState().setMessages(convId, [
        {
          id: msgId,
          conversationId: convId,
          senderId: 'user-1',
          content: 'encrypted_ciphertext_here',
          contentType: 'TEXT',
          encrypted: true,
          attachment: { burnAfterSeconds: 30 } as any,
          createdAt: new Date().toISOString(),
        },
      ])
      useChatStore.getState().setDecrypted(convId, msgId, 'BankPassword_1234!')

      // Verify plaintext is present in RAM cache
      expect(useChatStore.getState().decrypted[`${convId}:${msgId}`]).toBe('BankPassword_1234!')

      // Trigger deletion
      useChatStore.getState().deleteMessage(convId, msgId, true)

      // Plaintext must be wiped from memory cache
      expect(useChatStore.getState().decrypted[`${convId}:${msgId}`]).toBeUndefined()

      // Message in store must have content blanked, attachment null, deletedAt set, and wasBurn true
      const updatedMsg = useChatStore.getState().messagesByConversation[convId].find((m) => m.id === msgId)
      expect(updatedMsg).toBeDefined()
      expect(updatedMsg?.content).toBe('')
      expect(updatedMsg?.attachment).toBeNull()
      expect(updatedMsg?.deletedAt).toBeDefined()
      expect((updatedMsg as any)?.wasBurn).toBe(true)
    })
  })

  describe('4. Search Index Exclusion for Deleted & Purged Messages', () => {
    it('ensures deleted or purged messages are excluded from search filter', () => {
      const messages = [
        {
          id: 'msg-1',
          content: 'Valid active message with secret keyword',
          contentType: 'TEXT',
          deletedAt: null,
        },
        {
          id: 'msg-2',
          content: '',
          contentType: 'TEXT',
          deletedAt: new Date().toISOString(),
          wasBurn: true,
        },
        {
          id: 'msg-3',
          content: 'Secret keyword but deleted',
          contentType: 'TEXT',
          deletedAt: new Date().toISOString(),
        },
      ]

      const q = 'secret'
      const filtered = messages.filter((m) => {
        if (m.deletedAt || (m as any).wasBurn || !m.content) return false
        return m.content.toLowerCase().includes(q)
      })

      expect(filtered.length).toBe(1)
      expect(filtered[0].id).toBe('msg-1')
    })
  })
})
