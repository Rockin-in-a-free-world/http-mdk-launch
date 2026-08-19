'use strict'

const { requireBasicAuth } = require('../lib/guard')

// Byte-for-byte the same body as
// templates/minimal-site/plugins/dashboard/controllers/overview.js, with exactly one line
// added at the top. This is the concrete proof-of-concept for how a route "opts into"
// basic-auth: by importing and calling the shared guard, not by any mechanism the
// plugin-loader provides for one plugin to wrap/intercept another's route (see
// design/plugin-basic-auth.md -- no such mechanism exists).
module.exports = async function protectedOverview (req, services) {
  requireBasicAuth(req)

  const { workers } = await services.mdkClient.listWorkers()

  const devices = await Promise.all(
    workers.flatMap((w) => (w.deviceIds || []).map(async (deviceId) => {
      const tel = await services.mdkClient.pullTelemetry(deviceId, 'metrics')
      return { deviceId, workerId: w.workerId, workerState: w.state, ...tel.metrics }
    }))
  )

  return { ts: Date.now(), devices }
}
