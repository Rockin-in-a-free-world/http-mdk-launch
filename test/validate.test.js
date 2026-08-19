'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateSiteLaunch } = require('../src/validate-site')

const valid = {
  apiVersion: 'launch.mdk.tether.io/v1alpha1',
  kind: 'SiteLaunch',
  metadata: { name: 'hobby-demo' },
  spec: {
    template: { name: 'minimal-site', version: '0.6.0' },
    persistence: 'ephemeral'
  }
}

test('accepts the hobby-demo fixture', () => {
  const result = validateSiteLaunch(valid)
  assert.equal(result.ok, true)
  assert.equal(result.spec.metadata.name, 'hobby-demo')
})

test('rejects unknown fields', () => {
  const result = validateSiteLaunch({ ...valid, extra: true })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ERR_INVALID_SPEC')
})

test('rejects uppercase names', () => {
  const result = validateSiteLaunch({
    ...valid,
    metadata: { name: 'Hobby' }
  })
  assert.equal(result.ok, false)
})

test('rejects unsupported templates by name', () => {
  const result = validateSiteLaunch({
    ...valid,
    spec: {
      ...valid.spec,
      template: { name: 'full-site', version: '0.6.0' }
    }
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ERR_UNSUPPORTED_TEMPLATE')
})

test('accepts an explicit slot and passes it through', () => {
  const result = validateSiteLaunch({
    ...valid,
    metadata: { name: 'hobby-demo', slot: 2 }
  })
  assert.equal(result.ok, true)
  assert.equal(result.spec.metadata.slot, 2)
})

test('rejects an out-of-range slot', () => {
  const result = validateSiteLaunch({
    ...valid,
    metadata: { name: 'hobby-demo', slot: 4 }
  })
  assert.equal(result.ok, false)
})

test('rejects arrays as the body', () => {
  const result = validateSiteLaunch([])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ERR_INVALID_JSON')
})

test('accepts spec.auth and passes it through as plaintext (redaction is server.js\'s job, not validate-site.js\'s)', () => {
  const result = validateSiteLaunch({
    ...valid,
    spec: { ...valid.spec, auth: { username: 'admin', password: 'password1234' } }
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.spec.spec.auth, { username: 'admin', password: 'password1234' })
})

test('rejects a spec.auth.password shorter than 8 characters', () => {
  const result = validateSiteLaunch({
    ...valid,
    spec: { ...valid.spec, auth: { username: 'admin', password: 'short' } }
  })
  assert.equal(result.ok, false)
})

test('rejects spec.auth missing username', () => {
  const result = validateSiteLaunch({
    ...valid,
    spec: { ...valid.spec, auth: { password: 'password1234' } }
  })
  assert.equal(result.ok, false)
})

test('omits spec.auth when not provided', () => {
  const result = validateSiteLaunch(valid)
  assert.equal(result.ok, true)
  assert.equal(result.spec.spec.auth, undefined)
})

test('accepts spec.plugins with telemetry-store and passes it through', () => {
  const result = validateSiteLaunch({
    ...valid,
    spec: { ...valid.spec, plugins: ['telemetry-store'] }
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.spec.spec.plugins, ['telemetry-store'])
})

test('rejects an unknown plugin name', () => {
  const result = validateSiteLaunch({
    ...valid,
    spec: { ...valid.spec, plugins: ['not-a-real-plugin'] }
  })
  assert.equal(result.ok, false)
})

test('rejects duplicate plugin names', () => {
  const result = validateSiteLaunch({
    ...valid,
    spec: { ...valid.spec, plugins: ['telemetry-store', 'telemetry-store'] }
  })
  assert.equal(result.ok, false)
})

test('omits spec.plugins when not provided', () => {
  const result = validateSiteLaunch(valid)
  assert.equal(result.ok, true)
  assert.equal(result.spec.spec.plugins, undefined)
})
