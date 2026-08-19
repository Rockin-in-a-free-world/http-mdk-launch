'use strict'

const fs = require('fs')
const path = require('path')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { TEMPLATE_DIR } = require('../src/paths')

test('minimal-site template matches the 0.6 Kernel/Gateway/Worker recipe', () => {
  const start = fs.readFileSync(path.join(TEMPLATE_DIR, 'start.js'), 'utf8')
  assert.match(start, /getKernel/)
  assert.match(start, /startGateway/)
  assert.match(start, /startDemoWorker/)
  assert.match(start, /waitForDiscovery/)
  assert.doesNotMatch(start, /staticRootPath/)
  assert.ok(fs.existsSync(path.join(TEMPLATE_DIR, 'plugins', 'dashboard', 'mdk-plugin.json')))
  assert.ok(fs.existsSync(path.join(TEMPLATE_DIR, 'plugins', 'dashboard', 'controllers', 'overview.js')))
})
