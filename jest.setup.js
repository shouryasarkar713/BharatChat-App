import '@testing-library/jest-dom'

const { webcrypto } = require('crypto')
const { TextEncoder, TextDecoder } = require('util')

// Polyfill TextEncoder / TextDecoder for JSDOM
global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder

if (typeof window !== 'undefined') {
  window.TextEncoder = TextEncoder
  window.TextDecoder = TextDecoder
}

// Polyfill Web Crypto API
Object.defineProperty(global, 'crypto', {
  value: webcrypto,
  writable: true,
  configurable: true,
})

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'crypto', {
    value: webcrypto,
    writable: true,
    configurable: true,
  })
}

// Align TypedArray/ArrayBuffer prototypes between Node and JSDOM contexts
const NodeUint8Array = Object.getPrototypeOf(Buffer.from([])).constructor
const NodeArrayBuffer = Object.getPrototypeOf(Buffer.from([]).buffer).constructor

global.Uint8Array = NodeUint8Array
global.ArrayBuffer = NodeArrayBuffer

if (typeof window !== 'undefined') {
  window.Uint8Array = NodeUint8Array
  window.ArrayBuffer = NodeArrayBuffer
}
