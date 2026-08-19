'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSpecYaml } = require('../src/spec-yaml')

const spec = {
  apiVersion: 'launch.mdk.tether.io/v1alpha1',
  kind: 'SiteLaunch',
  metadata: { name: 'hobby-demo', slot: 2 },
  spec: {
    template: { name: 'minimal-site', version: '0.6.0' },
    persistence: 'ephemeral'
  }
}

test('builds a plain yaml doc for a live site', () => {
  const yaml = buildSpecYaml({
    siteId: 'site-hobby-demo-abcd1234',
    slot: 2,
    state: 'live',
    spec,
    notes: 'Booted clean on the second try.',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:05:00.000Z'
  })
  assert.match(yaml, /^siteId: "site-hobby-demo-abcd1234"/)
  assert.match(yaml, /^slot: 2$/m)
  assert.match(yaml, /^state: "live"$/m)
  assert.match(yaml, /^createdAt: "2026-08-18T00:00:00\.000Z"$/m)
  assert.match(yaml, /notes: \|\n {2}Booted clean on the second try\./)
  assert.match(yaml, /^launch:$/m)
  assert.match(yaml, /name: "hobby-demo"/)
  assert.match(yaml, /slot: 2\n/)
  assert.match(yaml, /persistence: "ephemeral"/)
  assert.doesNotMatch(yaml, /openapi/)
})

test('draft (no siteId) reports siteId and slot as null', () => {
  const yaml = buildSpecYaml({ siteId: null, slot: null, state: 'draft', spec, notes: '' })
  assert.match(yaml, /^siteId: null$/m)
  assert.match(yaml, /^slot: null$/m)
})

test('empty notes render as an empty scalar, not a block', () => {
  const yaml = buildSpecYaml({ siteId: 's1', slot: 1, state: 'accepted', spec, notes: '' })
  assert.match(yaml, /^notes: ''$/m)
})

test('multi-line notes are indented under a literal block scalar', () => {
  const yaml = buildSpecYaml({ siteId: 's1', slot: 1, state: 'accepted', spec, notes: 'line one\nline two' })
  assert.match(yaml, /notes: \|\n {2}line one\n {2}line two/)
})

test('omits metadata.slot when the spec has no explicit slot', () => {
  const noSlotSpec = { ...spec, metadata: { name: 'hobby-demo' } }
  const yaml = buildSpecYaml({ siteId: 's1', slot: 1, state: 'accepted', spec: noSlotSpec, notes: '' })
  assert.doesNotMatch(yaml, /^ {4}slot: \d/m)
})

test('throws on a non-SiteLaunch-shaped spec', () => {
  assert.throws(() => buildSpecYaml({ siteId: 's1', slot: 1, state: 'accepted', spec: {} }))
})
