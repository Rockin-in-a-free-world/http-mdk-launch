'use strict'

const fs = require('fs')
const http = require('http')
const path = require('path')
const crypto = require('crypto')
const { versionInfo } = require('./version')
const { landingHtml, openapiHtml } = require('./landing')
const { validateSiteLaunch } = require('./validate-site')
const { buildSpecYaml } = require('./spec-yaml')
const { validateNotes } = require('./notes')
const { dataRoot, runtimeReady, gatewayOrigin } = require('./paths')
const { readIdentity, publicIdentity } = require('./identity')
const { publicKeyFromSeed, createSeedPhrase } = require('./wdk')
const {
  isAllowed,
  signSession,
  sessionFromRequest,
  setCookieHeader,
  clearCookieHeader
} = require('./session')
const {
  BOOT_TIMEOUT_MS,
  probeOverview,
  probeTelemetryStoreStats,
  pollTelemetryStore,
  waitForReady,
  spawnSite,
  stopChild
} = require('./supervisor')

// scrypt cost parameters for spec.auth.password hashing at sites.create time.
// Must match design/plugins/basic-auth/lib/guard.js's SCRYPT_KEYLEN/
// SCRYPT_OPTIONS exactly (also copied into
// templates/minimal-site/plugins/basic-auth/lib/guard.js) -- scrypt's output
// depends on N/r/p/keylen, not just password+salt, so a mismatch here means
// every real request the child verifies would fail.
const SCRYPT_KEYLEN = 64
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const REDACTED_PASSWORD = '<redacted>'

const PORT = Number(process.env.PORT) || 8080
const MAX_BODY_BYTES = 16 * 1024
const REQUEST_TIMEOUT_MS = 15_000
const APP_CSS = path.join(__dirname, 'app.css')
const OPENRPC_DOC = path.join(__dirname, '..', 'openrpc', 'launch.openrpc.json')
const DOCS_CONSOLE_DIR = path.join(__dirname, '..', 'dist', 'console')
const DOCS_CONSOLE_INDEX = path.join(DOCS_CONSOLE_DIR, 'index.html')
const DOCS_ASSET_CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
}
const VOLUME_ROOT = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'

const MAX_SLOTS = 3
const sites = new Map()
const children = new Map()

function sendJson (res, status, body, extraHeaders) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...(extraHeaders || {})
  })
  res.end(payload)
}

function sendError (res, status, code, message, fields) {
  const error = { code, message }
  if (fields) error.fields = fields
  sendJson(res, status, { error })
}

function sendHtml (res, status, html) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html)
  })
  res.end(html)
}

function sendYaml (res, status, yaml) {
  res.writeHead(status, {
    'content-type': 'application/yaml; charset=utf-8',
    'content-length': Buffer.byteLength(yaml),
    'cache-control': 'no-store'
  })
  res.end(yaml)
}

function sendFile (res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendError(res, 404, 'ERR_FILE_NOT_FOUND', 'File not found')
      return
    }
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': data.length,
      'cache-control': 'public, max-age=60'
    })
    res.end(data)
  })
}

function readBody (req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('payload too large'), { code: 'ERR_BODY_TOO_LARGE' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function parseJsonBody (req, res) {
  const type = req.headers['content-type'] || ''
  if (!type.toLowerCase().startsWith('application/json')) {
    sendError(res, 415, 'ERR_UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json')
    return null
  }
  let raw
  try {
    raw = await readBody(req)
  } catch (err) {
    if (err.code === 'ERR_BODY_TOO_LARGE') {
      sendError(res, 413, 'ERR_BODY_TOO_LARGE', `Request body exceeds ${MAX_BODY_BYTES} bytes`)
      return null
    }
    sendError(res, 400, 'ERR_INVALID_JSON', 'Failed to read request body')
    return null
  }
  if (raw.length === 0) {
    sendError(res, 400, 'ERR_INVALID_JSON', 'Request body is empty')
    return null
  }
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    sendError(res, 400, 'ERR_INVALID_JSON', 'Request body is not valid JSON')
    return null
  }
}

function pathnameOf (req) {
  try {
    return new URL(req.url, 'http://127.0.0.1').pathname
  } catch {
    return req.url.split('?')[0]
  }
}

function logLine (req, status) {
  const rec = {
    ts: new Date().toISOString(),
    method: req.method,
    path: pathnameOf(req),
    status
  }
  console.log(JSON.stringify(rec))
}

function requireSession (req, res) {
  const session = sessionFromRequest(req)
  if (session.ok) return session
  const status = session.code === 'ERR_FORBIDDEN' ? 403 : 401
  sendError(res, status, session.code || 'ERR_UNAUTHORIZED', status === 403
    ? 'This public key is not allowlisted'
    : 'Sign in with a BIP-39 seed to continue')
  return null
}

function volumeMounted () {
  try {
    return fs.existsSync(VOLUME_ROOT) && fs.statSync(VOLUME_ROOT).isDirectory()
  } catch {
    return false
  }
}

function publicRecord (record) {
  const out = {
    siteId: record.siteId,
    slot: record.slot,
    dryRun: false,
    state: record.state,
    spec: record.spec,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }
  if (record.state === 'live' && record.identity) {
    out.identity = record.identity
  }
  if (record.failure) out.failure = record.failure
  return out
}

function recordForSlot (slot) {
  return [...sites.values()].find((r) => r.slot === slot &&
    (r.state === 'accepted' || r.state === 'booting' || r.state === 'live' || r.state === 'stopping')) || null
}

function nextSlot () {
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    if (!recordForSlot(slot)) return slot
  }
  return null
}

function slotSummary () {
  const slots = []
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    const rec = recordForSlot(slot)
    if (!rec) {
      slots.push({ slot, state: 'empty' })
      continue
    }
    const row = { slot, state: rec.state, siteId: rec.siteId }
    if (rec.state === 'live') {
      row.identity = rec.identity || null
    }
    slots.push(row)
  }
  return slots
}

async function stopSite (record) {
  if (record.state === 'stopped' || record.state === 'empty') return
  record.state = 'stopping'
  record.updatedAt = new Date().toISOString()
  const child = children.get(record.slot)
  children.delete(record.slot)
  await stopChild(child)
  record.state = 'stopped'
  record.updatedAt = new Date().toISOString()
}

async function failSite (record, code, message) {
  record.state = 'failed'
  record.updatedAt = new Date().toISOString()
  record.failure = { code, message }
  const child = children.get(record.slot)
  children.delete(record.slot)
  await stopChild(child)
}

function siteHasPlugin (record, name) {
  const plugins = record.spec && record.spec.spec && record.spec.spec.plugins
  return Array.isArray(plugins) && plugins.includes(name)
}

function revealCurl (record) {
  const rpcBody = { jsonrpc: '2.0', method: 'sites.create', params: { spec: record.spec }, id: record.siteId }
  return `curl -sS -X POST "$HOST/v1/rpc" \\
  -H "content-type: application/json" \\
  -d '${JSON.stringify(rpcBody)}'`
}

function revealStorage (record) {
  const siteRoot = path.join(dataRoot(), 'sites', record.siteId, '.mdk-data')
  const persistence = record.spec.spec.persistence
  return {
    persistence,
    mode: persistence === 'required' ? 'volume' : 'ephemeral',
    path: siteRoot,
    corestore: path.join(siteRoot, 'store', 'http', 'CORESTORE'),
    atRest: persistence === 'required'
      ? `Corestore-backed Hyperbee state under the Railway volume mount (${VOLUME_ROOT}); survives a launcher restart.`
      : 'Corestore-backed Hyperbee state on local disk under .data/sites/<siteId>; deleted the moment this site is stopped or the launcher restarts.'
  }
}

async function buildReveal (record) {
  const reveal = {
    siteId: record.siteId,
    slot: record.slot,
    state: record.state,
    requestCurl: revealCurl(record),
    keys: record.identity || null,
    storage: revealStorage(record),
    telemetry: null
  }
  if (record.state === 'live') {
    const origin = gatewayOrigin(record.slot)
    const probe = await probeOverview(origin)
    reveal.telemetry = probe.ok ? probe.body : null
    // telemetryStorage is present only when this site opted into
    // telemetry-store -- omitted entirely (not null) otherwise, per
    // design/plugins-fragment.json's SiteRevealTelemetryStorage. Also fires
    // a fire-and-forget poll (see "who calls poll" in
    // design/plugin-telemetry-store.md): sites.reveal already does one HTTP
    // probe of this site's Gateway on the same cadence sites.overview does,
    // so piggybacking the append-on-read trigger here needs no new timer.
    if (siteHasPlugin(record, 'telemetry-store')) {
      pollTelemetryStore(origin)
      const statsProbe = await probeTelemetryStoreStats(origin)
      if (statsProbe.ok) reveal.telemetryStorage = statsProbe.body
    }
  }
  return reveal
}

const RPC_ERROR = {
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32003,
  NOT_FOUND: -32004,
  CONFLICT: -32009,
  UNAVAILABLE: -32010
}

class RpcError extends Error {
  constructor (code, message, data) {
    super(message)
    this.rpcCode = code
    this.data = data
  }
}

function requireSessionRpc (ctx) {
  const session = sessionFromRequest(ctx.req)
  if (!session.ok) {
    throw new RpcError(
      session.code === 'ERR_FORBIDDEN' ? RPC_ERROR.FORBIDDEN : RPC_ERROR.UNAUTHORIZED,
      session.code === 'ERR_FORBIDDEN' ? 'This public key is not allowlisted' : 'Sign in with a BIP-39 seed to continue',
      { code: session.code || 'ERR_UNAUTHORIZED' }
    )
  }
  ctx.session = session
  return session
}

function getRecordOrThrow (siteId) {
  const record = sites.get(String(siteId || ''))
  if (!record) throw new RpcError(RPC_ERROR.NOT_FOUND, 'No site with that id', { code: 'ERR_SITE_NOT_FOUND' })
  return record
}

async function issueSessionRpc (ctx, seedPhrase, { created }) {
  let publicKey
  try {
    publicKey = await publicKeyFromSeed(seedPhrase)
  } catch (err) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'That seed phrase is not valid', { code: err.code || 'ERR_INVALID_SEED' })
  }
  if (!isAllowed(publicKey)) {
    throw new RpcError(RPC_ERROR.FORBIDDEN, 'This public key is not allowlisted', { code: 'ERR_FORBIDDEN' })
  }
  const token = signSession(publicKey)
  ctx.extraHeaders['set-cookie'] = setCookieHeader(ctx.req, token)
  const body = { publicKey, token, created: !!created }
  if (created) body.seedPhrase = seedPhrase
  return body
}

function createSiteRpc (params, ctx) {
  const result = validateSiteLaunch(params && params.spec)
  if (!result.ok) throw new RpcError(RPC_ERROR.INVALID_PARAMS, result.message, { code: result.code, fields: result.fields })
  requireSessionRpc(ctx)
  if (result.spec.spec.persistence === 'required' && !volumeMounted()) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'persistence: required needs a mounted volume', { code: 'ERR_VOLUME_REQUIRED' })
  }
  const requestedSlot = result.spec.metadata.slot
  let slot
  if (requestedSlot) {
    if (recordForSlot(requestedSlot)) {
      throw new RpcError(RPC_ERROR.CONFLICT, `Site ${requestedSlot} is already booting or live`, { code: 'ERR_SITE_SLOT_BUSY' })
    }
    slot = requestedSlot
  } else {
    slot = nextSlot()
    if (!slot) throw new RpcError(RPC_ERROR.CONFLICT, 'All three site tabs are in use', { code: 'ERR_SITE_SLOT_BUSY' })
  }
  const runtime = runtimeReady()
  if (!runtime.ok) {
    throw new RpcError(RPC_ERROR.UNAVAILABLE, 'Local MDK v0.6.0 tree is not installed (clone tag v0.6.0 and npm install)', { code: 'ERR_MDK_RUNTIME_MISSING' })
  }

  // Password handling (design/plugin-basic-auth.md, "Password handling"):
  // hash the plaintext immediately, once, right here, then overwrite
  // result.spec.spec.auth.password with a fixed placeholder before the spec
  // is ever assigned to record.spec below. The real salt+hash are kept only
  // in authCredential (below), which is never copied into record.spec and
  // never returned by publicRecord()/buildReveal()/buildSpecYaml() -- only
  // spawnSite() (step 3) reads it, to set env vars for the child.
  let authCredential = null
  if (result.spec.spec.auth) {
    const { username, password } = result.spec.spec.auth
    const salt = crypto.randomBytes(16)
    const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS)
    authCredential = { username, salt, hash }
    result.spec.spec.auth = { username, password: REDACTED_PASSWORD }
  }

  const siteId = `site-${result.spec.metadata.name}-${crypto.randomUUID().slice(0, 8)}`
  const now = new Date().toISOString()
  const record = {
    siteId,
    slot,
    state: 'accepted',
    spec: result.spec,
    authCredential,
    notes: '',
    createdAt: now,
    updatedAt: now
  }
  sites.set(siteId, record)
  setImmediate(() => {
    bootSite(record).catch((err) => {
      console.error(JSON.stringify({ ts: new Date().toISOString(), err: err.message }))
    })
  })
  return publicRecord(record)
}

const rpcMethods = {
  async 'session.me' (params, ctx) {
    const session = sessionFromRequest(ctx.req)
    if (!session.ok) return { authenticated: false }
    return { authenticated: true, publicKey: session.publicKey }
  },
  async 'auth.createWallet' (params, ctx) {
    return issueSessionRpc(ctx, createSeedPhrase(), { created: true })
  },
  async 'session.create' (params, ctx) {
    if (!params || !params.seedPhrase) {
      throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'seedPhrase is required')
    }
    return issueSessionRpc(ctx, params.seedPhrase, { created: false })
  },
  async 'session.logout' (params, ctx) {
    ctx.extraHeaders['set-cookie'] = clearCookieHeader()
    return { ok: true }
  },
  async 'sites.validate' (params, ctx) {
    const result = validateSiteLaunch(params && params.spec)
    if (!result.ok) throw new RpcError(RPC_ERROR.INVALID_PARAMS, result.message, { code: result.code, fields: result.fields })
    return { valid: true, spec: result.spec }
  },
  async 'sites.create' (params, ctx) {
    return createSiteRpc(params, ctx)
  },
  async 'sites.get' (params, ctx) {
    requireSessionRpc(ctx)
    return publicRecord(getRecordOrThrow(params && params.siteId))
  },
  async 'sites.stop' (params, ctx) {
    requireSessionRpc(ctx)
    const record = getRecordOrThrow(params && params.siteId)
    if (record.state !== 'stopped') await stopSite(record)
    return publicRecord(record)
  },
  async 'sites.overview' (params, ctx) {
    requireSessionRpc(ctx)
    const record = getRecordOrThrow(params && params.siteId)
    if (record.state !== 'live') {
      throw new RpcError(RPC_ERROR.CONFLICT, 'Site Gateway is not live yet', { code: 'ERR_SITE_NOT_LIVE' })
    }
    const origin = gatewayOrigin(record.slot)
    const probe = await probeOverview(origin)
    if (!probe.ok) {
      throw new RpcError(RPC_ERROR.UNAVAILABLE, 'MDK Gateway is not reachable', { code: 'ERR_GATEWAY_UNREACHABLE' })
    }
    // "Who calls poll" decision (design/plugin-telemetry-store.md §4): this
    // RPC method already does one HTTP probe of /overview on the same ~3s
    // cadence src/landing.js's refresh() polls it, so piggyback a
    // fire-and-forget GET to /telemetry-store/poll here rather than
    // invent a second timer -- Gateway plugins have no interval hook of
    // their own.
    if (siteHasPlugin(record, 'telemetry-store')) pollTelemetryStore(origin)
    return probe.body
  },
  async 'sites.reveal' (params, ctx) {
    requireSessionRpc(ctx)
    return buildReveal(getRecordOrThrow(params && params.siteId))
  },
  async 'sites.notes.set' (params, ctx) {
    requireSessionRpc(ctx)
    const record = getRecordOrThrow(params && params.siteId)
    const result = validateNotes(params && params.notes)
    if (!result.ok) throw new RpcError(RPC_ERROR.INVALID_PARAMS, result.message, { code: result.code })
    record.notes = result.notes
    record.updatedAt = new Date().toISOString()
    return { siteId: record.siteId, notes: record.notes, updatedAt: record.updatedAt }
  }
}

async function dispatchRpc (req, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { jsonrpc: '2.0', error: { code: RPC_ERROR.INVALID_REQUEST, message: 'Request must be a JSON-RPC object' }, id: null }
  }
  const { method, params, id } = body
  const responseId = id === undefined ? null : id
  const fn = typeof method === 'string' && Object.prototype.hasOwnProperty.call(rpcMethods, method) && rpcMethods[method]
  if (!fn) {
    return { jsonrpc: '2.0', error: { code: RPC_ERROR.METHOD_NOT_FOUND, message: `Unknown method: ${method}` }, id: responseId }
  }
  const ctx = { req, extraHeaders: {} }
  try {
    const result = await fn(params, ctx)
    return { jsonrpc: '2.0', result, id: responseId, extraHeaders: ctx.extraHeaders }
  } catch (err) {
    if (err instanceof RpcError) {
      return { jsonrpc: '2.0', error: { code: err.rpcCode, message: err.message, data: err.data }, id: responseId, extraHeaders: ctx.extraHeaders }
    }
    console.error(JSON.stringify({ ts: new Date().toISOString(), err: err.message }))
    return { jsonrpc: '2.0', error: { code: RPC_ERROR.INTERNAL_ERROR, message: 'Internal error' }, id: responseId, extraHeaders: ctx.extraHeaders }
  }
}

async function bootSite (record) {
  record.state = 'booting'
  record.updatedAt = new Date().toISOString()
  const siteRoot = path.join(dataRoot(), 'sites', record.siteId, '.mdk-data')
  fs.mkdirSync(siteRoot, { recursive: true })
  const origin = gatewayOrigin(record.slot)

  const child = spawnSite({
    siteRoot,
    slot: record.slot,
    authCredential: record.authCredential || null,
    plugins: record.spec.spec.plugins || []
  })
  children.set(record.slot, child)
  child.once('exit', (code, signal) => {
    if (record.state === 'live' || record.state === 'booting') {
      record.state = 'failed'
      record.updatedAt = new Date().toISOString()
      record.failure = { code: 'ERR_SITE_EXITED', message: `MDK child exited (${signal || code})` }
      children.delete(record.slot)
    }
  })

  try {
    await waitForReady(child, BOOT_TIMEOUT_MS, origin)
    if (record.state !== 'booting') return
    record.identity = publicIdentity(readIdentity(siteRoot))
    record.state = 'live'
    record.updatedAt = new Date().toISOString()
  } catch (err) {
    if (record.state === 'booting') {
      await failSite(record, err.code || 'ERR_SITE_BOOT_FAILED', err.message)
    }
  }
}

async function handle (req, res) {
  const pathname = pathnameOf(req)

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(302, { location: '/launch/1' })
    res.end()
    return 302
  }

  if (req.method === 'GET' && pathname === '/launch') {
    res.writeHead(302, { location: '/launch/1' })
    res.end()
    return 302
  }

  const launchSlot = pathname.match(/^\/launch\/([123])$/)
  if (req.method === 'GET' && launchSlot) {
    sendHtml(res, 200, landingHtml({ slot: Number(launchSlot[1]) }))
    return 200
  }

  if (req.method === 'GET' && pathname === '/version') {
    sendJson(res, 200, versionInfo())
    return 200
  }

  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { status: 'ok' })
    return 200
  }

  if (req.method === 'GET' && pathname === '/ready') {
    const slots = slotSummary()
    const live = slots.filter((s) => s.state === 'live')
    sendJson(res, live.length ? 200 : 503, {
      ready: live.length > 0,
      reason: live.length ? undefined : 'no-site',
      slots
    })
    return live.length ? 200 : 503
  }

  if (req.method === 'GET' && pathname === '/app.css') {
    sendFile(res, APP_CSS, 'text/css; charset=utf-8')
    return 200
  }

  if (req.method === 'GET' && pathname === '/docs') {
    sendFile(res, DOCS_CONSOLE_INDEX, 'text/html; charset=utf-8')
    return 200
  }

  if (req.method === 'GET' && pathname === '/openrpc') {
    sendHtml(res, 200, openapiHtml())
    return 200
  }

  if (req.method === 'GET' && pathname === '/docs/openrpc.json') {
    sendFile(res, OPENRPC_DOC, 'application/json; charset=utf-8')
    return 200
  }

  const docsAssetMatch = pathname.match(/^\/docs\/assets\/([^/]+)$/)
  if (req.method === 'GET' && docsAssetMatch) {
    const assetName = decodeURIComponent(docsAssetMatch[1])
    const ext = path.extname(assetName).toLowerCase()
    const contentType = DOCS_ASSET_CONTENT_TYPES[ext] || 'application/octet-stream'
    sendFile(res, path.join(DOCS_CONSOLE_DIR, 'assets', assetName), contentType)
    return 200
  }

  if (req.method === 'POST' && pathname === '/v1/rpc') {
    const body = await parseJsonBody(req, res)
    if (body === null) return res.statusCode
    const { extraHeaders, ...response } = await dispatchRpc(req, body)
    sendJson(res, 200, response, extraHeaders)
    return 200
  }

  const specYamlMatch = pathname.match(/^\/v1\/sites\/([^/]+)\/spec\.yaml$/)
  if (req.method === 'GET' && specYamlMatch) {
    if (!requireSession(req, res)) return res.statusCode
    const record = sites.get(decodeURIComponent(specYamlMatch[1]))
    if (!record) {
      sendError(res, 404, 'ERR_SITE_NOT_FOUND', 'No site with that id')
      return 404
    }
    const yaml = buildSpecYaml({
      siteId: record.siteId,
      slot: record.slot,
      state: record.state,
      spec: record.spec,
      notes: record.notes,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    })
    sendYaml(res, 200, yaml)
    return 200
  }

  sendError(res, 404, 'ERR_NOT_FOUND', 'No such route')
  return 404
}

const server = http.createServer(async (req, res) => {
  let status = 500
  try {
    status = await handle(req, res)
  } catch (err) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), err: err.message }))
    if (!res.headersSent) {
      sendError(res, 500, 'ERR_INTERNAL', 'Internal error')
    }
    status = 500
  }
  logLine(req, status)
})

server.requestTimeout = REQUEST_TIMEOUT_MS
server.headersTimeout = REQUEST_TIMEOUT_MS
server.keepAliveTimeout = 5_000

async function shutdown () {
  await Promise.all([...children.values()].map((proc) => stopChild(proc)))
  server.close()
}

// Only actually bind a port and install signal handlers when this file is
// run directly (`node src/server.js` / `npm start`) -- not when it's
// `require()`d, e.g. by node:test coverage that needs createSiteRpc/sites
// without booting the real HTTP listener. Behavior for `npm start` and
// Railway is unchanged: this module is always the entrypoint there.
if (require.main === module) {
  process.once('SIGTERM', () => { shutdown().then(() => process.exit(0)) })
  process.once('SIGINT', () => { shutdown().then(() => process.exit(0)) })

  server.listen(PORT, '0.0.0.0', () => {
    const runtime = runtimeReady()
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      msg: 'listening',
      port: PORT,
      mdkRuntime: runtime.ok ? 'present' : 'missing',
      mdkRoot: runtime.root,
      ...versionInfo()
    }))
  })
}

module.exports = {
  server,
  rpcMethods,
  createSiteRpc,
  buildReveal,
  buildSpecYamlForRecord: (record) => buildSpecYaml({
    siteId: record.siteId,
    slot: record.slot,
    state: record.state,
    spec: record.spec,
    notes: record.notes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }),
  sites,
  SCRYPT_KEYLEN,
  SCRYPT_OPTIONS,
  REDACTED_PASSWORD
}
