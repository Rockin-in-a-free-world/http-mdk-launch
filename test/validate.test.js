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

test('rejects arrays as the body', () => {
  const result = validateSiteLaunch([])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ERR_INVALID_JSON')
})
