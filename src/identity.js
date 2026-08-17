'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

function sha256Fingerprint (key) {
  const buf = Buffer.isBuffer(key) ? key : Buffer.from(String(key), 'hex')
  const sha = crypto.createHash('sha256').update(buf).digest('hex')
  return {
    publicKeyFingerprint: `sha256:${sha}`,
    short: sha.slice(0, 8)
  }
}

function identityPath (siteRoot) {
  return path.join(siteRoot, 'launcher-identity.json')
}

function readIdentity (siteRoot) {
  try {
    const raw = fs.readFileSync(identityPath(siteRoot), 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function publicIdentity (identity) {
  if (!identity) return null
  return {
    gateway: identity.gateway || null,
    kernel: identity.kernel
      ? { publicKeyFingerprint: identity.kernel.publicKeyFingerprint, short: identity.kernel.short }
      : null,
    worker: identity.worker
      ? {
          id: identity.worker.id,
          publicKeyFingerprint: identity.worker.publicKeyFingerprint,
          short: identity.worker.short
        }
      : null
  }
}

module.exports = {
  sha256Fingerprint,
  identityPath,
  readIdentity,
  publicIdentity
}
