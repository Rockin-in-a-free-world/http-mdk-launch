'use strict'

const { history } = require('../lib/store')

// Pure read, no side effects -- see lib/store.js's history(). req here is the
// pluginReq shape buildFastifyRoutes() constructs
// (backend/core/gateway/workers/lib/plugin-adapter.js): { params, query, body,
// headers, _info }.
module.exports = async function historyRoute (req) {
  const q = req.query || {}
  return {
    samples: history({
      deviceId: q.deviceId,
      field: q.field,
      limit: q.limit,
      from: q.from,
      to: q.to
    })
  }
}
