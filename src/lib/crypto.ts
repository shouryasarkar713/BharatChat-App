// E2E encryption helpers (client-side AES-GCM + RSA-OAEP key wrapping).
//
// Architecture details:
//  - Each user generates an RSA-OAEP keypair on first login (stored in IndexedDB).
//    The public key is uploaded to the server (`User.publicKey`).
//  - When a user creates/opens an encrypted conversation, the conversation has an
//    AES-GCM symmetric key. The key is wrapped (RSA-OAEP) for each member's public
//    key and stored on the server as `ConversationKey` rows (one ciphertext per member).
//  - Messages are encrypted on the client with AES-GCM before being sent over the
//    socket. The server only ever sees ciphertext.
//  - Recipients fetch their wrapped key, unwrap with their private key, then decrypt
//    the message content.
//
// All of this runs in the browser via Web Crypto. The server never has access to
// plaintext message content for encrypted conversations.

const DB_NAME = 'chat-e2e-keys'
const DB_VERSION = 1
const KEY_STORE = 'rsa-keys' // stores CryptoKeyPair for current user
const AES_STORE = 'aes-keys' // stores unwrapped CryptoKey per conversation

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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
  const d = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function dbGet<T = any>(store: string, key: string): Promise<T | undefined> {
  const d = await openDb()
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readonly')
    const r = tx.objectStore(store).get(key)
    r.onsuccess = () => resolve(r.result as T)
    r.onerror = () => reject(r.error)
  })
}

export async function getOrCreateRsaKeyPair(userId: string): Promise<CryptoKeyPair> {
  const existing = await dbGet<CryptoKeyPair>(KEY_STORE, userId)
  if (existing) return existing
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
