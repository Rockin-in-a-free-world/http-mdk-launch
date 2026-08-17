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

function gatewayOrigin () {
  const host = process.env.MDK_HTTP_HOST || '127.0.0.1'
  const port = Number(process.env.MDK_HTTP_PORT) || 3000
  return { host, port, url: `http://${host}:${port}` }
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
