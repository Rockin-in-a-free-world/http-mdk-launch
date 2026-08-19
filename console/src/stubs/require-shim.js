// A couple of files inside @stoplight/json-schema-viewer's dependency
// chain (mosaic-code-viewer's code-viewer.esm.js, specifically) are shipped
// as ESM but contain a handful of bare top-level `require(...)` calls —
// real Node/webpack-only CJS patterns that Rollup's build doesn't convert
// because the containing module is already ES-module-shaped. In a browser
// bundle `require` is simply undefined, so those calls throw
// "require is not defined" the moment the module loads (not lazily). Every
// occurrence we've hit is one of:
//  - `require('prismjs/components/prism-<lang>')`, called only for the
//    Prism.languages registration side effect (see prism-languages.js,
//    imported for real above this shim installs).
//  - `require('@stoplight/json-schema-merge-allof')`, whose actual export
//    we import for real below and hand back from the shim.
// If a build ever hits a require() for something outside this list, this
// throws a clear error naming the module id instead of a bare
// "require is not defined".
import mergeAllOf from '@stoplight/json-schema-merge-allof'
import './prism-languages.js'

const REQUIRE_MAP = {
  '@stoplight/json-schema-merge-allof': mergeAllOf
}

function shimRequire (id) {
  if (Object.prototype.hasOwnProperty.call(REQUIRE_MAP, id)) return REQUIRE_MAP[id]
  if (id.startsWith('prismjs/components/')) return undefined // already registered above
  throw new Error(`console require-shim: unhandled module "${id}" (add it to REQUIRE_MAP)`)
}

if (typeof globalThis.require !== 'function') {
  globalThis.require = shimRequire
}
