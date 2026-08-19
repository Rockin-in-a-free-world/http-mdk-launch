'use strict'

const { spawn } = require('child_process')
const http = require('http')
const path = require('path')
const crypto = require('crypto')
const { TEMPLATE_DIR, mdkRoot, gatewayOrigin } = require('./paths')

const BOOT_TIMEOUT_MS = Number(process.env.MDK_BOOT_TIMEOUT_MS) || 90_000
const PROBE_INTERVAL_MS = 1_000

// A launcher-process-wide, randomly generated secret -- never persisted,
// never logged, never part of any SiteRecord/RPC response -- letting this
// launcher's own internal probes (boot-readiness, sites.overview,
// sites.reveal) authenticate to a site's Gateway even when that site has
// its own, unrelated Basic Auth configured for direct external access
// (design/plugin-basic-auth.md).
//
// Discovered necessary in practice, not designed up front: wiring
// requireBasicAuth() into the real dashboard.overview controller (per this
// launcher's own basic-auth integration) also gates the exact route this
// supervisor already polls unauthenticated for boot-readiness. The launcher
// deliberately never retains the plaintext password once it's hashed at
// sites.create time (see "Password handling" in plugin-basic-auth.md), so
// it has no way to authenticate as the site's own Basic Auth user -- and
// must not be blocked by a credential it intentionally doesn't have. This
// secret is a distinct, launcher-only credential, generated fresh per
// launcher process, not reconstructable from the stored salt+hash, and
// orthogonal to any site's spec.auth.
const INTERNAL_PROBE_SECRET = crypto.randomBytes(24).toString('hex')
const INTERNAL_PROBE_HEADER = 'x-mdk-internal-probe'

function probeOverview (origin) {
  const { host, port } = origin || gatewayOrigin(1)
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/overview', timeout: 2_000, headers: { [INTERNAL_PROBE_HEADER]: INTERNAL_PROBE_SECRET } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve({ ok: false, status: res.statusCode })
          return
        }
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          const devices = Array.isArray(body.devices) ? body.devices : []
          resolve({ ok: devices.length >= 1, status: 200, body })
        } catch {
          resolve({ ok: false, status: res.statusCode })
        }
      })
    })
    req.on('error', () => resolve({ ok: false }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false })
    })
  })
}

// Pure read, no side effects on the caller: probes a site's telemetry-store
// stats route the same way probeOverview() probes /overview. Used by
// buildReveal() to populate SiteReveal.telemetryStorage.
function probeTelemetryStoreStats (origin) {
  const { host, port } = origin || gatewayOrigin(1)
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/telemetry-store/stats', timeout: 2_000 }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve({ ok: false, status: res.statusCode })
          return
        }
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          resolve({ ok: true, status: 200, body })
        } catch {
          resolve({ ok: false, status: res.statusCode })
        }
      })
    })
    req.on('error', () => resolve({ ok: false }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false })
    })
  })
}

// Fire-and-forget GET against a site's telemetry-store poll route. Gateway
// plugins have no interval/boot hook of their own (see
// design/plugin-telemetry-store.md), so persistence is "append on read,"
// piggybacked on the same ~3s cadence src/landing.js's refresh() already
// polls /overview at, via sites.overview/sites.reveal. Errors are swallowed:
// this is a best-effort side effect of an existing read, never something a
// caller should block on or fail because of.
function pollTelemetryStore (origin) {
  const { host, port } = origin || gatewayOrigin(1)
  const req = http.get({ host, port, path: '/telemetry-store/poll', timeout: 2_000 }, (res) => {
    res.resume()
  })
  req.on('error', () => {})
  req.on('timeout', () => { req.destroy() })
}

function proxyOverview (clientRes, origin) {
  const { host, port } = origin || gatewayOrigin(1)
  const req = http.get({ host, port, path: '/overview', timeout: 10_000 }, (up) => {
    const headers = { 'content-type': up.headers['content-type'] || 'application/json' }
    clientRes.writeHead(up.statusCode || 502, headers)
    up.pipe(clientRes)
  })
  req.on('error', () => {
    if (!clientRes.headersSent) {
      const payload = JSON.stringify({ error: { code: 'ERR_GATEWAY_UNREACHABLE', message: 'MDK Gateway is not reachable' } })
      clientRes.writeHead(502, { 'content-type': 'application/json' })
      clientRes.end(payload)
    }
  })
}

function waitForReady (child, timeoutMs, origin) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const onExit = (code, signal) => {
      clearInterval(timer)
      reject(Object.assign(new Error('MDK child exited during boot'), { code: 'ERR_SITE_EXITED', exitCode: code, signal }))
    }
    child.once('exit', onExit)

    const timer = setInterval(async () => {
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        child.removeListener('exit', onExit)
        reject(Object.assign(new Error('MDK boot timed out'), { code: 'ERR_SITE_BOOT_TIMEOUT' }))
        return
      }
      const probe = await probeOverview(origin)
      if (probe.ok) {
        clearInterval(timer)
        child.removeListener('exit', onExit)
        resolve(probe)
      }
    }, PROBE_INTERVAL_MS)
  })
}

// authCredential (when present): { username, salt: Buffer, hash: Buffer } --
// already hashed by src/server.js's createSiteRpc() before this is ever
// called. Only the salt+hash reach the child, hex-encoded, matching
// design/plugins/basic-auth/lib/guard.js's envCredential(). The real
// plaintext password never reaches this function at all.
// plugins (when present): the site's spec.plugins array, e.g.
// ['telemetry-store']. Only used here to decide which env flags to set --
// the actual extraPluginDirs decision lives in templates/minimal-site/
// start.js, which reads these same env vars.
function spawnSite ({ siteRoot, slot, authCredential, plugins }) {
  const root = mdkRoot()
  const origin = gatewayOrigin(slot)
  const child = spawn(process.execPath, [path.join(TEMPLATE_DIR, 'start.js')], {
    cwd: siteRoot,
    env: {
      ...process.env,
      MDK_ROOT: root,
      MDK_SITE_ROOT: siteRoot,
      MDK_HTTP_PORT: String(origin.port),
      MDK_HTTP_HOST: origin.host,
      MDK_MOCK_PORT: String(origin.mockPort),
      MDK_SLOT: String(slot),
      NODE_PATH: path.join(root, 'node_modules'),
      // Always set (not conditional on auth being configured): lets
      // dashboard.overview recognize this launcher's own internal probes and
      // let them through regardless of whether this particular site also has
      // Basic Auth configured -- see INTERNAL_PROBE_SECRET's comment above.
      MDK_INTERNAL_PROBE_SECRET: INTERNAL_PROBE_SECRET,
      ...(authCredential
        ? {
          MDK_BASIC_AUTH_USER: authCredential.username,
          MDK_BASIC_AUTH_SALT: authCredential.salt.toString('hex'),
          MDK_BASIC_AUTH_HASH: authCredential.hash.toString('hex')
        }
        : {}),
      ...(Array.isArray(plugins) && plugins.includes('telemetry-store')
        ? { MDK_TELEMETRY_STORE_ENABLED: '1' }
        : {})
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const prefix = (stream) => (chunk) => {
    const line = chunk.toString().trimEnd()
    if (line) console.log(JSON.stringify({ ts: new Date().toISOString(), mdk: stream, slot, line }))
  }
  child.stdout.on('data', prefix('stdout'))
  child.stderr.on('data', prefix('stderr'))

  return child
}

function stopChild (child, { gracefulMs = 8_000 } = {}) {
  return new Promise((resolve) => {
    if (!child || child.killed || child.exitCode !== null) {
      resolve()
      return
    }
    const force = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
    }, gracefulMs)
    child.once('exit', () => {
      clearTimeout(force)
      resolve()
    })
    try { child.kill('SIGTERM') } catch {
      clearTimeout(force)
      resolve()
    }
  })
}

module.exports = {
  BOOT_TIMEOUT_MS,
  INTERNAL_PROBE_HEADER,
  probeOverview,
  probeTelemetryStoreStats,
  pollTelemetryStore,
  proxyOverview,
  waitForReady,
  spawnSite,
  stopChild
}
