'use strict'

const crypto = require('crypto')

// scrypt cost parameters. Must match exactly what the launcher used when it hashed
// SiteLaunch.spec.auth.password at sites.create time (design/plugin-basic-auth.md,
// "Password handling"), since scrypt's output depends on N/r/p/keylen, not just the
// password+salt. Keeping the constants here (rather than re-deriving them from an env
// var) means a mismatched launcher build fails every request instead of silently
// accepting wrong-cost hashes -- fail loud, not permissive.
const SCRYPT_KEYLEN = 64
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

// The child process (templates/minimal-site/start.js) and this Gateway plugin run in
// the same Node process -- backend/core/mdk/index.js's startGateway() does
// `new WrkServerHttp({}, ctx)` in-process, not a fork/spawn -- so process.env set when
// the launcher's supervisor.js spawned the child (see design/plugin-basic-auth.md) is
// visible here directly, exactly like start.js reading MDK_SITE_ROOT.
function envCredential () {
  const username = process.env.MDK_BASIC_AUTH_USER
  const saltHex = process.env.MDK_BASIC_AUTH_SALT
  const hashHex = process.env.MDK_BASIC_AUTH_HASH
  if (!username || !saltHex || !hashHex) return null
  return {
    username,
    salt: Buffer.from(saltHex, 'hex'),
    hash: Buffer.from(hashHex, 'hex')
  }
}

function parseBasicAuthHeader (headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null
  const match = /^Basic\s+(.+)$/i.exec(headerValue.trim())
  if (!match) return null
  let decoded
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8')
  } catch {
    return null
  }
  const sep = decoded.indexOf(':')
  if (sep === -1) return null
  return { username: decoded.slice(0, sep), password: decoded.slice(sep + 1) }
}

/**
 * Throws an ERR_-prefixed Error (surfaced by the Gateway's global onError hook --
 * backend/core/gateway/workers/http.node.wrk.js -- as HTTP 400, see plugin-basic-auth.md)
 * if the request is not authenticated. Returns undefined on success. Never logs the
 * Authorization header or the submitted password, on success or failure.
 *
 * Deliberately fails closed (throws) rather than passing through when no credential is
 * configured for the site: a controller that calls this function is explicitly opting
 * into "this route requires auth," so a misconfigured/missing credential must not
 * silently become an open route.
 */
function requireBasicAuth (req) {
  const configured = envCredential()
  if (!configured) {
    throw new Error('ERR_UNAUTHORIZED: no basic-auth credential configured for this site')
  }

  const provided = parseBasicAuthHeader(req.headers && req.headers.authorization)
  if (!provided) {
    throw new Error('ERR_UNAUTHORIZED: missing or malformed Authorization header')
  }

  const providedUserBuf = Buffer.from(provided.username)
  const configuredUserBuf = Buffer.from(configured.username)
  const usernameOk = providedUserBuf.length === configuredUserBuf.length &&
    crypto.timingSafeEqual(providedUserBuf, configuredUserBuf)

  // Recompute the hash of the *submitted* plaintext password with the *stored* salt and
  // compare hash-to-hash. The plaintext password never has to be stored anywhere for this
  // comparison to work -- see plugin-basic-auth.md's password-handling reasoning.
  const candidateHash = crypto.scryptSync(provided.password, configured.salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS)
  const passwordOk = candidateHash.length === configured.hash.length &&
    crypto.timingSafeEqual(candidateHash, configured.hash)

  if (!usernameOk || !passwordOk) {
    throw new Error('ERR_UNAUTHORIZED: invalid credentials')
  }
}

module.exports = { requireBasicAuth, parseBasicAuthHeader, SCRYPT_KEYLEN, SCRYPT_OPTIONS }
