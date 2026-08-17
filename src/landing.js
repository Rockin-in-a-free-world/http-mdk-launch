'use strict'

const fs = require('fs')
const path = require('path')
const { versionInfo } = require('./version')

const TABS = [
  { id: 'launch', href: '/launch', label: 'Launch', group: 'site' },
  { id: 'docs', href: '/docs', label: 'API docs', group: 'site' },
  { id: 'openapi', href: '/openapi', label: 'OpenAPI', group: 'spec' }
]

function escapeHtml (s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function tabsHtml (active) {
  const trigger = (tab) => {
    const state = tab.id === active ? 'active' : 'inactive'
    const current = tab.id === active ? ' aria-current="page"' : ''
    return `<a class="mdk_tabs__trigger" href="${tab.href}" data-state="${state}"${current}>${tab.label}</a>`
  }
  const site = TABS.filter((t) => t.group === 'site').map(trigger).join('\n          ')
  const spec = TABS.filter((t) => t.group === 'spec').map(trigger).join('\n          ')
  return `
        <div class="mdk_tabs">
          <div class="mdk_tabs__list" role="tablist" aria-label="Launcher pages">
            <div class="mdk_tabs__group" role="group" aria-label="Site">
              ${site}
            </div>
            <span class="mdk_tabs__divider" role="separator" aria-orientation="vertical"></span>
            <div class="mdk_tabs__group" role="group" aria-label="Spec">
              ${spec}
            </div>
          </div>
        </div>`
}

function shell ({ title, active, wide, panel }) {
  const pageClass = wide ? 'mdk-ui-shell-page mdk-ui-shell-page--wide' : 'mdk-ui-shell-page'
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <div class="mdk-ui-shell-root">
    <header class="mdk-app-header">
      <a class="mdk-app-header__brand" href="/launch" aria-label="Home">
        <span class="mdk-app-header__wordmark">MDK</span>
        <span class="mdk-app-header__appname">Site launcher</span>
      </a>
    </header>
    <main class="mdk-ui-shell-main">
      <div class="${pageClass}">
        <header class="mdk-ui-shell-page__header" style="display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:2.25rem">
          <h1 class="mdk-ui-shell-page__title">Site launcher</h1>
        </header>
        ${tabsHtml(active)}
        <div class="mdk_tabs__panel">
          ${panel}
        </div>
      </div>
    </main>
  </div>
</body>
</html>
`
}

function launchPanel () {
  const v = versionInfo()
  const curl = `curl -sS -X POST "$HOST/v1/sites" \\
  -H "content-type: application/json" \\
  -H "Idempotency-Key: demo-1" \\
  -d '{"apiVersion":"launch.mdk.tether.io/v1alpha1","kind":"SiteLaunch","metadata":{"name":"hobby-demo"},"spec":{"template":{"name":"minimal-site","version":"0.6.0"},"persistence":"ephemeral"}}'`

  return `
        <div class="mdk-path" aria-label="Request path">
          <span class="mdk-path__dot" data-node="browser"></span> Browser
          <span class="mdk-path__arrow">→</span>
          <span class="mdk-path__dot" data-node="launcher"></span> Launcher
          <span class="mdk-path__arrow">→</span>
          <span class="mdk-path__dot mdk-path__dot--idle" data-node="gateway"></span> Gateway
          <span class="mdk-path__arrow">→</span>
          <span class="mdk-path__dot mdk-path__dot--idle" data-node="kernel"></span> Kernel
          <span class="mdk-path__arrow">→</span>
          <span class="mdk-path__dot mdk-path__dot--idle" data-node="worker"></span> Worker
          <span class="mdk-path__arrow">→</span>
          <span class="mdk-path__dot mdk-path__dot--idle" data-node="device"></span> Mock device
        </div>
        <div class="mdk-grid">
          <section class="mdk-card">
            <p class="mdk-card__label">Worker</p>
            <div id="worker-id" style="font-size:1.15rem;font-weight:600;color:var(--mdk-color-text-primary)">—</div>
            <div style="margin-top:0.75rem;display:flex;flex-wrap:wrap;gap:0.5rem">
              <span class="mdk-badge mdk-badge--wait" id="worker-state">no site</span>
              <span class="mdk-badge mdk-badge--wait" id="worker-devices">0 devices</span>
              <span class="mdk-badge mdk-badge--wait" id="worker-key">key —</span>
            </div>
          </section>
          <section class="mdk-card">
            <p class="mdk-card__label" id="device-id">device</p>
            <p class="mdk-stat" id="device-stat">—<span class="mdk-stat__unit" id="device-unit"></span></p>
            <div style="margin-top:0.75rem;display:flex;flex-wrap:wrap;gap:0.5rem">
              <span class="mdk-badge mdk-badge--wait" id="device-health">idle</span>
              <span class="mdk-badge mdk-badge--ok" id="health-badge">launcher</span>
            </div>
          </section>
        </div>
        <section class="mdk-card">
          <p class="mdk-card__label">Stack identity</p>
          <dl class="mdk-list">
            <div class="mdk-list__row"><dt class="mdk-list__label">Gateway</dt><dd class="mdk-list__value" id="id-gateway">—</dd></div>
            <div class="mdk-list__row"><dt class="mdk-list__label">Kernel</dt><dd class="mdk-list__value" id="id-kernel">—</dd></div>
            <div class="mdk-list__row"><dt class="mdk-list__label">Worker</dt><dd class="mdk-list__value" id="id-worker">—</dd></div>
            <div class="mdk-list__row"><dt class="mdk-list__label">PIN</dt><dd class="mdk-list__value"><a href="${escapeHtml(v.MDK_RUNTIME_URL)}">${escapeHtml(v.MDK_RUNTIME_URL)}</a></dd></div>
          </dl>
        </section>
        <section class="mdk-card">
          <p class="mdk-card__label">Query</p>
          <p class="mdk-card__lead">This curl starts one local MDK 0.6 site on loopback. In a terminal, <code>export HOST=http://127.0.0.1:8099</code> (this page's origin), then poll <code>GET /ready</code>. One site at a time.</p>
          <pre class="workbench-query-box__code"><code>${escapeHtml(curl)}</code></pre>
        </section>
        <script>
          function setDot (name, on) {
            const el = document.querySelector('[data-node="' + name + '"]')
            if (!el) return
            el.classList.toggle('mdk-path__dot--idle', !on)
          }
          function setText (id, text) {
            const el = document.getElementById(id)
            if (el) el.textContent = text
          }
          function setBadge (id, text, ok) {
            const el = document.getElementById(id)
            if (!el) return
            el.textContent = text
            el.className = 'mdk-badge ' + (ok ? 'mdk-badge--ok' : 'mdk-badge--wait')
          }
          async function refresh () {
            const health = await fetch('/health').then((r) => r.json()).catch(() => null)
            const ready = await fetch('/ready').then((r) => r.json()).catch(() => null)
            setDot('browser', true)
            setDot('launcher', !!(health && health.status === 'ok'))
            const live = !!(ready && ready.ready)
            setDot('gateway', live)
            setDot('kernel', live && !!(ready.identity && ready.identity.kernel))
            setDot('worker', live && !!(ready.identity && ready.identity.worker))
            if (health && health.status === 'ok') setText('health-badge', 'launcher live')
            if (!live) {
              setDot('device', false)
              setText('worker-id', '—')
              setBadge('worker-state', ready && ready.reason ? ready.reason : 'no site', false)
              setBadge('worker-devices', '0 devices', false)
              setBadge('worker-key', 'key —', false)
              setText('device-id', 'device')
              setText('device-stat', '—')
              setText('device-unit', '')
              setBadge('device-health', 'idle', false)
              setText('id-gateway', '—')
              setText('id-kernel', '—')
              setText('id-worker', '—')
              return
            }
            const ident = ready.identity || {}
            if (ident.gateway) setText('id-gateway', ident.gateway.id)
            if (ident.kernel) setText('id-kernel', ident.kernel.publicKeyFingerprint)
            if (ident.worker) {
              setText('worker-id', ident.worker.id)
              setText('id-worker', ident.worker.id + ' ' + ident.worker.publicKeyFingerprint)
              setBadge('worker-key', 'key ' + ident.worker.short, true)
            }
            const overview = await fetch(ready.overview).then((r) => r.json()).catch(() => null)
            const device = overview && overview.devices && overview.devices[0]
            setDot('device', !!device)
            if (device) {
              setBadge('worker-state', device.workerState || 'READY', true)
              setBadge('worker-devices', (overview.devices.length) + ' device', true)
              setText('device-id', device.deviceId)
              const el = document.getElementById('device-stat')
              if (el) el.innerHTML = (device.hashrate_rt != null ? Number(device.hashrate_rt).toFixed(2) : '—') +
                '<span class="mdk-stat__unit">TH/s</span>'
              setBadge('device-health', (device.power != null ? Math.round(device.power) + ' W' : 'OK'), true)
            }
          }
          refresh()
          setInterval(refresh, 3000)
        </script>`
}

function landingHtml () {
  return shell({
    title: 'MDK site launcher',
    active: 'launch',
    wide: false,
    panel: launchPanel()
  })
}

function docsFrameHtml () {
  return shell({
    title: 'MDK launcher API',
    active: 'docs',
    wide: true,
    panel: '<iframe class="mdk-docs-frame" title="Launcher OpenAPI" src="/docs/redoc.html"></iframe>'
  })
}

function openapiHtml () {
  const yamlPath = path.join(__dirname, '..', 'dist', 'docs', 'openapi.yaml')
  let yaml = ''
  try {
    yaml = fs.readFileSync(yamlPath, 'utf8')
  } catch {
    yaml = 'Run npm run build:docs to generate openapi.yaml'
  }
  return shell({
    title: 'MDK launcher OpenAPI',
    active: 'openapi',
    wide: true,
    panel: `
        <p class="mdk-card__label">Query</p>
        <p class="mdk-card__lead">Raw spec also at <a href="/docs/openapi.yaml">/docs/openapi.yaml</a>. Refresh keeps this tab because the URL is <code>/openapi</code>.</p>
        <pre class="workbench-query-box__code"><code>${escapeHtml(yaml)}</code></pre>`
  })
}

module.exports = { landingHtml, docsFrameHtml, openapiHtml }
