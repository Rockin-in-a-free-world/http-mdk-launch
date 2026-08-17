'use strict'

module.exports = async function overview (req, services) {
  const { workers } = await services.mdkClient.listWorkers()

  const devices = await Promise.all(
    workers.flatMap((w) => (w.deviceIds || []).map(async (deviceId) => {
      const tel = await services.mdkClient.pullTelemetry(deviceId, 'metrics')
      return { deviceId, workerId: w.workerId, workerState: w.state, ...tel.metrics }
    }))
  )

  return { ts: Date.now(), devices }
}
