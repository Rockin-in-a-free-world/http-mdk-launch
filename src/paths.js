'use strict'

const fs = require('fs')
const path = require('path')

const LAUNCHER_ROOT = path.join(__dirname, '..')
const TEMPLATE_DIR = path.join(LAUNCHER_ROOT, 'templates', 'minimal-site')
const DEFAULT_MDK_ROOT = path.resolve(LAUNCHER_ROOT, '..', 'mdk')

function mdkRoot () {
  return process.env.MDK_ROOT || DEFAULT_MDK_ROOT
}

function dataRoot () {
  return process.env.LAUNCHER_DATA_DIR || path.join(LAUNCHER_ROOT, '.data')
}

function gatewayOrigin (slot) {
  const n = Number(slot) > 0 ? Number(slot) : 1
  const host = process.env.MDK_HTTP_HOST || '127.0.0.1'
  return {
    host,
    port: 2999 + n,
    mockPort: 9100 + n,
    url: `http://${host}:${2999 + n}`
  }
}

function runtimeReady (root = mdkRoot()) {
  const markers = [
    path.join(root, 'backend', 'core', 'mdk', 'index.js'),
    path.join(root, 'examples', 'backend', 'demo-worker-caller', 'index.js'),
    path.join(root, 'backend', 'workers', 'samples', 'demo-worker', 'mock', 'server.js'),
    path.join(root, 'node_modules')
  ]
  const missing = markers.filter((p) => !fs.existsSync(p))
  return { ok: missing.length === 0, missing, root }
}

module.exports = {
  LAUNCHER_ROOT,
  TEMPLATE_DIR,
  mdkRoot,
  dataRoot,
  gatewayOrigin,
  runtimeReady
}
