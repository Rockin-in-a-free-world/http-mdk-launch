'use strict'

const { stats } = require('../lib/store')

// Pure read, no side effects. Response shape matches design/plugins-fragment.json's
// proposed SiteReveal.telemetryStorage exactly, so a future sites.reveal implementation
// can probe this route and drop the result straight in -- the same pattern
// src/server.js's buildReveal() already uses for SiteReveal.telemetry via probeOverview().
module.exports = async function statsRoute () {
  return stats()
}
