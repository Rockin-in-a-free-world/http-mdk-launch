'use strict'

const fs = require('fs')
const path = require('path')

const HEADER = 'ts,deviceId,workerId,field,value\n'
const SIDECAR_SUFFIX = '.stats.json'
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 2000

// Same env var templates/minimal-site/start.js derives its own ROOT constant from. The
// Gateway plugin controller runs in the *same* Node process as start.js -- see
// backend/core/mdk/index.js's startGateway(), which does `new WrkServerHttp({}, ctx)`
// directly, not a fork/spawn -- so process.env is shared and this plugin can read the
// site's data root exactly like start.js does, with no extra wiring through
// services/conf (the Gateway's _pluginServices only exposes dataProxy/mdkClient/conf --
// see backend/core/gateway/workers/http.node.wrk.js -- none of which carry this path).
function siteRoot () {
  return process.env.MDK_SITE_ROOT || path.join(__dirname, '..', '.telemetry-store-fallback')
}

// Sibling of gateway/, demo-worker-store/, .kernel-key etc. under the site's .mdk-data
// root (see templates/minimal-site/start.js) -- so this store inherits the exact same
// persistence: required|ephemeral semantics already established for Corestore data in
// design/site-config-v2.md and src/server.js's revealStorage(): durable under the
// Railway volume when persistence=required, gone on stop/restart when ephemeral.
function storeDir () {
  const dir = path.join(siteRoot(), 'telemetry-store')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function csvPath () {
  return path.join(storeDir(), 'telemetry.csv')
}

function sidecarPath () {
  return csvPath() + SIDECAR_SUFFIX
}

function escapeCsv (value) {
  const s = String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function readSidecar () {
  try {
    return JSON.parse(fs.readFileSync(sidecarPath(), 'utf8'))
  } catch {
    return { rowCount: 0, firstObservedAt: null, lastObservedAt: null }
  }
}

function writeSidecar (s) {
  fs.writeFileSync(sidecarPath(), JSON.stringify(s))
}

// require() only runs a module's top-level code once per process
// (backend/core/gateway/workers/lib/plugin-loader.js's loadPlugin() requires every
// controller file exactly once, at Gateway boot, inside registerPlugin()) -- so this
// module-level cache lives for the life of the Gateway process, i.e. the life of the
// site. It is seeded from the on-disk sidecar file (not just memory) specifically so a
// Gateway restart mid-site-lifetime doesn't reset rowCount/firstObservedAt to zero and
// make the growth-rate estimate look like storage suddenly shrank.
let cached = null

function currentStats () {
  if (!cached) cached = readSidecar()
  return cached
}

/**
 * Appends one CSV row per (field, value) pair. Called by controllers/poll.js once per
 * polled telemetry read -- see plugin-telemetry-store.md for why the "on each read"
 * cadence has to be driven by whoever calls this route, not by the plugin itself.
 */
function appendSample (deviceId, workerId, fields, observedAt = Date.now()) {
  const entries = Object.entries(fields || {})
  if (entries.length === 0) return { appended: 0 }

  const file = csvPath()
  const isNew = !fs.existsSync(file)
  const lines = entries.map(([field, value]) =>
    [observedAt, deviceId, workerId, field, value].map(escapeCsv).join(','))

  fs.appendFileSync(file, (isNew ? HEADER : '') + lines.join('\n') + '\n')

  const stats = currentStats()
  stats.rowCount += lines.length
  if (stats.firstObservedAt === null) stats.firstObservedAt = observedAt
  stats.lastObservedAt = observedAt
  writeSidecar(stats)

  return { appended: lines.length }
}

// Reads and parses the whole CSV. Fine at the demo scale this prototype targets (a
// single site's single-device telemetry polled every few seconds); a real production
// version serving a large/long-running file would want streaming/tailing instead of a
// full read on every request -- flagged here rather than silently assumed away, same as
// plugin-telemetry-store.md's other scaling caveats.
function readAll () {
  const file = csvPath()
  if (!fs.existsSync(file)) return []
  const text = fs.readFileSync(file, 'utf8')
  const rows = text.split('\n').filter(Boolean)
  rows.shift() // header
  return rows.map((line) => {
    // Splits on the first 4 commas; a value written with escapeCsv's quoting (i.e. one
    // that itself contained a comma/quote/newline) would need real CSV parsing to read
    // back exactly -- not implemented here, since every value this plugin actually
    // writes today (numbers, short enum strings like power_mode) never needs quoting in
    // practice. Documented rather than silently assumed correct for all future fields.
    const parts = line.split(',')
    const [ts, deviceId, workerId, field] = parts
    const value = parts.slice(4).join(',')
    return { observedAt: Number(ts), deviceId, workerId, field, value }
  })
}

/**
 * Time-ranged, optionally device/field-filtered, oldest-to-newest slice of the store,
 * capped at MAX_LIMIT samples -- same default/limit convention as the temperature-sensor
 * reference history store (examples/dashboard-workbench/workers/mock-temperature/src/
 * history-store.js's DEFAULT_LIMIT=20/MAX_LIMIT=1000, scaled up here since this plugin
 * has no per-device 1000-row trim and is meant to feed a denser chart).
 */
function history ({ deviceId, field, limit, from, to } = {}) {
  const cappedLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT))
  let rows = readAll()
  if (deviceId) rows = rows.filter((r) => r.deviceId === deviceId)
  if (field) rows = rows.filter((r) => r.field === field)
  if (from !== undefined && from !== null) rows = rows.filter((r) => r.observedAt >= Number(from))
  if (to !== undefined && to !== null) rows = rows.filter((r) => r.observedAt <= Number(to))
  return rows.slice(-cappedLimit)
}

/**
 * Storage-transparency snapshot. Every field is computed from this process's own real
 * appends -- sizeBytes from an actual fs.statSync() of the live file, growth rates
 * derived from the real elapsed time and real row count/byte count observed so far, not
 * a hardcoded guess. Both growth fields are null until there is enough real data to
 * derive them from (fewer than 2 distinct timestamps, or zero rows).
 */
function stats () {
  const file = csvPath()
  let sizeBytes = 0
  try {
    sizeBytes = fs.statSync(file).size
  } catch {
    sizeBytes = 0
  }

  const s = currentStats()
  const haveSpan = s.firstObservedAt !== null && s.lastObservedAt !== null && s.lastObservedAt > s.firstObservedAt
  const elapsedHours = haveSpan ? (s.lastObservedAt - s.firstObservedAt) / (60 * 60 * 1000) : 0

  return {
    mechanism: 'csv',
    path: file,
    sizeBytes,
    rowCount: s.rowCount,
    firstObservedAt: s.firstObservedAt,
    lastObservedAt: s.lastObservedAt,
    growth: {
      bytesPerHour: elapsedHours > 0 ? sizeBytes / elapsedHours : null,
      bytesPerSample: s.rowCount > 0 ? sizeBytes / s.rowCount : null
    }
  }
}

module.exports = { appendSample, history, stats, csvPath }
