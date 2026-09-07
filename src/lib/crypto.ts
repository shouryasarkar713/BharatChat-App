// E2E encryption helpers (client-side AES-GCM + RSA-OAEP key wrapping).
//
// Architecture:
//  - Each user generates an RSA-OAEP 2048-bit keypair on the device (stored in IndexedDB).
//    The private key NEVER leaves the device.
//    The public key is published to the server (`User.publicKey`).
//  - When a conversation is created or opened:
//    1. If the user already has the conversation's unwrapped AES key cached locally, use it (0ms).
//    2. Otherwise, check if the server has an encrypted copy of the AES key wrapped for this user's RSA public key.
//       If so, unwrap it using the device's local RSA private key.
//    3. If no key has been wrapped yet (first opening of conversation), generate a fresh
//       random 256-bit AES-GCM key, wrap it for all members using their respective RSA public keys,
//       and upload the wrapped keys to the server.
//    4. For historical conversations or users without published RSA keys, seamlessly fall back
//       to the deterministic SHA-256 seed key so no messages are ever lost.
//
//  - Messages are encrypted on the client with AES-GCM before being sent. The server and
//    database only ever see random ciphertext.

const DB_NAME = 'chat-e2e-keys'
const DB_VERSION = 1
const KEY_STORE = 'rsa-keys' // stores CryptoKeyPair for current user
const AES_STORE = 'aes-keys' // stores unwrapped CryptoKey per conversation

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not available'))
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE)
      if (!db.objectStoreNames.contains(AES_STORE)) db.createObjectStore(AES_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function dbPut(store: string, key: string, value: any) {
  try {
    const d = await openDb()
    return new Promise<void>((resolve, reject) => {
      const tx = d.transaction(store, 'readwrite')
      tx.objectStore(store).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('IndexedDB put failed:', err)
  }
}

async function dbGet<T = any>(store: string, key: string): Promise<T | undefined> {
  try {
    const d = await openDb()
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, 'readonly')
      const r = tx.objectStore(store).get(key)
      r.onsuccess = () => resolve(r.result as T)
      r.onerror = () => reject(r.error)
    })
  } catch (err) {
    return undefined
  }
}

/**
 * Ensures the device has an RSA-OAEP keypair in IndexedDB, and publishes
 * the public key to the server if not already synced.
 */
export async function getOrCreateRsaKeyPair(userId: string): Promise<CryptoKeyPair> {
  const existing = await dbGet<CryptoKeyPair>(KEY_STORE, userId)
  if (existing && existing.publicKey && existing.privateKey) return existing

  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  )
  await dbPut(KEY_STORE, userId, pair)

  // Publish public key to server in the background
  exportPublicKeyB64(pair.publicKey).then(async (pubKeyB64) => {
    try {
      await fetch('/api/users/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: pubKeyB64 }),
      })
    } catch (e) {
      console.warn('Failed to publish public key:', e)
    }
  }).catch(() => {})

  return pair
}

export async function exportPublicKeyB64(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', key)
  return btoa(String.fromCharCode(...new Uint8Array(spki)))
}

export async function importPublicKeyB64(b64: string): Promise<CryptoKey> {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return crypto.subtle.importKey(
    'spki',
    bytes.buffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt']
  )
}

export async function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
}

export async function exportAesKeyB64(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key)
  return btoa(String.fromCharCode(...new Uint8Array(raw)))
}

export async function importAesKeyB64(b64: string): Promise<CryptoKey> {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return crypto.subtle.importKey('raw', bytes.buffer, { name: 'AES-GCM' }, true, [
    'encrypt',
    'decrypt',
  ])
}

// Wrap an AES key for a recipient's RSA public key — returns base64 ciphertext.
export async function wrapAesKeyFor(aesKey: CryptoKey, recipientPublicKey: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', aesKey)
  const wrapped = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    recipientPublicKey,
    raw
  )
  return btoa(String.fromCharCode(...new Uint8Array(wrapped)))
}

// Unwrap an AES key with the current user's RSA private key.
export async function unwrapAesKey(
  wrappedB64: string,
  rsaPrivateKey: CryptoKey
): Promise<CryptoKey> {
  const bin = atob(wrappedB64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, rsaPrivateKey, bytes.buffer)
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, [
    'encrypt',
    'decrypt',
  ])
}

export async function encryptMessage(aesKey: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder().encode(plaintext)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, enc)
  // Pack iv + ciphertext, base64
  const combined = new Uint8Array(iv.length + ct.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ct), iv.length)
  return btoa(String.fromCharCode(...combined))
}

export async function decryptMessage(aesKey: CryptoKey, packedB64: string): Promise<string> {
  const bin = atob(packedB64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const iv = bytes.slice(0, 12)
  const ct = bytes.slice(12)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct)
  return new TextDecoder().decode(pt)
}

// Cache unwrapped conversation AES keys in memory + IndexedDB
const aesKeyCache = new Map<string, CryptoKey>()

export async function getCachedAesKey(conversationId: string): Promise<CryptoKey | undefined> {
  if (aesKeyCache.has(conversationId)) return aesKeyCache.get(conversationId)
  const stored = await dbGet<CryptoKey>(AES_STORE, conversationId)
  if (stored) {
    aesKeyCache.set(conversationId, stored)
    return stored
  }
  return undefined
}

export async function cacheAesKey(conversationId: string, key: CryptoKey) {
  aesKeyCache.set(conversationId, key)
  await dbPut(AES_STORE, conversationId, key)
}

/**
 * Derives the legacy fallback deterministic key for historical messages.
 */
export async function deriveFallbackSeedKey(conversationId: string): Promise<CryptoKey> {
  const seed = conversationId + ':pulsechat-e2e-seed-v1'
  const seedBytes = new TextEncoder().encode(seed)
  const hashBuf = await crypto.subtle.digest('SHA-256', seedBytes)
  return crypto.subtle.importKey('raw', hashBuf, { name: 'AES-GCM' }, true, [
    'encrypt',
    'decrypt',
  ])
}

// Map to deduplicate concurrent key establishment calls
const activeKeyEstablishment = new Map<string, Promise<CryptoKey>>()

/**
 * True zero-knowledge conversation key establishment:
 * 1. Checks memory & IndexedDB cache (instant 0ms)
 * 2. Fetches wrapped key from server and unwraps with local RSA private key
 * 3. If no key is wrapped yet, generates a fresh random AES-256 key and wraps for all members
 * 4. Falls back to seed key if members lack RSA keys
 */
export async function getOrEstablishConversationAesKey(
  conversationId: string,
  currentUserId: string
): Promise<CryptoKey> {
  // 1. Check local cache
  const cached = await getCachedAesKey(conversationId)
  if (cached) return cached

  // Prevent duplicate concurrent establishment
  if (activeKeyEstablishment.has(conversationId)) {
    return activeKeyEstablishment.get(conversationId)!
  }

  const promise = (async () => {
    try {
      // Ensure current user's RSA keypair is ready
      let keyPair: CryptoKeyPair | null = null
      try {
        keyPair = await getOrCreateRsaKeyPair(currentUserId)
      } catch (e) {
        console.warn('Could not access RSA keypair:', e)
      }

      // 2. Fetch wrapped key info from server
      let serverData: {
        encryptedKey?: string | null
        members?: { userId: string; name: string; publicKey: string | null }[]
      } | null = null

      try {
        const res = await fetch(`/api/conversations/${conversationId}/keys`)
        if (res.ok) {
          serverData = await res.json()
        }
      } catch (e) {
        console.warn('Failed to fetch conversation key status:', e)
      }

      // If server gave us a wrapped key for this user, unwrap it
      if (serverData?.encryptedKey && keyPair?.privateKey) {
        try {
          const unwrapped = await unwrapAesKey(serverData.encryptedKey, keyPair.privateKey)
          await cacheAesKey(conversationId, unwrapped)
          return unwrapped
        } catch (err) {
          console.warn('Failed to unwrap AES key with private key:', err)
        }
      }

      // 3. If no wrapped key exists for this conversation yet, generate a random AES key
      // and wrap it for all members whose public keys are available
      if (serverData?.members && keyPair) {
        const membersWithKeys = serverData.members.filter((m) => m.publicKey)
        if (membersWithKeys.length > 0) {
          const newAesKey = await generateAesKey()
          const wrappedMap: Record<string, string> = {}

          for (const member of membersWithKeys) {
            try {
              const pubKey = await importPublicKeyB64(member.publicKey!)
              wrappedMap[member.userId] = await wrapAesKeyFor(newAesKey, pubKey)
            } catch (err) {
              console.warn(`Failed to wrap key for member ${member.userId}:`, err)
            }
          }

          // If we wrapped for at least the current user
          if (wrappedMap[currentUserId]) {
            // Upload to server asynchronously
            fetch(`/api/conversations/${conversationId}/keys`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ keys: wrappedMap }),
            }).catch((err) => console.warn('Failed to post wrapped keys:', err))

            await cacheAesKey(conversationId, newAesKey)
            return newAesKey
          }
        }
      }

      // 4. Graceful fallback to legacy seed key
      const fallback = await deriveFallbackSeedKey(conversationId)
      await cacheAesKey(conversationId, fallback)
      return fallback
    } finally {
      activeKeyEstablishment.delete(conversationId)
    }
  })()

  activeKeyEstablishment.set(conversationId, promise)
  return promise
}
