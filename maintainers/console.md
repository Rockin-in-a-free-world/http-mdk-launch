# The `/docs` console — maintenance deep dive

`GET /docs` serves an interactive JSON-RPC documentation console: read the spec for each
`/v1/rpc` method, then actually run it against this launcher ("Try it"). It is the least
self-explanatory part of this codebase — a MetaMask-maintained fork of an OpenRPC docs
renderer, Stoplight's Mosaic component family, a separate "try it" tool from the OpenRPC
org, and several hand-written Vite compatibility shims, all glued into one page. This
document exists so a future maintainer with zero memory of building this can safely change
it, upgrade its dependencies, or fix it when a dependency breaks.

Everything below was read directly from the files in `console/` during the writing of this
document (2026-08-19) — file paths and quoted lines are real, not reconstructed from memory.

## 1. What's in this stack, and why

`console/package.json`'s `dependencies`:

```json
"@emotion/cache": "^11.14.0",
"@emotion/react": "^11.14.0",
"@emotion/styled": "^11.14.1",
"@metamask/open-rpc-docs-react": "0.2.0",
"@mui/icons-material": "6.3.1",
"@mui/material": "6.3.1",
"@open-rpc/inspector": "2.0.3",
"@stoplight/mosaic": "1.32.0",
"monaco-editor": "0.52.2",
"react": "18.3.1",
"react-dom": "18.3.1"
```

- **`@metamask/open-rpc-docs-react`** — the reference-rendering half. Exports a `Method`
  component (used in `console/src/App.jsx` as `<Method method={activeMethod} components={{ CodeBlock }} />`)
  that renders one OpenRPC method's params, result, error list, and examples as readable
  docs. It's a MetaMask fork/wrapper around Stoplight's own doc-rendering primitives —
  under the hood it pulls in `@stoplight/mosaic`, `@stoplight/json-schema-viewer`, and
  `@stoplight/markdown-viewer` to actually draw the parameter/schema trees. This package is
  why Stoplight Mosaic is in this dependency tree at all — it isn't a direct, deliberate
  choice by this repo, it's inherited from the docs renderer's own implementation.
- **`@open-rpc/inspector`** — the "try it" half. A self-contained Monaco-editor-based
  request/response panel with a Play button that makes a real HTTP call and shows the real
  response. Rendered in `App.jsx` as `<Inspector url="/v1/rpc" openrpcDocument={openrpcDoc} request={activeRequest} ... />`.
  Ships its own UI chrome built on MUI, which is why `@mui/material`/`@mui/icons-material`
  are direct dependencies here even though nothing in this repo's own JSX imports much MUI
  beyond `ThemeProvider`/`CssBaseline` in `App.jsx`.
- **`@mui/material`** — Inspector's own UI framework (tabs, buttons, dialogs inside the
  Inspector panel). `console/src/theme.js`'s `buildMuiTheme()` re-themes it to match the
  launcher's look rather than shipping MUI's defaults.
- **`monaco-editor`** — the actual code editor Inspector embeds for the request/response
  JSON. `@open-rpc/inspector` imports it as an external peer (`import * as monaco from
  "monaco-editor"`, left un-bundled by the package), so *this* app owns wiring Monaco's web
  workers — see `console/src/monacoWorkers.js`, described in §3.

**This is React 18 + Vite** (`console/package.json`'s `devDependencies`:
`@vitejs/plugin-react`, `vite ^6.0.5`). The rest of this repo (`src/*.js`, `src/landing.js`,
`src/app.css`) is deliberately zero-build vanilla JS served straight from Node — `console/`
is an intentional, isolated exception, confined to its own directory with its own
`package.json`/`package-lock.json`/`node_modules`, precisely so this one page can use a
component ecosystem that has no vanilla-JS equivalent without dragging a build step onto
the rest of the launcher. `console/vite.config.js` says this outright: "The rest of this
repo is deliberately zero-build vanilla JS ... this tool config stays inside `console/` and
must not leak out."

## 2. The build pipeline, concretely

From the repo root: `npm run build:console` — defined in the root `package.json` as:

```json
"build:console": "npm install --prefix console && npm run build --prefix console"
```

That runs `npm install` inside `console/` (installing/refreshing `console/node_modules`
from `console/package-lock.json`), then `vite build` inside `console/` (the `build` script
in `console/package.json`, i.e. `console/package.json`'s own `"build": "vite build"`).
`console/vite.config.js` sets `build.outDir: '../dist/console'` and `emptyOutDir: true` —
so the compiled output lands at `<repo>/dist/console/` (wiping and rewriting it every run),
**not** inside `console/` itself. `base: '/docs/'` in that same config is what makes the
built `index.html`'s asset URLs resolve as `/docs/assets/...` once served.

`src/server.js` serves that output directly, with no further processing:

```js
const DOCS_CONSOLE_DIR = path.join(__dirname, '..', 'dist', 'console')
const DOCS_CONSOLE_INDEX = path.join(DOCS_CONSOLE_DIR, 'index.html')
...
if (req.method === 'GET' && pathname === '/docs') {
  sendFile(res, DOCS_CONSOLE_INDEX, 'text/html; charset=utf-8')
  return 200
}
...
const docsAssetMatch = pathname.match(/^\/docs\/assets\/([^/]+)$/)
if (req.method === 'GET' && docsAssetMatch) {
  const assetName = decodeURIComponent(docsAssetMatch[1])
  const ext = path.extname(assetName).toLowerCase()
  const contentType = DOCS_ASSET_CONTENT_TYPES[ext] || 'application/octet-stream'
  sendFile(res, path.join(DOCS_CONSOLE_DIR, 'assets', assetName), contentType)
  return 200
}
```

So `GET /docs` is `dist/console/index.html`, byte for byte, and `GET /docs/assets/*` is
whatever Vite named the built JS/CSS/wasm/font chunks that run — nothing is templated or
rewritten by the Node server at request time.

**Critically: the OpenRPC spec is bundled at build time, not fetched at runtime.**
`console/src/openrpcDoc.js` does:

```js
import rawDoc from '../../openrpc/launch.openrpc.json'
```

a static ESM import, which Vite inlines into the built JS bundle. `GET /docs/openrpc.json`
(served separately, straight off disk by `src/server.js`) is the *source* copy for anyone
who wants the raw file, but the console you actually see at `/docs` never fetches that route
— it renders whatever was baked into `dist/console/assets/*.js` the last time
`build:console` ran.

**What to run after any change:**

| You changed... | You must run... | Because... |
| --- | --- | --- |
| Anything under `console/src/` | `npm run build:console` | Vite has to recompile the JSX/CSS/stub graph into `dist/console/`. |
| `openrpc/launch.openrpc.json` | `npm run build:console` | The spec is a build-time static import (`openrpcDoc.js`), not a runtime fetch. Editing the JSON and refreshing `/docs` in a browser with a stale `dist/console/` does **nothing** — you'll keep seeing the old methods/params/examples until you rebuild. |
| `console/package.json` deps | `npm run build:console` (runs `npm install --prefix console` first) | Picks up the new/updated package before building against it. |

The Dockerfile (`Dockerfile` at repo root) currently does **not** run `build:console` or
copy `dist/console/` into the runtime image — only `src`, `templates`, and `openrpc` are
copied. A Railway deploy built from this Dockerfile as-is would 404 on `GET /docs` (and on
`GET /docs/assets/*`) because `dist/console/index.html` would never exist in the built
image. This is a known, real gap, not a hypothetical — verify against the current
`Dockerfile` before assuming it's been fixed.

## 3. Every shim in `console/src/stubs/`

All five files exist to make packages that assume a webpack/Docusaurus/CJS environment
work under Vite/Rollup's stricter ESM build. Each is read from the actual file below, not
paraphrased from an earlier summary.

### `browser-polyfills.js`

```js
if (typeof globalThis.process === 'undefined') {
  globalThis.process = {
    env: { NODE_ENV: 'production' },
    platform: 'browser',
    version: '',
    versions: {},
    cwd: () => '/',
    nextTick: (fn, ...args) => setTimeout(() => fn(...args), 0)
  }
}
```

**Problem:** transitive deps (`vfile`/`unified` via `react-markdown`, misc `lodash`/
`prop-types` environment checks) read Node's global `process` — webpack auto-polyfills
this, Vite/Rollup does not. **Imported first, before anything else**, in `console/src/main.jsx`.
**If this becomes unnecessary or insufficient:** you'd see a `ReferenceError: process is not
defined` (or `process.env` / `process.cwd is not a function`) thrown at module-load time,
before the app even renders — a fully blank page with that error at the top of the browser
console. If a future dependency upgrade removes the need for this, the failure mode of
*leaving it in* is harmless (it's a no-op once nothing reads the polyfilled fields); the
risk is only in removing it too early.

### `require-shim.js`

```js
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
```

**Problem:** part of `@stoplight/json-schema-viewer`'s dependency chain
(`mosaic-code-viewer`'s `code-viewer.esm.js`, per the file's own comment) ships as ESM but
contains bare top-level `require(...)` calls — real Node/webpack-only CJS patterns Rollup
doesn't convert because the containing module is already ES-module-shaped. In a browser
bundle, `require` is simply undefined, so these calls throw `require is not defined` the
moment the module loads. This shim installs a `globalThis.require` that resolves the two
specific cases actually hit: `prismjs/components/prism-<lang>` (registered for real by
`prism-languages.js`, imported one line above) and `@stoplight/json-schema-merge-allof`
(imported for real and handed back from the map). **Imported second**, right after
`browser-polyfills`, in `main.jsx`.

**If a future dependency upgrade makes this unnecessary:** harmless to leave — it only
installs the shim `if (typeof globalThis.require !== 'function')`, so if a newer Stoplight
release fixes its own bare `require()` calls, this file simply never gets exercised.
**If a future dependency upgrade makes this *insufficient*** (a new bare `require('some-new-module')`
call appears somewhere in the dependency graph that isn't already in `REQUIRE_MAP`): you'll
get a clear, named error — `console require-shim: unhandled module "some-new-module"` —
rather than the opaque `require is not defined`. That's this shim doing its job; the fix is
adding the new module id to `REQUIRE_MAP` (importing it for real and mapping the id to the
import), following the existing pattern.

### `prism-languages.js`

Real, statically-resolved side-effect imports (`import 'prismjs/components/prism-core'`,
then a specific, order-dependent list: `clojure`, `clike`, `csharp`, `http`, `java`,
`kotlin`, `markup`, `markup-templating`, `php`, `powershell`, `r`, `ruby`, `swift`) that
register those language grammars on the shared global `Prism` object,
`@stoplight/mosaic-code-viewer`'s JSON Schema Viewer wants available. **Problem this
solves:** the underlying PrismJS language files reference a bare ambient `Prism` global
(they were only ever designed to work as concatenated `<script>` tags after
`prism-core.js` ran) rather than importing it — so `prism-core` has to be imported for real
first (making it set `window.Prism`) before the language files' own top-level code touches
it. **Order matters**: the file's own comment states dependencies (`csharp`/`java` need
`clike` first; `php` needs `markup` → `markup-templating` first) — this is "topologically
sorted" per that comment, and should be regenerated from PrismJS's own `components.json` if
this language list ever needs to change (e.g. a new example language shows up in the spec).
**If insufficient:** a schema example using a language not in this list would render
without syntax highlighting for that block (Prism just doesn't recognize the language),
not a hard crash — a visual regression, not a broken page.

### `prism-styles.js`

```js
export const materialDark = {}
export const materialLight = {}
```

Stub for `react-syntax-highlighter/dist/cjs/styles/prism`, paired with the
`react-syntax-highlighter` stub below (which ignores the `style` prop entirely) — these two
named exports just need to exist as importable names so the module graph resolves; their
values are never read. **If insufficient:** a new/different import name from that path
(not `materialDark`/`materialLight`) would throw a plain "undefined is not a function"-style
error wherever it's destructured — you'd trace it back to this file needing a new named
export added (still `{}`, since the value is never used).

### `react-syntax-highlighter.js`

```js
import { createElement } from 'react'

export function Prism ({ children, className }) {
  return createElement('code', { className }, children)
}

export default Prism
```

**Problem:** `@metamask/open-rpc-docs-react`'s `MarkdownDescription` component imports the
real `react-syntax-highlighter` package's full `Prism` bundle, which does a synchronous
`require('prismjs/components/prism-<lang>')` for every one of its ~200 supported languages
at module-load time — a bare CJS pattern that (like the shim above) Rollup doesn't convert,
so it throws immediately. Since `MarkdownDescription` in this console only ever renders
inline code spans inside method/param prose (the real JSON-RPC request/response examples go
through this repo's own `CodeBlock` component via the `components` prop passed to `Method`),
full syntax highlighting there buys nothing — this stub swaps in a plain `<code>` element
instead of paying for the whole language bundle. Written with `createElement` rather than
JSX specifically so this file can stay a plain `.js` module regardless of the build's
per-extension JSX-parsing rules. **If insufficient:** you'd see unstyled (but still
correctly rendered) inline code in method descriptions — a cosmetic downgrade, not a crash.
If a future docs-react upgrade renders full multi-line code blocks through this path
(instead of only inline spans), you'd notice a loss of syntax coloring on those specific
blocks, which is the signal to reconsider whether the stub is still the right tradeoff.

### `docusaurus-router.js`

```js
export function useHistory () {
  return { push () {}, replace () {} }
}

export function useLocation () {
  return { pathname: '', search: '', hash: '' }
}
```

**Problem:** `@metamask/open-rpc-docs-react`'s own `index.js` unconditionally `require()`s
`InteractiveMethod.js` — a MetaMask-wallet-specific "Send Request via `window.ethereum`"
form this console does not use (the real "try it" experience is `@open-rpc/inspector`
instead) — and that file top-level-imports `@docusaurus/router` for a couple of hooks it
only *calls* inside its own render body. Since `InteractiveMethod` is never actually
mounted anywhere in `App.jsx`, real Docusaurus routing is never needed; this stub just lets
the module graph resolve without pulling in Docusaurus itself as a dependency.
**If insufficient:** if a future docs-react version actually calls `useHistory()`/
`useLocation()` in a way whose return shape matters (not just avoiding an import error),
you'd see a runtime error inside `InteractiveMethod` — but since that component is never
rendered by this app, in practice this would only surface if `App.jsx` starts rendering
`InteractiveMethod` for some reason.

**Wiring**: all three module-name stubs (`docusaurus-router`, and the two
`react-syntax-highlighter` paths) are registered as Vite aliases in `console/vite.config.js`:

```js
resolve: {
  alias: {
    '@docusaurus/router': `${dirname}src/stubs/docusaurus-router.js`,
    'react-syntax-highlighter/dist/cjs/styles/prism': `${dirname}src/stubs/prism-styles.js`,
    'react-syntax-highlighter': `${dirname}src/stubs/react-syntax-highlighter.js`
  }
}
```

`browser-polyfills.js` and `require-shim.js` are not aliases — they're imported directly, in
that exact order, at the top of `console/src/main.jsx`, before anything else (including
`monacoWorkers.js`, then `App.jsx`).

## 4. How do I change the look

The accent color (`#f7931a`), font, and dark-mode wiring are split across **two separate
mechanisms** that must both be updated to change the look consistently — the Stoplight
Mosaic side (CSS variables + a `data-theme` attribute) and the MUI/Monaco side (a JS
`createTheme()` call whose `palette.mode` also drives Monaco's `vs`/`vs-dark` choice
inside `@open-rpc/inspector`). This section is self-contained — you should not need to read
any other file to make this change.

### (a) The Stoplight Mosaic side

File: **`console/src/styles.css`**, lines 15–51:

```css
:root,
[data-theme='dark'] {
  --font-ui: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  --color-primary: #f7931a;
  --color-primary-dark: #d97b0f;
  --color-primary-darker: #b8660c;
  --color-primary-light: #f8a348;
  --color-primary-tint: rgba(247, 147, 26, 0.16);
  --color-text-primary: #f7931a;
  --color-on-primary: #17130f;

  --color-canvas: #0a0a09;
  /* ...canvas/border/text variables continue... */
}
```

These are **Stoplight Mosaic's own CSS variable names** (`--color-primary`,
`--color-canvas*`, `--color-border*`, `--color-text*`, `--font-ui`, `--font-mono`) —
`@metamask/open-rpc-docs-react` ships a scoped copy of Mosaic's utility CSS (class-prefixed
`.stoplight …`), and that copy only paints color once something sets
`data-theme="dark"` (or `"light"`) on an ancestor element. This file's own leading comment
states the mechanism plainly: "that copy only paints color once something sets
`data-theme=\"dark\"`... on an ancestor". The block above targets `:root,
[data-theme='dark']` (i.e. it applies as the default *and* whenever dark mode is
explicitly set) and repaints Mosaic's brand tokens on top of Mosaic's own dark defaults for
everything not overridden (success/danger/warning/shadows stay Mosaic's own values).

**Who sets `data-theme`:** `console/src/App.jsx`:

```js
useEffect(() => {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}, [dark])
```

**To change the accent color for the docs-rendering half:** edit `--color-primary` (and,
for consistency, `--color-primary-dark`/`--color-primary-darker`/`--color-primary-light`/
`--color-primary-tint`/`--color-text-primary`) in `console/src/styles.css`'s `:root,
[data-theme='dark']` block. There is currently no separate light-mode override block for
these Mosaic variables — the same values apply regardless of `dark` state (only `:root,
[data-theme='dark']` is defined; there's no matching `[data-theme='light']` block in this
file) — so a light-mode-specific accent would need a new rule added.

**To change the font:** edit `--font-ui`/`--font-mono` in the same block, and the plain
`body { font-family: ... }` rule a few lines below it (also `console/src/styles.css`). The
Google Font itself (`JetBrains Mono`) is loaded via `<link>` tags in `console/index.html`
(`https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;800&display=swap`)
— changing the font family name requires updating that `<link>` too, or the new family name
won't resolve to any loaded font file.

### (b) The MUI/Monaco side

File: **`console/src/theme.js`**, in full:

```js
import { createTheme } from '@mui/material/styles'

export const MDK_FONT = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
export const MDK_ORANGE = '#f7931a'

export function buildMuiTheme (dark) {
  return createTheme({
    palette: {
      mode: dark ? 'dark' : 'light',
      primary: { main: MDK_ORANGE, contrastText: '#17130f' },
      ...(dark
        ? {
          background: { default: '#0a0a09', paper: '#17130f' },
          text: { primary: '#f5f5f0', secondary: '#b7b7af' },
          divider: '#26251f'
        }
        : {})
    },
    typography: {
      fontFamily: MDK_FONT,
      button: { textTransform: 'none', fontWeight: 600 }
    },
    shape: { borderRadius: 4 },
    components: {
      MuiButton: {
        styleOverrides: {
          root: { fontFamily: MDK_FONT }
        }
      }
    }
  })
}
```

**To change the accent color for Inspector's own chrome** (tabs, buttons, dialogs inside
the "Try it" panel): edit `MDK_ORANGE` here. It feeds `palette.primary.main`, which MUI
components read directly.

**Monaco's own theme is not set by a separate prop you configure here** — it's derived
automatically. Confirmed directly in `@open-rpc/inspector`'s bundled source
(`console/node_modules/@open-rpc/inspector/dist/index.es.js`): the editor's `theme` option
is computed as `t.palette.mode === "dark" ? "vs-dark" : "vs"`, reading the ambient MUI
theme's `palette.mode` from the `<ThemeProvider>` Inspector is rendered inside — which is
exactly the `mode: dark ? 'dark' : 'light'` set by `buildMuiTheme(dark)` above. So Monaco
switches between VS Code's built-in `vs` (light) and `vs-dark` themes automatically,
in lockstep with the same `dark` boolean that drives everything else — there is no custom
Monaco color theme defined in this codebase to edit.

**Who calls `buildMuiTheme`, and how `dark` state flows**: `console/src/App.jsx`:

```js
const [dark, setDark] = useState(true)
...
const muiTheme = useMemo(() => buildMuiTheme(dark), [dark])
...
<ThemeProvider theme={muiTheme}>
  <CssBaseline />
  <MosaicProvider>
    ...
    <Inspector ... darkMode={dark} onToggleDarkMode={() => setDark((d) => !d)} ... />
```

`dark` defaults to `true` (dark mode by default) and is toggled by the theme-toggle button
in the header (`console-theme-toggle`, styled in `console/src/styles.css`) or by Inspector's
own dark-mode toggle (`onToggleDarkMode`) — both write back to the same `dark` state, which
drives the `useEffect` that sets `data-theme` (part (a) above), `buildMuiTheme(dark)` (this
part), and Monaco transitively.

**Summary — to change the accent color everywhere, consistently, edit three places:**
1. `console/src/styles.css` — Mosaic CSS variables (`--color-primary` and friends).
2. `console/src/theme.js` — `MDK_ORANGE` (feeds MUI, and transitively nothing in Monaco,
   since Monaco only reads light/dark mode, not a custom color).
3. For completeness, the *rest of the launcher's* own accent color lives in
   `src/app.css`'s `--mdk-color-primary: #f7931a` (line 2) — not part of the console build,
   but the value these two console files are matching. If you're rebranding, change all
   three together; they are independent hardcoded copies of the same hex value today, not
   derived from one shared source.

Then run `npm run build:console` (see §2) — none of this takes effect until the build is
re-run.

## 5. Maintenance-risk assessment (checked 2026-08-19)

Checked directly against the npm registry and GitHub, not carried over from an earlier
summary:

- **`@metamask/open-rpc-docs-react`** — pinned at `0.2.0` in `console/package.json`, which
  is also the *latest* version published: `npm view @metamask/open-rpc-docs-react version`
  returns `0.2.0`, published **2024-05-07** (`npm view ... time --json`). The GitHub repo
  (`MetaMask/open-rpc-docs-react`) shows `pushed_at: 2026-05-20` at the repository level,
  but every commit on its default branch's history stops at that same `0.2.0` release commit
  from 2024-05-07 — the more recent repo-level push timestamp does not correspond to any new
  commit reachable from the default branch (most likely a push to a non-default branch or a
  tag), so treat the real "last meaningful release" date as **May 2024**, over two years
  stale as of this check. 1 star, 7 forks, 8 open issues.
- **`@open-rpc/inspector`** — pinned at `2.0.3`, also the latest published version, released
  **2025-03-03**. The GitHub repo (`open-rpc/inspector`) shows `pushed_at: 2024-09-30`, 27
  stars, 8 forks, and **42 open issues** with no recent commit activity visible in the
  default branch beyond that. Quieter than an actively-developed project, but not archived.

Neither package is archived or deprecated on npm as of this check, but neither shows signs
of active maintenance either — treat both as "stable but likely unmaintained," not
"actively supported." If either badly breaks against a future React/Vite major version,
here are the fallback options, cheapest first:

1. **Cheapest — the existing zero-dependency `/openrpc` route.** `GET /openrpc`
   (`src/landing.js`'s `openapiHtml()`) already renders the raw
   `openrpc/launch.openrpc.json` as plain escaped text in a `<pre>` block, served through
   the same zero-build vanilla-JS path as the rest of the launcher (`shell()` in
   `src/landing.js`), with a link to the raw `GET /docs/openrpc.json`. It has **no
   dependency on `console/` at all** — if the console build breaks entirely (a bad
   `npm run build:console`, or `dist/console/` simply absent), `/openrpc` still works and is
   an immediate, zero-effort fallback for "let me see the spec," just without interactivity.
2. **Medium — swap `@metamask/open-rpc-docs-react` for plain `@open-rpc/docs-react`.** The
   non-MetaMask, Material-UI-based original this was forked from, with no Stoplight
   dependency at all (checked: `@open-rpc/docs-react` is at `2.1.1`, published 2025-03-03 —
   more recently touched than the MetaMask fork). This was actually evaluated once already
   in this project's history: rendering was confirmed live against
   `metamask.github.io/api-playground` and found workable, but visually plainer than the
   current Stoplight-flavored rendering. A swap here would drop the `@stoplight/mosaic`
   dependency (and probably several of the `console/src/stubs/` shims tied to Mosaic's
   dependency chain — `require-shim.js` and `prism-languages.js` exist specifically because
   of `@stoplight/json-schema-viewer`'s bare `require()` calls) but would need its own
   theming pass, since it doesn't use Mosaic's `data-theme`/CSS-variable mechanism at all.
3. **Largest, last resort — migrate to an OpenAPI-native renderer** (Stoplight Elements or
   Swagger UI), dropping OpenRPC-specific tooling entirely. This is only viable if the
   launcher's `/v1/rpc` surface were *also* redescribed as OpenAPI — which would be a real
   regression from the deliberate, considered 2026-08-18 decision (documented in
   `/Users/harriebickle/GitHub/Tether/Railway/maintainers/README.md`'s "Pseudo API spec"
   section) to move *away* from OpenAPI/REST specifically because it didn't match how the
   underlying MDK stack actually communicates (JSON-RPC 2.0). Don't reach for this option
   casually — it undoes a decision that was made for a real reason, not out of preference.

### 5a. Backup, done 2026-08-19 — the build no longer needs either package to still exist on npm

Given the finding above, both packages are vendored into this repo, not just referenced by version number:

- `console/vendor/metamask-open-rpc-docs-react-0.2.0.tgz` and `console/vendor/open-rpc-inspector-2.0.3.tgz` — the exact published npm tarballs, grabbed with `npm pack @metamask/open-rpc-docs-react@0.2.0 @open-rpc/inspector@2.0.3` (shasums recorded in that command's own output at capture time; re-run `npm pack` and diff if you ever need to confirm a tarball hasn't changed).
- `console/package.json` points at these directly — `"@metamask/open-rpc-docs-react": "file:./vendor/metamask-open-rpc-docs-react-0.2.0.tgz"` and `"@open-rpc/inspector": "file:./vendor/open-rpc-inspector-2.0.3.tgz"` — not a version range against the registry. A fresh `npm install` in `console/` resolves these from disk; it does not touch the npm registry for either package. Verified by deleting `console/node_modules`+`package-lock.json` and reinstalling clean, then `npm run build:console` and the root `npm test`, all green.
- `console/vendor/src-snapshots/` also holds source (not just built-dist) snapshots, for the harder case of needing to patch/rebuild rather than just consume the compiled output:
  - `open-rpc-docs-react-v0.2.0-source.tar.gz` — GitHub's tag archive for `v0.2.0`, which does correspond exactly to the published npm version.
  - `inspector-f6fdf37-source.tar.gz` — GitHub's archive of commit `f6fdf378cc962ed3655ea7b9dac70f36ecd5bbf5` (the repo's current `master` HEAD as of 2026-08-19). **This does NOT correspond to the published `2.0.3` npm version** — `open-rpc/inspector` has no `2.0.3` (or any `2.x`) git tag at all, checked via `gh api repos/open-rpc/inspector/tags --paginate`, which is itself further evidence of loose maintenance practice on that package. Treat this source snapshot as "the closest available source, not a verified match" — the `.tgz` npm package above is the thing actually running in production; this source archive is a starting point for a rebuild, not a guaranteed-identical reference.

These tarballs total under 4 MB — small enough to commit normally, not something requiring Git LFS or external storage. `console/vendor/` is not covered by any existing `.gitignore` entry (checked with `git check-ignore -v`), so it will be picked up by a normal `git add`.

If you ever need to bump either package to a newer version on purpose, remember to re-`npm pack` the new version into `vendor/`, update `console/package.json`'s `file:` reference, and re-run the clean-install verification above — the old tarball isn't automatically replaced.

**Exact npm registry manifest for both vendored tarballs** (from `npm view <pkg>@<version> dist --json`, checked 2026-08-19 — if this repo is ever slimmed down by dropping the `.tgz` files from git, this table is what you'd need to re-`npm pack` an identical copy, or to verify a re-fetched one still matches):

| Package | Version | Tarball URL | shasum (sha1) | integrity (sha512) | Unpacked size |
|---|---|---|---|---|---|
| `@metamask/open-rpc-docs-react` | `0.2.0` | `https://registry.npmjs.org/@metamask/open-rpc-docs-react/-/open-rpc-docs-react-0.2.0.tgz` | `3712fbd3871dd0f7d680e4c8897e79719ecfa535` | `sha512-lR0RuLLq9D5i3cRFw6osqwKtkl25+uDjmpvkLCCER32q7FWFYqF1v7X1XYlvQciZKwyQaOFukaCFT/tOrjEUdg==` | 317,725 bytes (61 files) |
| `@open-rpc/inspector` | `2.0.3` | `https://registry.npmjs.org/@open-rpc/inspector/-/inspector-2.0.3.tgz` | `2f079b44b9703bd9b37707b590c367d85a99075c` | `sha512-+z75II4SwgLGmltyrZSrIoNLMyiOsN69UknK/ioohN40rKMWMijSzJ+yzad53iB/Dlkqwr1yQD6pO74AA3Y00w==` | 12,958,026 bytes (46 files) |

Committed tarball sizes (as packed, gzip-compressed): `metamask-open-rpc-docs-react-0.2.0.tgz` is 53.7 kB; `open-rpc-inspector-2.0.3.tgz` is 2.7 MB (most of that is Monaco's bundled `ts`/`json`/`html`/`css` language workers, which `@open-rpc/inspector` ships pre-built rather than letting the consuming app supply its own). Source snapshots in `src-snapshots/` add roughly 1.3 MB more. Total `console/vendor/`: ~3.8 MB.

**If slimming the repo is the priority over disaster-recovery for these two packages specifically:** the tarballs and source snapshots in `console/vendor/` are the only thing to remove — delete `console/vendor/`, revert `console/package.json`'s two `file:` dependency lines back to plain version specs (`"0.2.0"` and `"2.0.3"`), and `npm install` again to resolve from the registry. Do this only if the maintenance-risk tradeoff in §5 above is judged acceptable at that time; the manifest above is what lets you redo the vendoring later without re-deriving anything.

**The gap this vendoring does NOT close:** only these 2 of the ~536 packages `console/` resolves are vendored. Everything else — including `@open-rpc/inspector`'s own dependencies on `@open-rpc/client-js`, `@open-rpc/meta-schema`, `@open-rpc/schema-utils-js`, and `@open-rpc/logs-react` (same small `open-rpc` org, same maintenance-risk profile as `inspector` itself), and `@metamask/open-rpc-docs-react`'s own dependencies on the `@rjsf/*` and `@stoplight/*` packages — is still resolved live from the npm registry on every install, with no backup. Closing that gap fully would mean vendoring (or privately mirroring) the entire dependency tree, which is real additional effort and works directly against keeping this repo slim. This was a deliberate, scoped decision — protect the two packages actually named as a concern, not a claim that the whole pipeline is now registry-independent.

## 6. Troubleshooting checklist

**`GET /docs` returns 404 (or the file-not-found JSON error body):**
- Check whether `dist/console/index.html` exists at all (`ls dist/console/`). If it's
  missing, `npm run build:console` was never run (or `dist/` was cleaned/not committed —
  it's gitignored, same as the old Redoc output was). Run `npm run build:console` from the
  repo root and retry.
- If deploying to Railway: as of this checkout, the `Dockerfile` does **not** run
  `build:console` or copy `dist/console/` into the image (see §2) — this is the expected,
  known cause of a 404 on a fresh Railway deploy, not a new bug. The Dockerfile needs that
  build step added before `/docs` will ever work there.

**It builds, but the page renders blank or visibly broken:**
- Open the browser devtools console first. The stub files in `console/src/stubs/` (§3)
  exist specifically to prevent a category of load-time crash (`process is not defined`,
  `require is not defined`, or a Prism/syntax-highlighter throw) — if you see any of those
  exact error shapes, a dependency upgrade likely reintroduced a pattern one of the stubs
  used to cover, or introduced a *new* one the `REQUIRE_MAP` in `require-shim.js` doesn't
  know about yet (that file throws a named error — `unhandled module "..."` — specifically
  so this case is diagnosable instead of a bare crash).
- If the page loads but looks unstyled/wrong (missing accent color, wrong font, Mosaic
  panels rendering with no color): check that `console/index.html`'s `<link
  rel="stylesheet" href="/app.css">` is actually being served (same-origin `/app.css` from
  `src/server.js`) and that `document.documentElement.dataset.theme` is actually getting set
  (§4a) — a stale build after a `styles.css` edit is also a common cause; rebuild.

**"Try it" calls fail with what looks like a CORS error, rather than a real JSON-RPC error
body:**
- Check the `customTransport` wiring in `console/src/App.jsx` — the `HTTP_TRANSPORT_WITH_CREDENTIALS`
  object passed to `<Inspector customTransport={...} />` is what makes Inspector's
  underlying `fetch` include `credentials: 'include'`, which is required for the
  `launcher_session` cookie (set by `auth.createWallet`/`session.create`, see
  `maintainers/architecture.md` §3) to ride along on the same-origin `POST /v1/rpc` call. If
  that credential setting is missing or broken, session-gated methods will look like they're
  failing at the network/CORS layer rather than returning the real, expected `-32001
  ERR_UNAUTHORIZED` JSON-RPC error body — the giveaway that it's this wiring, not a real
  CORS misconfiguration, is that `/v1/rpc` is same-origin (there is no cross-origin request
  happening at all when the console and the API share the same host and port).
- Also confirm you're actually signed in (via the Wallet card on `/launch/1`) before
  expecting a session-gated method (`sites.create`, `sites.reveal`, etc.) to succeed — a
  `-32001` response with no cookie present is the *correct*, documented behavior, not a bug.
