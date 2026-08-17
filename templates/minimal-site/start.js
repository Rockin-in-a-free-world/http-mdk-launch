'use strict'

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const MDK_ROOT = process.env.MDK_ROOT
if (!MDK_ROOT) {
  console.error('MDK_ROOT is required')
  process.exit(1)
}

const { getKernel, startGateway, waitForDiscovery } = require(path.join(MDK_ROOT, 'backend', 'core', 'mdk'))
const { startDemoWorker } = require(path.join(MDK_ROOT, 'examples', 'backend', 'demo-worker-caller'))
const demoMock = require(path.join(MDK_ROOT, 'backend', 'workers', 'samples', 'demo-worker', 'mock', 'server'))

const ROOT = process.env.MDK_SITE_ROOT || path.join(__dirname, '.mdk-data')
const MOCK_PORT = Number(process.env.MDK_MOCK_PORT) || 9101
const HTTP_PORT = Number(process.env.MDK_HTTP_PORT) || 3000
const HTTP_HOST = process.env.MDK_HTTP_HOST || '127.0.0.1'

function fingerprint (key) {
  const buf = Buffer.isBuffer(key) ? key : Buffer.from(String(key), 'hex')
  const sha = crypto.createHash('sha256').update(buf).digest('hex')
  return { publicKeyFingerprint: `sha256:${sha}`, short: sha.slice(0, 8) }
}

function onceListening (mock) {
  if (mock.server.listening) return Promise.resolve()
  return new Promise((resolve) => mock.server.once('listening', resolve))
}

async function main () {
  fs.mkdirSync(ROOT, { recursive: true })

  const mock = demoMock.createServer({ host: '127.0.0.1', port: MOCK_PORT, serial: 'WM3-0001' })
  await onceListening(mock)

  const kernel = await getKernel({
    root: ROOT,
    keyFile: path.join(ROOT, '.kernel-key')
  })
  const worker = await startDemoWorker({
    workerId: 'demo-worker-1',
    storeDir: path.join(ROOT, 'demo-worker-store'),
    seedDevices: [{ id: 'demo-0', opts: { host: '127.0.0.1', port: MOCK_PORT } }]
  })

  await kernel.registerWorker(worker.runtime.getPublicKey())
  await waitForDiscovery(kernel, { minWorkers: 1 })

  await startGateway({
    kernel,
    port: HTTP_PORT,
    root: path.join(ROOT, 'gateway'),
    tmpdir: path.join(ROOT, 'gateway'),
    extraPluginDirs: [path.join(__dirname, 'plugins', 'dashboard')],
    httpd: { h0: { host: HTTP_HOST } }
  })

  const kernelFp = fingerprint(kernel.getPublicKey())
  const workerFp = fingerprint(worker.runtime.getPublicKey())
  const identity = {
    gateway: { id: `${HTTP_HOST}:${HTTP_PORT}`, serving: true },
    kernel: kernelFp,
    worker: { id: 'demo-worker-1', ...workerFp }
  }
  fs.writeFileSync(path.join(ROOT, 'launcher-identity.json'), JSON.stringify(identity, null, 2))

  console.log(JSON.stringify({
    msg: 'mdk-ready',
    workerDevices: worker.deviceIds,
    overview: `http://${HTTP_HOST}:${HTTP_PORT}/overview`,
    identity
  }))
}

module.exports = { main, ROOT, HTTP_PORT }
if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
