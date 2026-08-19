'use strict'

const { requireBasicAuth } = require('../../basic-auth/lib/guard')

// Must match src/supervisor.js's INTERNAL_PROBE_HEADER exactly -- this file
// runs in the child process, a separate Node module cache from the
// launcher, so the header *name* is duplicated here as a literal (only the
// *secret* value travels between the two processes, via
// MDK_INTERNAL_PROBE_SECRET).
const INTERNAL_PROBE_HEADER = 'x-mdk-internal-probe'

// Only apply the guard when this site actually has a basic-auth credential
// configured (MDK_BASIC_AUTH_USER set by src/supervisor.js's spawnSite() --
// see design/plugin-basic-auth.md). requireBasicAuth() itself fails closed
// with no credential configured, so a site with no spec.auth must never call
// it -- checking presence here first keeps today's unauthenticated behavior
// unchanged for every site that didn't opt in.
//
// The launcher's own internal probes (boot-readiness, sites.overview,
// sites.reveal -- all in src/supervisor.js/src/server.js) are exempted via a
// separate, launcher-only secret unrelated to this site's Basic Auth
// credential. Without this, a site with spec.auth configured could never
// boot: the launcher deliberately never keeps the plaintext password needed
// to authenticate as the site's own Basic Auth user (see
// design/plugin-basic-auth.md's "Password handling"), so it has no way to
// pass this guard as that user -- discovered by actually booting a site
// with auth configured, not assumed up front.
module.exports = async function overview (req, services) {
  const internalSecret = process.env.MDK_INTERNAL_PROBE_SECRET
  const isInternalProbe = !!internalSecret &&
    req.headers && req.headers[INTERNAL_PROBE_HEADER] === internalSecret

  if (!isInternalProbe && process.env.MDK_BASIC_AUTH_USER) {
    requireBasicAuth(req)
  }

  const { workers } = await services.mdkClient.listWorkers()

  const devices = await Promise.all(
    workers.flatMap((w) => (w.deviceIds || []).map(async (deviceId) => {
      const tel = await services.mdkClient.pullTelemetry(deviceId, 'metrics')
      return { deviceId, workerId: w.workerId, workerState: w.state, ...tel.metrics }
    }))
  )

  return { ts: Date.now(), devices }
}
