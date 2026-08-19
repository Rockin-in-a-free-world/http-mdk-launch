// Real, statically-resolved side-effect imports for the language grammars
// @stoplight/mosaic-code-viewer (used inside the JSON Schema Viewer that
// @metamask/open-rpc-docs-react's ContentDescriptor renders) wants
// registered on the shared global `Prism` instance. Importing them for
// real here — reached through a genuine ESM `import`, not a stray runtime
// `require()` — lets Rollup's CJS interop convert them properly; see
// require-shim.js for why mosaic-code-viewer's own (unconverted) requires
// for these same modules are safe to no-op once this file has run.
// prism-clojure.js (and friends, below) reference a bare ambient `Prism`
// global rather than importing it — they only ever worked as concatenated
// <script> tags after prism-core.js ran. Importing prism-core for real
// first makes prism-core.js's own `_self.Prism = …` assignment run and set
// window.Prism before the language files' top-level code touches it.
import 'prismjs/components/prism-core'

// Order matters: each language must load after whatever it `require`s per
// prismjs's own components.json (e.g. csharp/java need clike first; php
// needs markup → markup-templating first). This is that dependency set,
// topologically sorted — see the one-off script used to derive it in the
// PR/commit description; regenerate with prismjs's components.json if this
// language list ever changes.
import 'prismjs/components/prism-clojure'
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-csharp'
import 'prismjs/components/prism-http'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-kotlin'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-markup-templating'
import 'prismjs/components/prism-php'
import 'prismjs/components/prism-powershell'
import 'prismjs/components/prism-r'
import 'prismjs/components/prism-ruby'
import 'prismjs/components/prism-swift'
