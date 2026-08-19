'use strict'

// Hand-rolled YAML serialization (no js-yaml dependency) for the small,
// fixed-shape "SiteLaunch spec" document served at GET /v1/sites/{id}/spec.yaml
// and built client-side for the pre-launch draft download. Written as a tiny
// UMD-lite module so the exact same function can run in Node (server.js) and,
// unmodified, in a browser <script> tag (no bundler) if the console ever
// wants to build the same draft without round-tripping the server.

;(function (root) {
  // A YAML double-quoted scalar accepts the same backslash escapes as a JSON
  // string for the plain-ASCII content this launcher ever produces (site
  // names, versions, ids, enum values), so JSON.stringify is a safe, simple
  // YAML quoter here.
  function q (value) {
    return JSON.stringify(String(value))
  }

  // A plain YAML document (siteId/slot/state/notes + the SiteLaunch spec
  // under `launch:`) — not OpenAPI-flavored. This repo's actual transport is
  // JSON-RPC 2.0 (see openrpc/launch.openrpc.json), so this file intentionally
  // doesn't borrow OpenAPI vocabulary for a spec download.

  function notesBlock (notes) {
    const text = String(notes || '')
    if (text.trim() === '') return "notes: ''"
    const body = text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => '  ' + line)
      .join('\n')
    return 'notes: |\n' + body
  }

  function buildSpecYaml (input) {
    const {
      siteId = null,
      slot = null,
      state = 'draft',
      spec,
      notes = '',
      createdAt = null,
      updatedAt = null
    } = input || {}

    if (!spec || !spec.metadata || !spec.spec || !spec.spec.template) {
      throw new Error('buildSpecYaml requires a SiteLaunch-shaped spec')
    }

    const lines = []
    lines.push(`siteId: ${siteId ? q(siteId) : 'null'}`)
    lines.push(`slot: ${Number.isInteger(slot) ? slot : 'null'}`)
    lines.push(`state: ${q(state || 'draft')}`)
    if (createdAt) lines.push(`createdAt: ${q(createdAt)}`)
    if (updatedAt) lines.push(`updatedAt: ${q(updatedAt)}`)
    lines.push(notesBlock(notes))
    lines.push('launch:')
    lines.push(`  apiVersion: ${q(spec.apiVersion)}`)
    lines.push(`  kind: ${q(spec.kind)}`)
    lines.push('  metadata:')
    lines.push(`    name: ${q(spec.metadata.name)}`)
    if (Number.isInteger(spec.metadata.slot)) {
      lines.push(`    slot: ${spec.metadata.slot}`)
    }
    lines.push('  spec:')
    lines.push('    template:')
    lines.push(`      name: ${q(spec.spec.template.name)}`)
    lines.push(`      version: ${q(spec.spec.template.version)}`)
    lines.push(`    persistence: ${q(spec.spec.persistence)}`)
    // spec.auth.password reaches here already redacted -- src/server.js's
    // createSiteRpc() overwrites it with the fixed placeholder before the
    // spec is ever stored in a SiteRecord (see design/plugin-basic-auth.md's
    // "Password handling"). This file never sees, and could not leak, the
    // real plaintext or the salt/hash.
    if (spec.spec.auth) {
      lines.push('    auth:')
      lines.push(`      username: ${q(spec.spec.auth.username)}`)
      lines.push(`      password: ${q(spec.spec.auth.password)}`)
    }
    if (Array.isArray(spec.spec.plugins) && spec.spec.plugins.length) {
      lines.push('    plugins:')
      spec.spec.plugins.forEach((name) => lines.push(`      - ${q(name)}`))
    }
    return lines.join('\n') + '\n'
  }

  const api = { buildSpecYaml }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  } else {
    root.MdkSpecYaml = api
  }
})(typeof window !== 'undefined' ? window : globalThis)
