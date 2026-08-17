'use strict'

const fs = require('fs')
const path = require('path')

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
)

// Immutable public pin. Do not point this at `main`: that branch moves.
const MDK_RUNTIME_VERSION = '0.6.0'
const MDK_RUNTIME_PIN = 'tag'
const MDK_RUNTIME_REF = 'v0.6.0'
const MDK_RUNTIME_URL = 'https://github.com/tetherto/mdk/releases/tag/v0.6.0'
const MDK_RUNTIME_TREE = 'https://github.com/tetherto/mdk/tree/v0.6.0'

function versionInfo () {
  return {
    LAUNCHER_VERSION: pkg.version,
    GIT_BRANCH:
      process.env.RAILWAY_GIT_BRANCH ||
      process.env.GIT_BRANCH ||
      '0.6-railway',
    BUILD_SHA:
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.BUILD_SHA ||
      'dev',
    MDK_RUNTIME_VERSION: process.env.MDK_RUNTIME_VERSION || MDK_RUNTIME_VERSION,
    MDK_RUNTIME_PIN: process.env.MDK_RUNTIME_PIN || MDK_RUNTIME_PIN,
    MDK_RUNTIME_REF: process.env.MDK_RUNTIME_REF || MDK_RUNTIME_REF,
    MDK_RUNTIME_URL: process.env.MDK_RUNTIME_URL || MDK_RUNTIME_URL,
    MDK_RUNTIME_TREE: process.env.MDK_RUNTIME_TREE || MDK_RUNTIME_TREE,
    RUNTIME_SOURCE: 'public-release'
  }
}

module.exports = { versionInfo }
