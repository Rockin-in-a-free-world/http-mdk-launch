import { useEffect, useMemo, useState } from 'react'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { Provider as MosaicProvider } from '@stoplight/mosaic'
import Method from '@metamask/open-rpc-docs-react'
import Inspector from '@open-rpc/inspector'
import { openrpcDoc } from './openrpcDoc'
import { buildMuiTheme } from './theme'
import { CodeBlock } from './CodeBlock'

const TABS = [
  { id: 'launch', href: '/launch/1', label: 'Launch', group: 'site' },
  { id: 'docs', href: '/docs', label: 'API docs', group: 'site' },
  { id: 'openrpc', href: '/openrpc', label: 'OpenRPC', group: 'spec' }
]

// Same markup/classes as tabsHtml() in src/landing.js, so this separately
// built app still renders the launcher's real header/tabs chrome (from the
// shared /app.css) instead of a bolted-on look of its own.
function TabsNav ({ active }) {
  const trigger = (tab) => (
    <a
      key={tab.id}
      className="mdk_tabs__trigger"
      href={tab.href}
      data-state={tab.id === active ? 'active' : 'inactive'}
      aria-current={tab.id === active ? 'page' : undefined}
    >
      {tab.label}
    </a>
  )
  return (
    <div className="mdk_tabs">
      <div className="mdk_tabs__list" role="tablist" aria-label="Launcher pages">
        <div className="mdk_tabs__group" role="group" aria-label="Site">
          {TABS.filter((t) => t.group === 'site').map(trigger)}
        </div>
        <span className="mdk_tabs__divider" role="separator" aria-orientation="vertical" />
        <div className="mdk_tabs__group" role="group" aria-label="Spec">
          {TABS.filter((t) => t.group === 'spec').map(trigger)}
        </div>
      </div>
    </div>
  )
}

function groupByTag (methods) {
  const order = []
  const byTag = new Map()
  for (const method of methods) {
    const tag = (method.tags && method.tags[0] && method.tags[0].name) || 'other'
    if (!byTag.has(tag)) {
      byTag.set(tag, [])
      order.push(tag)
    }
    byTag.get(tag).push(method)
  }
  return order.map((tag) => [tag, byTag.get(tag)])
}

// Params-by-name, matching how src/server.js's rpcMethods actually read
// params (e.g. `params.spec`, `params.siteId`) — not a positional array.
function paramsFromExample (method) {
  const example = method.examples && method.examples[0]
  if (!example || !Array.isArray(example.params)) return {}
  const out = {}
  for (const p of example.params) out[p.name] = p.value
  return out
}

function buildRequest (method, requestId) {
  return {
    jsonrpc: '2.0',
    method: method.name,
    params: paramsFromExample(method),
    id: requestId
  }
}

// @open-rpc/inspector's HTTP transport reads `credentials` straight out of
// this descriptor's `schema.examples[0]` as its default transport-options
// value (see useTransport/Inspector.js) — this is the documented "x-transport"
// options shape, not a hack. `include` is what makes the try-it panel ride
// the launcher_session cookie set by auth.createWallet/session.create.
const HTTP_TRANSPORT_WITH_CREDENTIALS = {
  type: 'http',
  name: 'HTTP',
  schema: {
    type: 'object',
    properties: {
      headers: { patternProperties: { '': { type: 'string' } } },
      credentials: { type: 'string', enum: ['omit', 'same-origin', 'include'] }
    },
    examples: [{ headers: {}, credentials: 'include' }]
  }
}

export default function App () {
  const [dark, setDark] = useState(true)
  const methods = openrpcDoc.methods || []
  const [activeName, setActiveName] = useState(methods[0] && methods[0].name)
  const [requestNonce, setRequestNonce] = useState(1)

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  const muiTheme = useMemo(() => buildMuiTheme(dark), [dark])
  const groups = useMemo(() => groupByTag(methods), [methods])
  const activeMethod = methods.find((m) => m.name === activeName) || methods[0]
  const activeRequest = useMemo(
    () => (activeMethod ? buildRequest(activeMethod, requestNonce) : undefined),
    [activeMethod, requestNonce]
  )

  function selectMethod (name) {
    setActiveName(name)
    setRequestNonce((n) => n + 1)
  }

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <MosaicProvider>
        <div className="mdk-ui-shell-root">
          <header className="mdk-app-header">
            <a className="mdk-app-header__brand" href="/launch/1" aria-label="Home">
              <span className="mdk-app-header__wordmark">MDK</span>
              <span className="mdk-app-header__appname">Site launcher</span>
            </a>
            <button
              type="button"
              className="console-theme-toggle"
              onClick={() => setDark((d) => !d)}
              aria-label="Toggle theme"
            >
              {dark ? 'dark' : 'light'}
            </button>
          </header>
          <main className="mdk-ui-shell-main">
            <div className="mdk-ui-shell-page mdk-ui-shell-page--wide">
              <header className="mdk-ui-shell-page__header">
                <h1 className="mdk-ui-shell-page__title">API console</h1>
              </header>
              <TabsNav active="docs" />
              <div className="mdk_tabs__panel">
                <p className="mdk-card__lead console-intro">
                  Every method below is real — it dispatches to the same <code>rpcMethods</code> this launcher
                  serves at <code>POST /v1/rpc</code>. Pick a method, read its params/result/errors, then hit
                  Play in "Try it" to run it for real. Session-gated calls (<code>sites.create</code>,{' '}
                  <code>sites.reveal</code>, …) return the real <code>-32001</code> error until you sign in
                  via the Wallet card on the <a href="/launch/1">Launch</a> tab in this same browser session.
                </p>
                <div className="console-shell">
                  <nav className="console-methods" aria-label="RPC methods">
                    {groups.map(([tag, list]) => (
                      <div className="console-methods__group" key={tag}>
                        <p className="console-methods__group-label">{tag}</p>
                        {list.map((m) => (
                          <button
                            key={m.name}
                            type="button"
                            className="console-methods__item"
                            data-active={m.name === activeName ? 'true' : 'false'}
                            onClick={() => selectMethod(m.name)}
                          >
                            {m.name}
                          </button>
                        ))}
                      </div>
                    ))}
                  </nav>
                  <section className="console-main">
                    <div className="mdk-card console-doc">
                      {activeMethod && <Method method={activeMethod} components={{ CodeBlock }} />}
                    </div>
                    <div className="mdk-card console-tryit">
                      <p className="mdk-card__label">Try it</p>
                      <div className="console-inspector">
                        <Inspector
                          key={activeName}
                          url="/v1/rpc"
                          openrpcDocument={openrpcDoc}
                          request={activeRequest}
                          darkMode={dark}
                          onToggleDarkMode={() => setDark((d) => !d)}
                          customTransport={HTTP_TRANSPORT_WITH_CREDENTIALS}
                        />
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </main>
        </div>
      </MosaicProvider>
    </ThemeProvider>
  )
}
