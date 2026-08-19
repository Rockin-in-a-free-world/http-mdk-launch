'use strict'

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')

// Keep MDK boot probing fast and avoid spawning a real MDK child process --
// this file only cares about src/server.js's createSiteRpc() password
// hashing/redaction step, not a real boot (that's covered by the manual
// curl-based verification against a real ../mdk checkout). Setting this
// before requiring src/supervisor matters: BOOT_TIMEOUT_MS is captured at
// module load time.
// (must be > 0: supervisor.js does `Number(process.env.MDK_BOOT_TIMEOUT_MS) || 90_000`,
// so '0' would fall through to the 90s default instead of a fast timeout.)
process.env.MDK_BOOT_TIMEOUT_MS = '1'

const supervisor = require('../src/supervisor')
const realSpawnSite = supervisor.spawnSite

// A minimal fake child_process.ChildProcess: enough for supervisor.js's
// waitForReady()/stopChild() to run their normal course without a real
// process. kill() synchronously flips killed/exitCode and emits 'exit' on
// the next tick, so stopChild()'s promise resolves quickly instead of
// waiting out its 8s graceful-kill timer.
function fakeChild () {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.exitCode = null
  child.kill = (signal) => {
    if (child.killed) return true
    child.killed = true
    child.exitCode = 0
    setImmediate(() => child.emit('exit', 0, signal))
    return true
  }
  return child
}

// src/server.js does `const { spawnSite } = require('./supervisor')` at its
// own load time, so this module's exports object must already carry the
// fake before src/server.js is first required below -- destructuring a
// plain object property, unlike a live binding, only sees whatever value
// was on the object at the moment it ran.
let lastSpawnArgs = null
supervisor.spawnSite = (args) => {
  lastSpawnArgs = args
  return fakeChild()
}

const { createSiteRpc, sites, SCRYPT_KEYLEN, SCRYPT_OPTIONS, REDACTED_PASSWORD } = require('../src/server')
const { signSession } = require('../src/session')
const { validateSiteLaunch } = require('../src/validate-site')
const { dataRoot } = require('../src/paths')
const guard = require('../templates/minimal-site/plugins/basic-auth/lib/guard')

// bootSite() (src/server.js) creates <dataRoot>/sites/<siteId>/.mdk-data on
// disk synchronously, on the very first tick after createSiteRpc's
// setImmediate fires -- unconditionally, even with spawnSite mocked below.
// Track every siteId these tests create so the `after` hook can remove them
// and leave no artifact behind on disk (the same requirement this task's
// manual verification has to satisfy).
const createdSiteIds = []

function sessionReq () {
  const token = signSession('test-server-auth-public-key')
  return { headers: { authorization: `Bearer ${token}` } }
}

function baseSpec (overrides, metadata) {
  return {
    apiVersion: 'launch.mdk.tether.io/v1alpha1',
    kind: 'SiteLaunch',
    metadata: metadata || { name: 'auth-test-site', slot: 3 },
    spec: {
      template: { name: 'minimal-site', version: '0.6.0' },
      persistence: 'ephemeral',
      ...overrides
    }
  }
}

test('scrypt constants match the basic-auth guard exactly (server and child must agree)', () => {
  assert.equal(SCRYPT_KEYLEN, guard.SCRYPT_KEYLEN)
  assert.deepEqual(SCRYPT_OPTIONS, guard.SCRYPT_OPTIONS)
})

test('validate-site.js passes spec.auth/spec.plugins through unchanged (hashing/redaction happens later, in server.js)', () => {
  const result = validateSiteLaunch(baseSpec({
    auth: { username: 'admin', password: 'password1234' },
    plugins: ['telemetry-store']
  }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.spec.spec.auth, { username: 'admin', password: 'password1234' })
  assert.deepEqual(result.spec.spec.plugins, ['telemetry-store'])
})

test('createSiteRpc hashes spec.auth.password and redacts it before the record is ever stored', () => {
  const plaintext = 'super-secret-password-123'
  const ctx = { req: sessionReq(), extraHeaders: {} }
  const publicResult = createSiteRpc({
    spec: baseSpec({
      auth: { username: 'admin', password: plaintext },
      plugins: ['telemetry-store']
    })
  }, ctx)

  const record = sites.get(publicResult.siteId)
  assert.ok(record, 'record was stored')
  createdSiteIds.push(publicResult.siteId)

  try {
    // 1. The stored spec never contains the real plaintext password.
    assert.equal(record.spec.spec.auth.password, REDACTED_PASSWORD)
    assert.notEqual(record.spec.spec.auth.password, plaintext)

    // 2. Nor does the object returned to the RPC caller (the same shape
    //    sites.get/sites.create echo back to the client).
    assert.equal(publicResult.spec.spec.auth.password, REDACTED_PASSWORD)
    assert.equal(JSON.stringify(publicResult).includes(plaintext), false)

    // 3. Defense in depth: the plaintext appears nowhere in a full
    //    serialization of the raw in-memory record either (authCredential's
    //    salt/hash are Buffers, which JSON.stringify renders as
    //    {"type":"Buffer","data":[...]}-  never the plaintext string).
    assert.equal(JSON.stringify(record).includes(plaintext), false)

    // 4. The real credential material the launcher actually keeps is a
    //    salt+hash pair -- recomputing scryptSync(plaintext, salt, ...)
    //    must match the stored hash, proving the hash is genuine and
    //    verifiable without ever storing the plaintext.
    assert.ok(record.authCredential)
    assert.equal(record.authCredential.username, 'admin')
    assert.ok(Buffer.isBuffer(record.authCredential.salt))
    assert.ok(Buffer.isBuffer(record.authCredential.hash))
    const recomputed = crypto.scryptSync(plaintext, record.authCredential.salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS)
    assert.ok(recomputed.equals(record.authCredential.hash))

    // 5. A wrong password must not verify against the stored hash (sanity
    //    check that this isn't a hash that matches everything).
    const wrong = crypto.scryptSync('not-the-password', record.authCredential.salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS)
    assert.equal(wrong.equals(record.authCredential.hash), false)
  } finally {
    // Leave no artifact behind: free the slot for any other test/manual run
    // in this process.
    record.state = 'stopped'
    sites.delete(publicResult.siteId)
  }
})

test('createSiteRpc with no spec.auth stores no authCredential (no regression for auth-less sites)', () => {
  const ctx = { req: sessionReq(), extraHeaders: {} }
  const publicResult = createSiteRpc({
    spec: baseSpec({}, { name: 'no-auth-site', slot: 2 })
  }, ctx)
  const record = sites.get(publicResult.siteId)
  createdSiteIds.push(publicResult.siteId)
  assert.equal(record.authCredential, null)
  assert.equal(record.spec.spec.auth, undefined)
  record.state = 'stopped'
  sites.delete(publicResult.siteId)
})

after(async () => {
  // Give bootSite()'s setImmediate a moment to run and create the site
  // directory on disk before removing it.
  await new Promise((resolve) => setTimeout(resolve, 150))
  for (const siteId of createdSiteIds) {
    fs.rmSync(path.join(dataRoot(), 'sites', siteId), { recursive: true, force: true })
  }
  supervisor.spawnSite = realSpawnSite
})

void lastSpawnArgs
