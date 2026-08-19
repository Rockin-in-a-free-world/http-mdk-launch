'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

process.env.SESSION_SECRET = 'test-secret-not-for-prod'

const { signSession, verifySession, isAllowed } = require('../src/session')

test('signs and verifies a session token', () => {
  const token = signSession('Abc123pubkey')
  const result = verifySession(token)
  assert.equal(result.ok, true)
  assert.equal(result.publicKey, 'Abc123pubkey')
})

test('rejects a tampered token', () => {
  const token = signSession('Abc123pubkey')
  const result = verifySession(token.slice(0, -2) + 'aa')
  assert.equal(result.ok, false)
})

test('empty LAUNCHER_PUBLIC_KEYS allows any key', () => {
  delete process.env.LAUNCHER_PUBLIC_KEYS
  assert.equal(isAllowed('anyone'), true)
})

test('set LAUNCHER_PUBLIC_KEYS restricts keys', () => {
  process.env.LAUNCHER_PUBLIC_KEYS = 'allow-me, also-me'
  assert.equal(isAllowed('allow-me'), true)
  assert.equal(isAllowed('nope'), false)
  delete process.env.LAUNCHER_PUBLIC_KEYS
})
