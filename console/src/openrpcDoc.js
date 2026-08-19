// Bundled at build time from the real, current spec — avoids a runtime
// fetch race against GET /docs/openrpc.json on first paint.
import rawDoc from '../../openrpc/launch.openrpc.json'

// The MetaMask docs-react `Method`/`ContentDescriptor` renderers expect a
// resolved schema tree, not a bare `{ "$ref": "#/components/schemas/X" }"`
// pointer. The doc only ever points at its own `components.schemas`, so a
// small local resolver is enough — no need to pull in a full JSON-Schema
// dereferencing library for this.
function resolveNode (node, root, seen) {
  if (Array.isArray(node)) return node.map((n) => resolveNode(n, root, seen))
  if (node && typeof node === 'object') {
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
      if (seen.has(node.$ref)) return {} // defensive: no real cycles in this doc
      const path = node.$ref.slice(2).split('/')
      let target = root
      for (const key of path) target = target && target[key]
      return resolveNode(target, root, new Set(seen).add(node.$ref))
    }
    const out = {}
    for (const [key, value] of Object.entries(node)) out[key] = resolveNode(value, root, seen)
    return out
  }
  return node
}

export const openrpcDoc = resolveNode(rawDoc, rawDoc, new Set())
