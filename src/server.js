'use strict'

const fs = require('fs')
const http = require('http')
const path = require('path')
const { randomUUID } = require('crypto')
const { versionInfo } = require('./version')
const { landingHtml, docsFrameHtml, openapiHtml } = require('./landing')
const { validateSiteLaunch } = require('./validate-site')
const { dataRoot, runtimeReady } = require('./paths')
const { readIdentity, publicIdentity } = require('./identity')
const {
  BOOT_TIMEOUT_MS,
  probeOverview,
  proxyOverview,
  waitForReady,
  spawnSite,
  stopChild
} = require('./supervisor')

const PORT = Number(process.env.PORT) || 8080
const MAX_BODY_BYTES = 16 * 1024
const REQUEST_TIMEOUT_MS = 15_000
const DOCS_DIR = path.join(__dirname, '..', 'dist', 'docs')
const APP_CSS = path.join(__dirname, 'app.css')
const VOLUME_ROOT = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'

const sites = new Map()
let child = null
let activeSiteId = null

function sendJson (res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store'
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

function sendFile (res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendError(res, 503, 'ERR_DOCS_NOT_BUILT', 'Run npm run build:docs before serving /docs')
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
    dryRun: false,
    state: record.state,
    spec: record.spec,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }
  if (record.state === 'live') {
    out.gateway = { overview: `/v1/sites/${record.siteId}/gateway/overview` }
    if (record.identity) out.identity = record.identity
  }
  if (record.failure) out.failure = record.failure
  return out
}

function slotBusy () {
  if (!activeSiteId) return false
  const rec = sites.get(activeSiteId)
  return rec && (rec.state === 'accepted' || rec.state === 'booting' || rec.state === 'live' || rec.state === 'stopping')
}

async function failSite (record, code, message) {
  record.state = 'failed'
  record.updatedAt = new Date().toISOString()
  record.failure = { code, message }
  if (activeSiteId === record.siteId) activeSiteId = null
  await stopChild(child)
  child = null
}

async function bootSite (record) {
  record.state = 'booting'
  record.updatedAt = new Date().toISOString()
  const siteRoot = path.join(dataRoot(), 'sites', record.siteId, '.mdk-data')
  fs.mkdirSync(siteRoot, { recursive: true })

  child = spawnSite({ siteRoot })
  child.once('exit', (code, signal) => {
    if (record.state === 'live' || record.state === 'booting') {
      record.state = 'failed'
      record.updatedAt = new Date().toISOString()
      record.failure = { code: 'ERR_SITE_EXITED', message: `MDK child exited (${signal || code})` }
      if (activeSiteId === record.siteId) activeSiteId = null
      child = null
    }
  })

  try {
    await waitForReady(child, BOOT_TIMEOUT_MS)
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
    res.writeHead(302, { location: '/launch' })
    res.end()
    return 302
  }

  if (req.method === 'GET' && pathname === '/launch') {
    sendHtml(res, 200, landingHtml())
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
    const rec = activeSiteId ? sites.get(activeSiteId) : null
    if (!rec || rec.state !== 'live') {
      sendJson(res, 503, { ready: false, reason: rec ? rec.state : 'no-site' })
      return 503
    }
    const probe = await probeOverview()
    if (!probe.ok) {
      sendJson(res, 503, { ready: false, reason: 'gateway-not-ready' })
      return 503
    }
    sendJson(res, 200, {
      ready: true,
      siteId: rec.siteId,
      identity: rec.identity || null,
      overview: `/v1/sites/${rec.siteId}/gateway/overview`
    })
    return 200
  }

  if (req.method === 'GET' && pathname === '/app.css') {
    sendFile(res, APP_CSS, 'text/css; charset=utf-8')
    return 200
  }

  if (req.method === 'GET' && pathname === '/docs') {
    sendHtml(res, 200, docsFrameHtml())
    return 200
  }

  if (req.method === 'GET' && pathname === '/docs/redoc.html') {
    sendFile(res, path.join(DOCS_DIR, 'index.html'), 'text/html; charset=utf-8')
    return 200
  }

  if (req.method === 'GET' && pathname === '/openapi') {
    sendHtml(res, 200, openapiHtml())
    return 200
  }

  if (req.method === 'GET' && pathname === '/docs/openapi.yaml') {
    sendFile(res, path.join(DOCS_DIR, 'openapi.yaml'), 'application/yaml; charset=utf-8')
    return 200
  }

  if (req.method === 'POST' && pathname === '/v1/auth/challenges') {
    sendError(res, 501, 'ERR_AUTH_NOT_IMPLEMENTED', 'Wallet challenge sign-in ships in Stage 2')
    return 501
  }

  if (req.method === 'POST' && pathname === '/v1/session') {
    sendError(res, 501, 'ERR_AUTH_NOT_IMPLEMENTED', 'Wallet session ships in Stage 2')
    return 501
  }

  if (req.method === 'POST' && (pathname === '/v1/sites/validate' || pathname === '/v1/sites')) {
    const body = await parseJsonBody(req, res)
    if (body === null) return res.statusCode
    const result = validateSiteLaunch(body)
    if (!result.ok) {
      sendError(res, 400, result.code, result.message, result.fields)
      return 400
    }
    if (pathname === '/v1/sites/validate') {
      sendJson(res, 200, { valid: true, spec: result.spec })
      return 200
    }
    if (result.spec.spec.persistence === 'required' && !volumeMounted()) {
      sendError(res, 400, 'ERR_VOLUME_REQUIRED', 'persistence: required needs a mounted volume')
      return 400
    }
    if (slotBusy()) {
      sendError(res, 409, 'ERR_SITE_SLOT_BUSY', 'One site is already booting or live')
      return 409
    }
    const runtime = runtimeReady()
    if (!runtime.ok) {
      sendError(res, 503, 'ERR_MDK_RUNTIME_MISSING', 'Local MDK v0.6.0 tree is not installed (clone tag v0.6.0 and npm install)')
      return 503
    }

    const siteId = `site-${result.spec.metadata.name}-${randomUUID().slice(0, 8)}`
    const now = new Date().toISOString()
    const record = {
      siteId,
      state: 'accepted',
      spec: result.spec,
      createdAt: now,
      updatedAt: now
    }
    sites.set(siteId, record)
    activeSiteId = siteId
    setImmediate(() => {
      bootSite(record).catch((err) => {
        console.error(JSON.stringify({ ts: new Date().toISOString(), err: err.message }))
      })
    })
    sendJson(res, 202, publicRecord(record))
    return 202
  }

  const overviewMatch = pathname.match(/^\/v1\/sites\/([^/]+)\/gateway\/overview$/)
  if (req.method === 'GET' && overviewMatch) {
    const record = sites.get(decodeURIComponent(overviewMatch[1]))
    if (!record) {
      sendError(res, 404, 'ERR_SITE_NOT_FOUND', 'No site with that id')
      return 404
    }
    if (record.state !== 'live') {
      sendError(res, 409, 'ERR_SITE_NOT_LIVE', 'Site Gateway is not live yet')
      return 409
    }
    proxyOverview(res)
    return 200
  }

  const siteMatch = pathname.match(/^\/v1\/sites\/([^/]+)$/)
  if (req.method === 'GET' && siteMatch) {
    const record = sites.get(decodeURIComponent(siteMatch[1]))
    if (!record) {
      sendError(res, 404, 'ERR_SITE_NOT_FOUND', 'No site with that id')
      return 404
    }
    sendJson(res, 200, publicRecord(record))
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
  if (child) await stopChild(child)
  server.close()
}

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
