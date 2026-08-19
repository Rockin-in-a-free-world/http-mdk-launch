'use strict'

const fs = require('fs')
const path = require('path')
const { versionInfo } = require('./version')

const TABS = [
  { id: 'launch', href: '/launch/1', label: 'Launch', group: 'site' },
  { id: 'docs', href: '/docs', label: 'API docs', group: 'site' },
  { id: 'openrpc', href: '/openrpc', label: 'OpenRPC', group: 'spec' }
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
  const v = versionInfo()
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
      <a class="mdk-app-header__brand" href="/launch/1" aria-label="Home">
        <span class="mdk-app-header__wordmark">MDK</span>
        <span class="mdk-app-header__appname">Site launcher</span>
      </a>
    </header>
    <main class="mdk-ui-shell-main">
      <div class="${pageClass}">
        <header class="mdk-ui-shell-page__header">
          <h1 class="mdk-ui-shell-page__title">Site launcher</h1>
          <a class="mdk-pin" href="${escapeHtml(v.MDK_RUNTIME_URL)}">${escapeHtml(v.MDK_RUNTIME_URL)}</a>
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

function launchPanel (slot) {
  const currentSlot = Number(slot) || 1
  const curl = `curl -sS -X POST "$HOST/v1/rpc" \\
  -H "content-type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"sites.create","params":{"spec":{"apiVersion":"launch.mdk.tether.io/v1alpha1","kind":"SiteLaunch","metadata":{"name":"hobby-demo"},"spec":{"template":{"name":"minimal-site","version":"0.6.0"},"persistence":"ephemeral"}}},"id":1}'`

  return `
        <section class="mdk-card mdk-wallet">
          <p class="mdk-card__label">Wallet</p>
          <p class="mdk-auth-line mdk-card__lead">
            <span>Enter a BIP-39 seed or create one. Paste a 12-word phrase to sign in. If you create a seed, copy it when it appears — it is shown once. One session covers all three sites.</span>
            <button type="button" class="mdk-info" id="seed-warn-btn" aria-label="Seed phrase warning" aria-expanded="false" aria-controls="seed-warn">i</button>
          </p>
          <p id="seed-warn" class="mdk-seed-warn" hidden>You just handed over that seed; never use it again.</p>
          <p id="auth-status" class="mdk-card__lead">Checking session…</p>
          <pre class="workbench-query-box__code" id="new-seed" hidden></pre>
          <textarea id="seed-input" class="mdk-input" rows="3" placeholder="BIP-39 seed (12 words)"></textarea>
          <div class="mdk-actions">
            <button type="button" class="mdk-cta" id="btn-create">Create seed</button>
            <button type="button" class="mdk-cta" id="btn-signin">Sign in</button>
            <button type="button" class="mdk-cta" id="btn-logout">Sign out</button>
          </div>
        </section>
        <section class="mdk-card mdk-notes">
          <p class="mdk-card__label">Notes</p>
          <p class="mdk-card__lead">Free-text notes for Site ${currentSlot}. Save once the site is live; they land in that site's <code>spec.yaml</code> under <code>notes:</code>.</p>
          <textarea id="notes-input" class="mdk-input" rows="3" placeholder="Notes for this site (saved into spec.yaml)"></textarea>
          <div class="mdk-actions">
            <button type="button" class="mdk-cta" id="btn-save-notes" disabled>Save notes</button>
            <a class="mdk-cta" id="btn-download-spec" href="#" aria-disabled="true">Download spec.yaml</a>
          </div>
          <p class="mdk-card__lead" id="notes-status"></p>
        </section>
        <div class="mdk_tabs mdk_tabs--sites">
          <div class="mdk_tabs__list" role="tablist" aria-label="Sites">
            <div class="mdk_tabs__group" role="group" aria-label="Sites">
              <a class="mdk_tabs__trigger" href="/launch/1" data-slot="1" data-state="${currentSlot === 1 ? 'active' : 'inactive'}">Site 1</a>
              <a class="mdk_tabs__trigger" href="/launch/2" data-slot="2" data-state="${currentSlot === 2 ? 'active' : 'disabled'}">Site 2</a>
              <a class="mdk_tabs__trigger" href="/launch/3" data-slot="3" data-state="${currentSlot === 3 ? 'active' : 'disabled'}">Site 3</a>
            </div>
          </div>
        </div>
        <section class="mdk-card">
          <p class="mdk-card__label">Site ${currentSlot}</p>
          <p class="mdk-card__lead" id="site-status">Launch fills the next empty tab. Grey tabs are unused. Site 1 stays available.</p>
          <div class="mdk-actions">
            <button type="button" class="mdk-cta" id="btn-launch">Launch site</button>
            <button type="button" class="mdk-cta" id="btn-stop" disabled>Shut down site</button>
          </div>
        </section>
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
          <span class="mdk-path__dot mdk-path__dot--idle" data-node="device"></span> Mock telemetry
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
            <p class="mdk-card__label">Mock telemetry</p>
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
          </dl>
        </section>
        <section class="mdk-card">
          <p class="mdk-card__label">Query</p>
          <p class="mdk-card__lead">Sign in once in Wallet (above the site tabs). Each Launch fills the next empty tab (Site 1, then 2, then 3). Grey tabs are unused. Site 1 is always a way back.</p>
          <pre class="workbench-query-box__code"><code>${escapeHtml(curl)}</code></pre>
        </section>
        <section class="mdk-card">
          <p class="mdk-card__label">Reveal</p>
          <p class="mdk-card__lead">The exact launch request, key fingerprints, where this site's state lives at rest, and its live telemetry — for Site ${currentSlot}.</p>
          <details id="reveal-details">
            <summary class="mdk-cta" id="reveal-toggle">Show reveal</summary>
            <pre class="workbench-query-box__code"><code id="reveal-json">Sign in and launch Site ${currentSlot} first.</code></pre>
          </details>
        </section>
        <script>
          const currentSlot = ${currentSlot}
          let rpcCallId = 1
          async function rpc (method, params) {
            const res = await fetch('/v1/rpc', {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', method, params, id: rpcCallId++ })
            })
            const json = await res.json().catch(() => ({}))
            if (json.error) throw new Error(json.error.message || ('RPC error ' + json.error.code))
            return json.result
          }
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
          function updateNotesUI (selected) {
            const liveSiteId = selected && selected.state === 'live' ? selected.siteId : null
            const saveBtn = document.getElementById('btn-save-notes')
            if (saveBtn) saveBtn.disabled = !liveSiteId
            const downloadLink = document.getElementById('btn-download-spec')
            if (downloadLink) {
              if (liveSiteId) {
                downloadLink.href = '/v1/sites/' + liveSiteId + '/spec.yaml'
                downloadLink.removeAttribute('aria-disabled')
              } else {
                downloadLink.href = '#'
                downloadLink.setAttribute('aria-disabled', 'true')
              }
            }
          }
          async function refresh () {
            const health = await fetch('/health').then((r) => r.json()).catch(() => null)
            const ready = await fetch('/ready').then((r) => r.json()).catch(() => null)
            const slots = (ready && ready.slots) || []
            for (const n of [1, 2, 3]) {
              const tab = document.querySelector('[data-slot="' + n + '"]')
              if (!tab) continue
              const row = slots.find((s) => s.slot === n)
              const occupied = row && row.state !== 'empty' && row.state !== 'failed'
              if (n === currentSlot) tab.setAttribute('data-state', 'active')
              else if (n === 1 || occupied) tab.setAttribute('data-state', 'inactive')
              else tab.setAttribute('data-state', 'disabled')
            }
            const selected = slots.find((s) => s.slot === currentSlot) || { state: 'empty' }
            const stopBtn = document.getElementById('btn-stop')
            if (stopBtn) stopBtn.disabled = selected.state === 'empty' || selected.state === 'stopped'
            updateNotesUI(selected)
            setDot('browser', true)
            setDot('launcher', !!(health && health.status === 'ok'))
            const live = selected.state === 'live'
            setDot('gateway', live)
            setDot('kernel', live && !!(selected.identity && selected.identity.kernel))
            setDot('worker', live && !!(selected.identity && selected.identity.worker))
            if (health && health.status === 'ok') setText('health-badge', 'launcher live')
            if (!live) {
              setDot('device', false)
              setText('worker-id', '—')
              setBadge('worker-state', selected.state === 'empty' ? 'no site' : selected.state, false)
              setBadge('worker-devices', '0 devices', false)
              setBadge('worker-key', 'key —', false)
              setText('device-stat', '—')
              setText('device-unit', '')
              setBadge('device-health', 'idle', false)
              setText('id-gateway', '—')
              setText('id-kernel', '—')
              setText('id-worker', '—')
              return
            }
            const ident = selected.identity || {}
            if (ident.gateway) setText('id-gateway', ident.gateway.id)
            if (ident.kernel) setText('id-kernel', ident.kernel.publicKeyFingerprint)
            if (ident.worker) {
              setText('worker-id', ident.worker.id)
              setText('id-worker', ident.worker.id + ' ' + ident.worker.publicKeyFingerprint)
              setBadge('worker-key', 'key ' + ident.worker.short, true)
            }
            const overview = await rpc('sites.overview', { siteId: selected.siteId }).catch(() => null)
            const device = overview && overview.devices && overview.devices[0]
            setDot('device', !!device)
            if (device) {
              setBadge('worker-state', device.workerState || 'READY', true)
              setBadge('worker-devices', (overview.devices.length) + ' device', true)
              const el = document.getElementById('device-stat')
              if (el) el.innerHTML = (device.hashrate_rt != null ? Number(device.hashrate_rt).toFixed(2) : '—') +
                '<span class="mdk-stat__unit">TH/s</span>'
              setBadge('device-health', (device.power != null ? Math.round(device.power) + ' W' : 'OK'), true)
            }
            revealSiteId = live ? selected.siteId : null
            if (revealOpen) loadReveal()
          }
          refresh()
          setInterval(refresh, 3000)

          let revealSiteId = null
          let revealOpen = false
          async function loadReveal () {
            const el = document.getElementById('reveal-json')
            if (!el) return
            if (!revealSiteId) {
              el.textContent = 'Sign in and launch Site ' + currentSlot + ' first.'
              return
            }
            try {
              const json = await rpc('sites.reveal', { siteId: revealSiteId })
              el.textContent = JSON.stringify(json, null, 2)
            } catch (err) {
              el.textContent = 'Reveal unavailable: ' + err.message
            }
          }
          const revealDetails = document.getElementById('reveal-details')
          if (revealDetails) {
            revealDetails.addEventListener('toggle', () => {
              revealOpen = revealDetails.open
              if (revealOpen) loadReveal()
            })
          }

          const payload = {"apiVersion":"launch.mdk.tether.io/v1alpha1","kind":"SiteLaunch","metadata":{"name":"hobby-demo"},"spec":{"template":{"name":"minimal-site","version":"0.6.0"},"persistence":"ephemeral"}}
          function setAuthStatus (text) {
            const el = document.getElementById('auth-status')
            if (el) el.textContent = text
          }
          async function authMe () {
            const me = await rpc('session.me').catch(() => ({ authenticated: false }))
            setAuthStatus(me.authenticated ? ('Public key ' + me.publicKey) : 'Not signed in')
            const signin = document.getElementById('btn-signin')
            if (signin) {
              signin.textContent = me.authenticated ? 'Signed in' : 'Sign in'
              signin.disabled = !!me.authenticated
            }
            return me
          }
          function setSiteStatus (text) {
            const el = document.getElementById('site-status')
            if (el) el.textContent = text
          }
          document.getElementById('btn-create').onclick = async () => {
            try {
              const json = await rpc('auth.createWallet')
              const seed = document.getElementById('new-seed')
              seed.hidden = false
              seed.textContent = json.seedPhrase
              await authMe()
            } catch (err) {
              setAuthStatus(err.message)
            }
          }
          document.getElementById('btn-signin').onclick = async () => {
            try {
              const seedPhrase = document.getElementById('seed-input').value
              await rpc('session.create', { seedPhrase })
              document.getElementById('seed-input').value = ''
              document.getElementById('new-seed').hidden = true
              document.getElementById('new-seed').textContent = ''
              await authMe()
            } catch (err) {
              setAuthStatus(err.message)
            }
          }
          document.getElementById('btn-logout').onclick = async () => {
            await rpc('session.logout')
            document.getElementById('new-seed').hidden = true
            await authMe()
          }
          document.getElementById('btn-launch').onclick = async () => {
            try {
              const json = await rpc('sites.create', { spec: payload })
              setSiteStatus('Launch ' + json.state + ' Site ' + json.slot)
              if (json.slot && json.slot !== currentSlot) {
                window.location.href = '/launch/' + json.slot
                return
              }
              refresh()
            } catch (err) {
              setSiteStatus(err.message)
            }
          }
          document.getElementById('btn-stop').onclick = async () => {
            try {
              const ready = await fetch('/ready').then((r) => r.json()).catch(() => null)
              const selected = ((ready && ready.slots) || []).find((s) => s.slot === currentSlot)
              if (!selected || !selected.siteId) throw new Error('No site on this tab')
              await rpc('sites.stop', { siteId: selected.siteId })
              setSiteStatus('Site ' + currentSlot + ' shut down')
              refresh()
            } catch (err) {
              setSiteStatus(err.message)
            }
          }
          document.getElementById('btn-save-notes').onclick = async () => {
            const statusEl = document.getElementById('notes-status')
            if (!revealSiteId) {
              if (statusEl) statusEl.textContent = 'Launch Site ' + currentSlot + ' first.'
              return
            }
            try {
              const notes = document.getElementById('notes-input').value
              const json = await rpc('sites.notes.set', { siteId: revealSiteId, notes })
              if (statusEl) statusEl.textContent = 'Notes saved ' + new Date(json.updatedAt).toLocaleTimeString()
            } catch (err) {
              if (statusEl) statusEl.textContent = err.message
            }
          }
          document.getElementById('btn-download-spec').addEventListener('click', (evt) => {
            if (evt.currentTarget.getAttribute('aria-disabled') === 'true') evt.preventDefault()
          })
          document.getElementById('seed-warn-btn').onclick = () => {
            const btn = document.getElementById('seed-warn-btn')
            const warn = document.getElementById('seed-warn')
            if (!btn || !warn) return
            const open = warn.hidden
            warn.hidden = !open
            btn.setAttribute('aria-expanded', open ? 'true' : 'false')
          }
          authMe()
        </script>`
}

function landingHtml ({ slot } = {}) {
  return shell({
    title: 'MDK site launcher',
    active: 'launch',
    wide: false,
    panel: launchPanel(slot || 1)
  })
}

function openapiHtml () {
  const docPath = path.join(__dirname, '..', 'openrpc', 'launch.openrpc.json')
  let doc = ''
  try {
    doc = fs.readFileSync(docPath, 'utf8')
  } catch {
    doc = 'openrpc/launch.openrpc.json is missing'
  }
  return shell({
    title: 'MDK launcher OpenRPC',
    active: 'openrpc',
    wide: true,
    panel: `
        <p class="mdk-card__label">Query</p>
        <p class="mdk-card__lead">Raw document also at <a href="/docs/openrpc.json">/docs/openrpc.json</a>.</p>
        <pre class="workbench-query-box__code"><code>${escapeHtml(doc)}</code></pre>`
  })
}

module.exports = { landingHtml, openapiHtml }
