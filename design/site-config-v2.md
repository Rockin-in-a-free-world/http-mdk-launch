# Site config v2: worker-type + deployment-type choice at launch time

Status: **design proposal only** — nothing under `templates/`, `src/server.js`, `src/landing.js`,
`src/app.css`, `src/schema/site-launch.json`, or `openrpc/launch.openrpc.json` is touched by this
doc. See `design/site-config-v2.openrpc-fragment.json` for the concrete schema/method fragment.

Grounding sources read for this doc (all in the sibling `../mdk` checkout unless noted):

- `backend/core/mdk/index.js` (`getKernel`, `startGateway`, `waitForDiscovery`) and
  `backend/core/mdk/README.md`
- `backend/core/gateway/workers/http.node.wrk.js` and `.../lib/plugin-loader.js`
- `backend/core/plugins/{telemetry,site-hashrate,site-monitor}/mdk-plugin.json` (+ the
  `site-monitor/controllers/hashrate.js` handler)
- `backend/core/mdk/lib/things/{thing,powermeter,sensor,constants}.js`
- `backend/workers/samples/demo-worker/{mock/server.js,plugin/mdk-contract.json,plugin/index.js}`
  and `examples/backend/demo-worker-caller/index.js`
- `examples/dashboard-workbench/workers/mock-temperature/{mdk-contract.json,mock/server.js,src/db.js,src/history-store.js,src/telemetry/{temperature,history}.js}`
  (monorepo-priv, read-only reference)
- This repo's `src/schema/site-launch.json`, `src/validate-site.js`, `openrpc/launch.openrpc.json`,
  `templates/minimal-site/start.js`, `templates/minimal-site/plugins/dashboard/*`,
  `src/supervisor.js`, `src/paths.js`, and (read-only, to trace where `sites.overview` /
  `sites.reveal` telemetry actually comes from) `src/server.js`

---

## 1. What exists today (baseline)

One template, `minimal-site` / `0.6.0`, always boots exactly:

- Kernel (`getKernel`, local discovery)
- One hardcoded Worker: the demo ASIC-miner (`backend/workers/samples/demo-worker`), whose device
  mock (`mock/server.js`) exposes `hashrate_ths` / `power_w` / `board_temp_c` / `power_mode` /
  `serial` over `GET /api/v3/summary`. The Worker Plugin's contract
  (`plugin/mdk-contract.json`) re-exposes these as MDK telemetry capabilities named
  `hashrate_rt` (TH/s), `power` (W), `temperature` (C), `power_mode`, plus a SQLite-backed
  `history` capability and two commands (`reboot`, `setPowerMode`).
- Gateway, always present, always on loopback (`startGateway({ kernel, port, extraPluginDirs: [.../plugins/dashboard] })`).

Two facts about Gateway that are easy to miss and matter a lot for §3:

1. `WrkServerHttp.init()` (`backend/core/gateway/workers/http.node.wrk.js`) **unconditionally**
   registers three built-in plugin packages from `@tetherto/mdk-plugins` — `telemetry`,
   `site-hashrate`, `site-monitor` — before it ever looks at `ctx.extraPluginDirs`. There is no
   "Gateway with zero routes." The built-ins are themselves miner/hashrate-shaped
   (`/auth/metrics/hashrate`, `/auth/metrics/temperature`, `/site-monitor/hashrate`, …) — a
   holdover from MDK's mining-farm origin, not something this launcher owns or can strip out.
2. `site-monitor`'s `GET /site-monitor/hashrate` (unauthenticated) degrades gracefully for
   non-miner telemetry: it reads `stats.hashrate_mhs.avg` and `stats.power_w` with `|| 0`
   fallbacks, so a temperature-sensor or power-meter device just reports zeros there instead of
   erroring. This turns out to be relevant to the deployment-type discussion below.

The launcher's own template plugin (`templates/minimal-site/plugins/dashboard/mdk-plugin.json`,
route `dashboard.overview`) is registered via `extraPluginDirs` and is **worker-shape-agnostic
already**:

```js
// templates/minimal-site/plugins/dashboard/controllers/overview.js
const tel = await services.mdkClient.pullTelemetry(deviceId, 'metrics')
return { deviceId, workerId: w.workerId, workerState: w.state, ...tel.metrics }
```

It just spreads whatever the worker's `metrics` telemetry type returns. That is good news for §2:
none of the 3 worker types need a different Gateway plugin — they all speak through the same
`/overview` shape, just with different field names in the spread.

Everything in `src/server.js` that surfaces live data — `sites.overview` and the `telemetry` field
of `sites.reveal` — is 100% sourced from one call: `probeOverview(gatewayOrigin(record.slot))`,
i.e. an HTTP GET of the Gateway's `/overview`. There is no `@tetherto/mdk-client` HRPC usage
anywhere in this launcher outside the child process's own `start.js`. This is the load-bearing
fact for §3.

`src/validate-site.js` rejects `full-site` / `mvp-site` / `dashboard-workbench` by name via
`UNSUPPORTED_TEMPLATES` — i.e. those are known *template* names from elsewhere in the MDK docs
ecosystem that this Railway launcher deliberately does not support (probably: multi-worker /
multi-process topologies this single-process loopback launcher isn't built for). This proposal
does not touch that set or try to lift the restriction — it only adds a worker-type/deployment
choice *inside* `minimal-site`.

## 2. Worker types

### 2.1 `miner` (existing, unchanged)

The current demo-worker, verbatim. Included in the enum as the explicit default so old
`SiteLaunch` documents (which don't mention `worker` at all) keep behaving exactly as they do
today — see §4 for the compatibility rule.

Telemetry (`/overview` device object, from the existing contract):

| field | unit | example |
|---|---|---|
| `hashrate_rt` | TH/s | 178.4 |
| `power` | W | 3412 |
| `temperature` | °C | 63.1 |
| `power_mode` | enum (`eco`\|`normal`\|`high`) | `normal` |
| `history` (on-demand, `telemetry.pull(type:'history', limit)`) | array | SQLite-backed |

Commands: `reboot`, `setPowerMode`.

### 2.2 `temperature-sensor`

Grounded in the real, already-implemented `examples/dashboard-workbench/workers/mock-temperature`
worker (monorepo-priv, read-only reference for this design — not ported wholesale). That worker
is deliberately the miner's opposite: read-only, one ambient scalar, no commands, but with a real
history store (SQLite via `node:sqlite`, capped at 1,000 samples/device, filterable by
time/min/max range).

Device mock (`GET /api/v3/summary`), same "vendor firmware" convention as the miner mock:

```json
{ "serial": "TS1-0001", "model": "MOCK_TEMP_V1", "firmware": "v1.0.0", "uptime_s": 8021, "board_temp_c": 24.87 }
```

Value model (from the reference mock, reusable as-is): bounded random walk around a 25°C midpoint,
±3°C range, ±0.15°C per-read drift step — i.e. a plausible slow-moving ambient reading, not a
sawtooth or white noise.

MDK telemetry capabilities the Worker Plugin contract exposes:

| capability | unit | type | notes |
|---|---|---|---|
| `temperature` | °C | number | live reading; each read is also recorded to history |
| `history` | °C | array | `{ observedAt (unix ms), value (°C) }[]`, oldest→newest, default limit 20, max 1000; optional `filter: { from, to, minimum, maximum }` |

No commands (`capabilities.commands: []`), matching the reference contract exactly.

### 2.3 `power-meter` (new — proposed third type)

**Choice:** an electrical power meter / rack-PDU-style sub-meter, over the alternatives the task
prompt listed (fan/cooling controller, humidity sensor, network/uptime monitor).

**Why this one:**

- **Genuinely different telemetry shape.** Miner gives a compute-rate gauge + a derived
  status enum; temperature-sensor gives one slow-drifting ambient gauge. A power meter adds the
  one shape neither has: a **monotonically-increasing counter** (cumulative energy, kWh) sitting
  alongside instantaneous gauges (voltage, current, power, power factor, frequency). Counters vs.
  gauges is a real, common telemetry distinction (this is exactly what a Prometheus counter vs.
  gauge split looks like) and it's not something you get from "yet another ambient scalar" like
  humidity would be — humidity is telemetry-shape-identical to temperature (one bounded gauge),
  just a different unit, so it would be a re-skin. A fan/cooling controller is close to the miner
  shape (an RPM gauge + a mode enum + a `setSpeed` command ≈ hashrate/power_mode/setPowerMode) —
  also too close to a re-skin. A network/uptime monitor's natural shape (latency histogram,
  packet loss, up/down) is the most different of the alternatives, but it doesn't fit "small-scale
  hardware-monitoring site" the way an electrical meter does, and there's no small, self-contained
  vendor-firmware-style HTTP API to simulate — you'd be mocking an SNMP/ICMP stack, which is a much
  bigger and less honest mock than the others.
- **MDK core already models this exact concept as a first-class "Thing."**
  `backend/core/mdk/lib/things/powermeter.js` is a real `PowerMeter extends Thing` class,
  alongside `Miner`, `Container`, and `Sensor` (`backend/core/mdk/index.js` exports all four:
  `Miner`, `Container`, `PowerMeter`, `Sensor`). It's a thin skeleton today (cache fields +
  `calculateTension(l1L2, l2L3, l3L1)`, the three-phase-to-phase voltage average), but it tells you
  MDK's own domain model already treats "power meter" as a first-class device family distinct from
  miner/sensor/container — this is not an invented category, it's filling in a family MDK core
  already named and left mostly unimplemented at the mock/worker layer.
  (See `backend/core/mdk/tests/unit/things.powermeter.test.js` for the current, minimal test
  surface — no field-name contract to match beyond `_type: 'powermeter'`, `cache`, `cacheTime`,
  and the tension helper.)
- **Cheap to mock, exactly like the existing demo-worker.** Same shape as the miner/temp mocks:
  one small standalone HTTP JSON "vendor firmware" server on loopback, one `/api/v3/summary`
  route, a handful of numeric fields with light jitter/drift. No real hardware, no external
  service, no new dependency (no need for real three-phase support — see below).
- **Operationally relevant to the stated audience.** A small mining/hosting-site operator already
  watches miner power draw; a dedicated circuit/PDU meter (as opposed to the miner's own
  self-reported `power_w`) is the realistic next thing they'd wire up — an independent check on
  the circuit level, and the basis for cost/billing (kWh).

**Mock shape** (single-phase, at the "one PDU segment / one rack circuit" scale — three-phase
metering is real but adds mock complexity, i.e. three voltage/current pairs and a phase-balance
calculation, for no additional *design* value here; noted below as a natural v2 extension since
`calculateTension` already exists for it):

Device mock (`GET /api/v3/summary`):

```json
{
  "serial": "PM1-0001",
  "model": "PM_V1",
  "firmware": "v1.0.0",
  "uptime_s": 154032,
  "voltage_v": 229.4,
  "current_a": 14.8,
  "power_w": 3227.6,
  "power_factor": 0.96,
  "frequency_hz": 50.02,
  "energy_kwh_total": 128.774
}
```

Field-by-field, with realistic ranges for a small rack circuit (mirrors the miner mock's
`baseHashrateThs`/`basePowerW` seed-and-jitter pattern):

| field | unit | range | behavior |
|---|---|---|---|
| `voltage_v` | V | 225–235 (base 230, ±2%) | jitter each read, like `board_temp_c`/`hashrate_ths` |
| `current_a` | A | 4–28 (configurable base, e.g. a 20A circuit) | jitter each read |
| `power_w` | W | derived: `voltage_v * current_a * power_factor` | derived, not independently seeded |
| `power_factor` | unitless | 0.90–0.99 | jitter each read |
| `frequency_hz` | Hz | 49.9–50.1 (or 59.9–60.1 for a 60Hz locale) | jitter each read |
| `energy_kwh_total` | kWh | monotonically increasing, no cap | accumulated each read as `power_w * elapsed_h`, never decreases — the one counter-shaped field |

MDK telemetry capabilities (Worker Plugin contract, same naming convention as the miner/temp
contracts):

| capability | unit | type | notes |
|---|---|---|---|
| `voltage` | V | number | live |
| `current` | A | number | live |
| `power` | W | number | live |
| `power_factor` | — | number | live |
| `frequency` | Hz | number | live |
| `energy_total` | kWh | number | live, monotonic counter — each read is also recorded to history like the temp sensor |
| `history` | mixed | array | SQLite-backed, same shape/limits as the temp-sensor's `history-store.js` (`{ observedAt, value }[]`, default 20 / max 1000, `filter: { from, to, minimum, maximum }`), storing `power_w` samples (the field an operator would chart) |

No commands (read-only meter), matching temperature-sensor's posture — the counter field is the
thing that makes this genuinely different from a re-skinned gauge, not a command surface.

## 3. Deployment type: with Gateway / without Gateway

**Finding, stated plainly up front:** "no Gateway" is a real, first-class, fully-supported
configuration **in MDK core** — but it is *not* a small change **in this launcher**, because every
piece of this launcher's post-boot behavior for a site is currently wired through Gateway's HTTP
`/overview`, with no fallback path. Below is the honest breakdown.

### 3.1 What "no Gateway" means at the MDK-core level (it's real)

From `backend/core/mdk/README.md`'s own usage example, step 5 is explicitly optional:

```js
// 1-4: start Kernel, start Worker(s), register, waitForDiscovery
// 5. Optionally start the HTTP API
const server = await startGateway({ kernel, port: 3000 })
```

Kernel and Worker do not "assume" a Gateway exists. Kernel exposes its own HRPC surface
(`kernel.getPublicKey()`, the HRPC listener `startGateway` connects to); a Worker registers with
Kernel directly (`kernel.registerWorker(...)`); `waitForDiscovery` polls the Kernel's in-memory
registry, not any HTTP endpoint. So a stack that is just Kernel + Worker, with `startGateway`
simply never called, is a legitimate MDK deployment topology, not a hack.

### 3.2 What it means for *this* launcher (the actual constraint)

Everything the launcher does after boot to observe a site goes through one path:

```js
// src/server.js — both sites.overview and sites.reveal's telemetry field
const probe = await probeOverview(gatewayOrigin(record.slot))   // HTTP GET .../overview
```

and readiness detection during boot (`src/supervisor.js`'s `waitForReady`) polls the exact same
`probeOverview` in a loop until it returns `ok: true`. There is no `@tetherto/mdk-client` HRPC
client anywhere in this launcher's own process — only inside the spawned child's `start.js`,
which is torn down with the child. So if `start.js` never calls `startGateway`, the launcher
**loses every observation channel it currently has** into that site, not just the `/overview`
convenience route:

- `sites.overview` has nothing to proxy to → must become a defined error for headless sites
  (proposed: a new error code, `-32011 ERR_NO_GATEWAY`, not a 502 "unreachable" — the site isn't
  down, it was launched intentionally without an HTTP surface).
- `sites.reveal.telemetry` has nothing to probe → stays `null` (the schema already allows
  `telemetry: ["object","null"]`), but the reveal payload should say *why* it's null rather than
  looking like a transient failure. See the fragment's `SiteReveal.telemetryUnavailableReason`.
- Boot-readiness (the "did it actually come up" check) can no longer be an HTTP probe. The good
  news: `start.js` already prints one JSON line on success today —
  `console.log(JSON.stringify({ msg: 'mdk-ready', ... }))` — which `supervisor.js` currently
  ignores (it only reads stdout for logging, not for readiness). The honest fix is for headless
  sites to make *that* line the readiness signal (parse child stdout for `msg === 'mdk-ready'`)
  instead of polling HTTP. This is fully implementable with what already exists; it just isn't
  wired up today because nothing needed it while Gateway was mandatory.

### 3.3 A second, independent wrinkle: Gateway is never "empty"

Even if a future "minimal Gateway" mode were wanted instead of literally zero Gateway processes,
it's worth recording that **you cannot get a Gateway with zero plugin routes** short of not
starting one at all. `WrkServerHttp.init()` (`backend/core/gateway/workers/http.node.wrk.js`)
unconditionally does:

```js
this.registerPlugin(path.join(MDK_PLUGINS_ROOT, 'telemetry'))
this.registerPlugin(path.join(MDK_PLUGINS_ROOT, 'site-hashrate'))
this.registerPlugin(path.join(MDK_PLUGINS_ROOT, 'site-monitor'))
for (const dir of this.ctx.extraPluginDirs || []) { this.registerPlugin(dir) }
```

before ever looking at `extraPluginDirs`. So "Gateway with only a liveness route" isn't a mode you
configure into existence — the three built-ins are always there, and they're inherently
miner/hashrate-shaped routes (`/auth/metrics/hashrate`, `/auth/metrics/temperature`, …), not a
neutral liveness endpoint. The one built-in that happens to double as a passable liveness probe
for *any* worker type is the unauthenticated `GET /site-monitor/hashrate`
(`backend/core/plugins/site-monitor/controllers/hashrate.js`): it degrades gracefully for
non-miner telemetry (`stats.hashrate_mhs.avg || 0`, `stats.power_w || 0` — no throw, no crash) and
always answers 200 once the Gateway's `mdkClient` is connected. That is a real, already-existing,
zero-new-code liveness signal — just not one this launcher currently reads.

### 3.4 Decision for this proposal

Given the above, this proposal keeps the choice binary as asked, but is explicit about what each
value actually does:

- `spec.deployment.gateway: "enabled"` (default, current behavior, unchanged) — Kernel + Worker +
  Gateway (with the launcher's own `dashboard.overview` route via `extraPluginDirs`, exactly as
  today). `sites.overview`/`sites.reveal.telemetry` work exactly as now.
- `spec.deployment.gateway: "disabled"` — literal, honest "no Gateway": `start.js` never calls
  `startGateway` at all. Kernel + Worker only. This is the real MDK-core-supported topology from
  §3.1, not a fake stand-in. Its cost, documented rather than papered over: no HTTP surface for
  the site at all, `sites.overview` returns `ERR_NO_GATEWAY`, `sites.reveal.telemetry` is `null`
  with `telemetryUnavailableReason: "no-gateway"`, and boot-readiness switches from HTTP polling to
  the stdout `mdk-ready` line described in §3.2.

The §3.3 finding (Gateway is never plugin-empty; `/site-monitor/hashrate` degrades gracefully for
any worker type) is recorded here as the natural **future third value** — `"minimal"`: start a
real Gateway, but with `extraPluginDirs: []` (no launcher-owned `/overview`), and have
`sites.overview` read `/site-monitor/hashrate` instead. That would restore an HTTP liveness/rough-
telemetry channel without the launcher owning a plugin route per worker type. It is *not*
implemented in the fragment below (the task asked for a binary choice); it's flagged here so a
future implementer doesn't have to rediscover §3.3 from scratch before deciding whether to add it.

## 4. Backward compatibility

Both new fields are optional with explicit defaults, so every `SiteLaunch` document valid today
stays valid and behaves identically:

- `spec.worker` omitted ⇒ treated as `{ "type": "miner" }` — today's only worker, unchanged.
- `spec.deployment` omitted ⇒ treated as `{ "gateway": "enabled" }` — today's only deployment,
  unchanged.

`src/validate-site.js` would need to inject these defaults (mirroring how it already normalizes
`metadata.slot`'s optionality) rather than relying on JSON-Schema `default` alone, since Ajv does
not mutate input unless `useDefaults` is enabled — call this out explicitly for whoever implements
this so they don't assume the schema's `default` keyword does the work by itself.

`sites.create`'s `SiteRecord.spec` (which `$ref`s `SiteLaunch`) picks up the new fields for free
once `SiteLaunch` is extended — no separate change needed there.

## 5. What would need to change in `templates/` (not implemented here)

Two shapes were considered:

**A. One template dir per worker type** (`templates/miner-site`, `templates/temperature-sensor-site`,
`templates/power-meter-site`), each a near-copy of today's `start.js` with a different
mock/plugin/contract wired in, selected by `template.name`.

- Pro: each `start.js` stays as simple/linear as today's; no runtime branching.
- Con: `src/paths.js`'s `TEMPLATE_DIR` is currently a single constant
  (`path.join(LAUNCHER_ROOT, 'templates', 'minimal-site')`) used by `supervisor.js`'s `spawnSite`.
  It would need to become a function of `template.name` (or worker type), and three near-duplicate
  `start.js` files (plus three `plugins/dashboard` dirs) is real duplication for what's currently a
  ~10-line difference (which mock module + which worker-caller to require).
- Also collides with `UNSUPPORTED_TEMPLATES`'s framing: `template.name` today means "which
  multi-process topology" (`full-site`/`mvp-site`/`dashboard-workbench` are all rejected as
  unsupported *topologies*), not "which single device type." Overloading it with worker-type
  selection would blur that distinction.

**B. One parameterized template, worker type selected by env var** (recommended). Keep
`templates/minimal-site` as the only template dir; `spawnSite` in `src/supervisor.js` passes a new
`MDK_WORKER_TYPE` env var (alongside the existing `MDK_SLOT` it already passes per-site) and
`MDK_GATEWAY_MODE`; `start.js` looks up a small registry:

```js
// sketch only — not implemented
const WORKER_TYPES = {
  'miner': { mockModule: 'backend/workers/samples/demo-worker/mock/server', callerModule: 'examples/backend/demo-worker-caller' },
  'temperature-sensor': { mockModule: '<new: backend/workers/samples/mock-temperature/mock/server>', callerModule: '<new caller>' },
  'power-meter':        { mockModule: '<new: backend/workers/samples/mock-powermeter/mock/server>', callerModule: '<new caller>' }
}
```

then boots exactly one of them, and conditionally skips the `startGateway(...)` call entirely when
`MDK_GATEWAY_MODE === 'disabled'` (§3.4). This mirrors the existing `MDK_SLOT`-driven
`WORKER_ID`/`DEVICE_ID`/`DEVICE_SERIAL` derivation pattern already in `start.js`, just one more env
input. `TEMPLATE_DIR` in `src/paths.js` stays a single constant. The launcher's own
`plugins/dashboard/controllers/overview.js` needs no change at all (§1: it's already
worker-shape-agnostic).

**Important dependency this doc must flag honestly:** unlike `temperature-sensor`'s reference
implementation (`examples/dashboard-workbench/workers/mock-temperature`, in the monorepo-priv
tree, *not* in `../mdk`), neither `temperature-sensor` nor `power-meter` has a Worker
package/mock/contract inside `../mdk` (the actual runtime tree `MDK_ROOT` points at and that
`start.js` requires from) today. Implementing this proposal means first adding two new packages
under `../mdk/backend/workers/samples/` (e.g. `mock-temperature`, `mock-powermeter`), each with the
`mock/server.js` + `plugin/mdk-contract.json` + `plugin/index.js` + a `demo-worker-caller`-style
boot function, following the existing `demo-worker` package's layout exactly. That is real work in
the *sibling* `mdk` repo, not something achievable by editing only this launcher — `mock-temperature`
can reuse the dashboard-workbench version nearly as-is (device mock, history store, telemetry
handler are all already generic); `power-meter` is new and would follow the same file layout using
§2.3's field table.

## 6. Summary of the proposed schema shape

```jsonc
{
  "spec": {
    "template": { "name": "minimal-site", "version": "0.6.0" },   // unchanged
    "persistence": "ephemeral",                                    // unchanged
    "worker": { "type": "miner" },              // NEW, optional, default shown
    "deployment": { "gateway": "enabled" }      // NEW, optional, default shown
  }
}
```

See `design/site-config-v2.openrpc-fragment.json` for the literal schema additions (in the same
style as `openrpc/launch.openrpc.json`'s `components.schemas`) and the new `sites.configOptions`
discovery method the docs console can call to render `worker.type` and `deployment.gateway` as
dropdowns without hardcoding the enums client-side.
