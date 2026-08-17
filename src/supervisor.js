'use strict'

const { spawn } = require('child_process')
const http = require('http')
const path = require('path')
const { TEMPLATE_DIR, mdkRoot, gatewayOrigin } = require('./paths')

const BOOT_TIMEOUT_MS = Number(process.env.MDK_BOOT_TIMEOUT_MS) || 90_000
const PROBE_INTERVAL_MS = 1_000

function probeOverview () {
  const { host, port } = gatewayOrigin()
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/overview', timeout: 2_000 }, (res) => {
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

function proxyOverview (clientRes) {
  const { host, port } = gatewayOrigin()
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

function waitForReady (child, timeoutMs) {
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
      const probe = await probeOverview()
      if (probe.ok) {
        clearInterval(timer)
        child.removeListener('exit', onExit)
        resolve(probe)
      }
    }, PROBE_INTERVAL_MS)
  })
}

function spawnSite ({ siteRoot }) {
  const root = mdkRoot()
  const child = spawn(process.execPath, [path.join(TEMPLATE_DIR, 'start.js')], {
    cwd: TEMPLATE_DIR,
    env: {
      ...process.env,
      MDK_ROOT: root,
      MDK_SITE_ROOT: siteRoot,
      MDK_HTTP_PORT: String(gatewayOrigin().port),
      MDK_HTTP_HOST: gatewayOrigin().host,
      NODE_PATH: path.join(root, 'node_modules')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const prefix = (stream) => (chunk) => {
    const line = chunk.toString().trimEnd()
    if (line) console.log(JSON.stringify({ ts: new Date().toISOString(), mdk: stream, line }))
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
  probeOverview,
  proxyOverview,
  waitForReady,
  spawnSite,
  stopChild
}
