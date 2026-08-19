'use strict'

const crypto = require('crypto')

const COOKIE = 'launcher_session'
const TTL_SEC = Number(process.env.SESSION_TTL_SEC) || 86400

function sessionSecret () {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET
  if (!sessionSecret._dev) {
    sessionSecret._dev = crypto.randomBytes(32).toString('hex')
  }
  return sessionSecret._dev
}

function allowlist () {
  const raw = process.env.LAUNCHER_PUBLIC_KEYS || ''
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

function isAllowed (publicKey) {
  const keys = allowlist()
  if (keys.length === 0) return true
  return keys.includes(publicKey)
}

function b64url (buf) {
  return Buffer.from(buf).toString('base64url')
}

function signSession (publicKey) {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: publicKey,
    iat: now,
    exp: now + TTL_SEC,
    jti: crypto.randomUUID()
  }
  const body = b64url(JSON.stringify(payload))
  const mac = crypto.createHmac('sha256', sessionSecret()).update(body).digest()
  return `${body}.${b64url(mac)}`
}

function verifySession (token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, code: 'ERR_UNAUTHORIZED' }
  }
  const [body, mac] = token.split('.')
  const expected = crypto.createHmac('sha256', sessionSecret()).update(body).digest()
  let given
  try {
    given = Buffer.from(mac, 'base64url')
  } catch {
    return { ok: false, code: 'ERR_UNAUTHORIZED' }
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, code: 'ERR_UNAUTHORIZED' }
  }
  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, code: 'ERR_UNAUTHORIZED' }
  }
  const now = Math.floor(Date.now() / 1000)
  if (!payload.sub || payload.exp < now) {
    return { ok: false, code: 'ERR_UNAUTHORIZED' }
  }
  if (!isAllowed(payload.sub)) {
    return { ok: false, code: 'ERR_FORBIDDEN' }
  }
  return { ok: true, publicKey: payload.sub, payload }
}

function readCookie (req) {
  const header = req.headers.cookie || ''
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === COOKIE) return rest.join('=')
  }
  return null
}

function readBearer (req) {
  const header = req.headers.authorization || ''
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
  return null
}

function sessionFromRequest (req) {
  return verifySession(readBearer(req) || readCookie(req))
}

function setCookieHeader (req, token) {
  const proto = req.headers['x-forwarded-proto'] || ''
  const secure = proto.split(',')[0].trim() === 'https' ? '; Secure' : ''
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TTL_SEC}${secure}`
}

function clearCookieHeader () {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}

module.exports = {
  COOKIE,
  TTL_SEC,
  allowlist,
  isAllowed,
  signSession,
  verifySession,
  sessionFromRequest,
  setCookieHeader,
  clearCookieHeader
}
