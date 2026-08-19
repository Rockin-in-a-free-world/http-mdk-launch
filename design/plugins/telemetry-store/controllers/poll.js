'use strict'

const { appendSample } = require('../lib/store')

// Same telemetry pull as dashboard.overview
// (templates/minimal-site/plugins/dashboard/controllers/overview.js) -- deliberately
// duplicated here rather than imported, since this plugin ships standalone and this
// design task doesn't edit the dashboard plugin's files. A future implementer merging
// the two (so a single poll both renders the overview panel and persists it) just needs
// to call appendSample() from inside overview.js's existing loop -- see
// design/plugin-telemetry-store.md's "who calls poll" section.
module.exports = async function poll (req, services) {
  const { workers } = await services.mdkClient.listWorkers()
  const ts = Date.now()

  const devices = await Promise.all(
    workers.flatMap((w) => (w.deviceIds || []).map(async (deviceId) => {
      const tel = await services.mdkClient.pullTelemetry(deviceId, 'metrics')
      const fields = tel.metrics || {}
      const { appended } = appendSample(deviceId, w.workerId, fields, ts)
      return { deviceId, workerId: w.workerId, fields, appended }
    }))
  )

  return { ts, devices }
}
