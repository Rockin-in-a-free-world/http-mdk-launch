'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { sha256Fingerprint } = require('../src/identity')

test('kernel/worker fingerprints match the workbench SHA-256 shape', () => {
  const fp = sha256Fingerprint(Buffer.from('00', 'hex'))
  assert.match(fp.publicKeyFingerprint, /^sha256:[0-9a-f]{64}$/)
  assert.equal(fp.short, fp.publicKeyFingerprint.slice('sha256:'.length, 'sha256:'.length + 8))
})
