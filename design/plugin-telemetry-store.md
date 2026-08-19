# Plugin design: `telemetry-store` — persist telemetry, graph it, reveal the storage mechanics

Status: **design proposal + real, runnable prototype only.** Nothing under `templates/`,
`src/server.js`, `src/landing.js`, `src/app.css`, `src/schema/site-launch.json`, or
`openrpc/launch.openrpc.json` is touched by this doc. The prototype lives entirely under
`design/plugins/telemetry-store/`. See `design/plugins-fragment.json` for the
`SiteLaunch.spec.plugins` opt-in and the `SiteReveal.telemetryStorage` schema addition,
and `design/site-config-v2.md` for how this sits alongside `spec.worker`/`spec.deployment`
(this plugin is worker-type-agnostic for the same reason `dashboard.overview` already is
— see §2 below).

Grounding sources read for this doc (all in the sibling `../mdk` checkout unless noted;
see `design/plugin-basic-auth.md` §1 for the fuller framework-level write-up this doc
relies on and doesn't repeat):

- `backend/core/gateway/workers/http.node.wrk.js`, `.../lib/plugin-loader.js`,
  `.../lib/plugin-adapter.js` — same plugin-loading grounding as the basic-auth doc;
  specifically here, whether a plugin has any interval/boot hook (§1).
- `backend/core/mdk/index.js` (`startGateway()`) — confirms the Gateway runs in-process
  with `start.js`, sharing `process.env` (how this plugin finds the site's data root).
- `examples/dashboard-workbench/workers/mock-temperature/src/{db.js,history-store.js}`
  (monorepo-priv, read-only reference per `design/site-config-v2.md` — not ported
  wholesale) — the real, working example of `node:sqlite`'s `DatabaseSync` used for a
  telemetry history store, read to ground the CSV-vs-SQLite decision in §3.
- This repo's `templates/minimal-site/plugins/dashboard/controllers/overview.js` (the
  telemetry-pull pattern this plugin's `poll` route reuses), `templates/minimal-site/
  start.js` (`MDK_SITE_ROOT`, the `.mdk-data` convention), `src/paths.js`/`src/
  supervisor.js` (`spawnSite()`'s env vars, `dataRoot()`), and `src/server.js`
  (`revealStorage()`/`buildReveal()` — the existing reveal "storage at rest" section this
  plugin's `stats` route is designed to extend).

---

## 1. Lifecycle hooks: the honest answer

The task asks this explicitly, so it gets a direct answer up front, expanding on
`design/plugin-basic-auth.md` §1.4: **a Gateway plugin has no declared interval or
recurring background-task hook.** `loadPlugin()`'s manifest validation
(`plugin-loader.js`) only recognizes `name`, `version`, and `routes[]` — there is no
`onBoot`/`onInterval`/`onTick` field it looks for, and `WrkServerHttp.registerPlugin()`
does nothing with a plugin beyond wrapping each route's handler. Every plugin capability
in this framework is per-request.

The one real (if incidental) exception: `require()` only executes a module's top-level
code once, and `loadPlugin()` calls `require(handlerPath)` for every controller file
synchronously, during Gateway boot (inside `WrkServerHttp.init()`, called from the
constructor `startGateway()` invokes). So a controller file *could* start a
`setInterval(...)` at module-load time and it would genuinely keep running for the life
of the Gateway process — this is real, not hypothetical, given the in-process boot model
`design/plugin-basic-auth.md` §1.4 traces. This design deliberately does **not** build on
that mechanism as the core persistence trigger, for two reasons: it's an accident of
Node's module-caching semantics rather than a documented plugin API (nothing in
`plugin-loader.js`'s manifest validation or the plugin-adapter contract promises
top-level code will run exactly once at a useful time, or survives however plugins are
loaded in the future), and relying on it would mean the plugin appends telemetry
completely independently of — and therefore inevitably drifting out of sync with —
whatever cadence the dashboard/reveal panel is actually being viewed at.

Given that, this design takes the task's own suggested honest alternative and applies it
here: **persistence is append-on-read, driven by whoever calls the route**, exactly the
way `dashboard.overview` is already a per-request handler that `src/landing.js`'s
`refresh()` happens to call every ~3s. Concretely: `telemetryStore.poll`
(`GET /telemetry-store/poll`) pulls live telemetry and appends it, and does nothing
between calls. Nothing in this plugin schedules anything. See §4 for who would call it.

## 2. What gets persisted, and how (worker-type-agnostic, like `dashboard.overview`)

`controllers/poll.js` reuses the exact pull pattern from
`templates/minimal-site/plugins/dashboard/controllers/overview.js` — `listWorkers()`,
then `pullTelemetry(deviceId, 'metrics')` per device — deliberately duplicated (not
imported) since this design doesn't edit the dashboard plugin's files. Because it just
iterates whatever fields come back in `tel.metrics`, it needs no change per worker type
(`miner`/`temperature-sensor`/`power-meter` from `design/site-config-v2.md` §2) — the
same fact `design/site-config-v2.md` §1 already established for `dashboard.overview`
applies here unchanged.

Each field of each device's telemetry becomes one row, in a tidy/long format rather than
one-wide-row-per-poll:

```
ts,deviceId,workerId,field,value
1734500000123,demo-1,demo-worker-1,hashrate_rt,178.4
1734500000123,demo-1,demo-worker-1,power,3412
1734500000123,demo-1,demo-worker-1,temperature,63.1
1734500000123,demo-1,demo-worker-1,power_mode,normal
```

This shape (rather than a wide CSV with one column per field) is what makes the plugin
worker-type-agnostic on the write side too: it never needs to know ahead of time whether
a device reports 4 fields (`miner`) or 1 (`temperature-sensor`) or 6 including a counter
(`power-meter`, per `design/site-config-v2.md` §2.3) — every field, numeric or enum, is
just another row with its own `field` name.

## 3. CSV, not SQLite — the decision

**Choice: flat, append-only CSV** (`design/plugins/telemetry-store/lib/store.js`), one
file per site under `<siteRoot>/.mdk-data/telemetry-store/telemetry.csv`, plus a tiny
JSON sidecar (`telemetry.csv.stats.json`) tracking row count and first/last-observed
timestamps so growth-rate math survives a Gateway restart.

**Why, weighed against the real alternative:** `node:sqlite`'s `DatabaseSync` is already
proven in this exact problem space —
`examples/dashboard-workbench/workers/mock-temperature/src/history-store.js` uses it for
a capped, indexed, range-queryable temperature history, and it needs no new dependency
(Node core, and this repo already requires Node 24+ per `README.md`). SQLite would win if
the read side needed genuine random-access range queries at scale (`WHERE observed_at
BETWEEN ? AND ?` with an index, which `history-store.js` demonstrates). But the actual
read-side requirement here (§4) is "a few thousand rows, browsed by a chart that refreshes
every few seconds for one demo site" — at that scale, reading the whole CSV into memory
and filtering in JS (`lib/store.js`'s `readAll()`/`history()`) costs nothing that matters,
and the task's own framing tips the scale explicitly: the stated goal is "anything that
gives users a hands-on feel for their options and responsibilities" — i.e. the point is
**transparency**, not query performance. A CSV is the more literal answer to that: a user
(or this launcher's own reveal panel) can point at `telemetry.csv` and it is, byte for
byte, human-readable — no separate tool needed to inspect an in-progress SQLite file, no
"trust the size number" — you can `cat`/`tail`/`wc -l` it yourself. That maps directly
onto `SiteReveal.telemetryStorage.path` (§6) being something a curious operator could
plausibly go look at, which is the whole point of this launcher's existing "reveal" panel
(`src/server.js`'s `revealStorage()`, which already shows a Corestore path for the same
reason).

**Explicitly not chosen, but noted as the production-leaning alternative:** SQLite, via
the same `node:sqlite`/`DatabaseSync` pattern as the reference history store, if a future
version of this plugin needs indexed range queries over a much larger, longer-retained
history, or multiple concurrent readers/writers safely sharing one file (CSV's
`fs.appendFileSync` is fine for one writer; SQLite's WAL mode is the better answer once
that stops being true).

**Growth policy: no trimming, by design, with the trade-off stated plainly.** Unlike the
temperature-sensor reference store's 1,000-row-per-device cap, this plugin never deletes
old rows. That's a deliberate choice, not an oversight: the task explicitly asks for
"metrics on how the data storage size is increasing in real time" as a transparency goal
— observing real, uncapped growth *is* the feature. At this launcher's actual scale (one
demo site, one device, a poll roughly every few seconds if wired per §4), a rough back-
of-envelope — one row per field per poll, ~4-6 fields, ~40-60 bytes/row, a poll every 3s —
is on the order of a few MB/day, trivial for a demo. The known cost of this choice (a
long-lived site would grow its CSV without bound) is recorded here rather than silently
designed around, since a bounded/rotating variant is a straightforward follow-up (cap by
row count exactly like the reference store's `trim` statement, or rotate to a dated file)
if this were ever promoted past prototype/demo use.

## 4. Who calls `telemetryStore.poll` (the append-on-read wiring)

Per §1, nothing in this plugin schedules its own writes — something has to call
`GET /telemetry-store/poll` on a cadence for "persists each telemetry read" to actually
happen over time. Two real wiring options exist, neither implemented here since both
touch files outside this task's scope:

1. **Merge into `dashboard.overview`'s existing handler.** Since
   `src/landing.js`'s `refresh()` already polls `/overview` every ~3s
   (`design/site-config-v2.md` §1), the cheapest real fix is to have
   `dashboard/controllers/overview.js` call this plugin's `appendSample()` inline, once
   per device, right where it already has `tel.metrics` in hand — no extra HTTP round
   trip, since both plugins run in the same Gateway process and `require()` is just a
   relative file path away. This is the option this design recommends.
2. **Add a second poll from the browser.** `src/landing.js`'s `refresh()` timer could
   simply also `fetch()` `/telemetry-store/poll` alongside `/overview` every cycle. Works
   without touching the dashboard plugin at all, at the cost of one extra HTTP round trip
   per poll cycle.

`controllers/poll.js` is written to work standalone either way — it does its own
`listWorkers()`/`pullTelemetry()` pull, so it doesn't depend on option 1 having happened.

## 5. Feeding a dashboard graph: `telemetryStore.history`

Pure read, no side effects. `GET /telemetry-store/history?deviceId=&field=&limit=&from=&to=`
returns:

```json
{
  "samples": [
    { "observedAt": 1734500000123, "deviceId": "demo-1", "workerId": "demo-worker-1", "field": "temperature", "value": "63.1" },
    { "observedAt": 1734500003128, "deviceId": "demo-1", "workerId": "demo-worker-1", "field": "temperature", "value": "63.4" }
  ]
}
```

Oldest→newest (so a future `<canvas>` line-chart can just plot the array as-is left to
right), capped at 2000 samples, default 200 — the same default/max-limit convention as
the temperature-sensor reference store's `DEFAULT_LIMIT`/`MAX_LIMIT` (scaled up here,
since this store has no per-device row cap to bound the query cost the way that store's
does). `value` is always a string (CSV is text); a chart consumer filtering by a known
numeric `field` (e.g. `temperature`, `power`, `energy_total`) can `Number()` it directly —
non-numeric fields like `power_mode` are stored the same way but aren't meant to be
charted as a line. A future `sites.telemetryHistory` RPC method on this launcher would
proxy to this route exactly as `sites.overview` already proxies to `/overview`
(`src/server.js`'s `probeOverview()`), if this were wired into the live launcher.

## 6. Extending the reveal payload: `telemetryStore.stats`

Pure read, no side effects. `GET /telemetry-store/stats` returns exactly the shape
proposed as `SiteReveal.telemetryStorage` in `design/plugins-fragment.json`:

```json
{
  "mechanism": "csv",
  "path": "/app/.data/sites/<siteId>/.mdk-data/telemetry-store/telemetry.csv",
  "sizeBytes": 441,
  "rowCount": 8,
  "firstObservedAt": 1734500000123,
  "lastObservedAt": 1734500010123,
  "growth": {
    "bytesPerHour": 158744.13,
    "bytesPerSample": 55.125
  }
}
```

Every field is computed from this process's own real observations, not a guess:

- `sizeBytes` — a live `fs.statSync()` of the actual file, at request time.
- `rowCount`, `firstObservedAt`, `lastObservedAt` — accumulated in-memory as the plugin
  itself appends (no re-scanning the file), and mirrored to a small JSON sidecar file on
  every append specifically so a Gateway restart mid-site-lifetime doesn't reset them to
  zero — `design/plugins/telemetry-store/lib/store.js`'s `currentStats()`/
  `writeSidecar()`.
- `growth.bytesPerHour` — `sizeBytes / hoursElapsed(firstObservedAt, lastObservedAt)`;
  `null` until at least two distinct sample timestamps exist.
- `growth.bytesPerSample` — `sizeBytes / rowCount`; `null` until at least one row exists.

This was smoke-tested directly (two appends, ~10s apart, four fields each): the plugin
correctly reported `rowCount: 8`, `sizeBytes: 441`, and a genuine (if noisy at n=2)
`bytesPerHour`/`bytesPerSample` derived purely from those real appends — not a
placeholder.

**Composing with the existing reveal shape:** `src/server.js`'s `buildReveal()` already
has exactly this pattern for `SiteReveal.telemetry` — `probeOverview(gatewayOrigin(...))`,
an HTTP GET against the Gateway. A future implementation would add a parallel
`probeTelemetryStoreStats(origin)` (same shape, different path,
`GET /telemetry-store/stats`) and assign its result to a new
`reveal.telemetryStorage` field only when `spec.plugins` included `telemetry-store` for
that site (see `design/plugins-fragment.json`'s `SiteRevealTelemetryStorage` — present
only on opt-in, omitted rather than null when not opted into, deliberately distinct from
the site-config-v2 fragment's `telemetryUnavailableReason` null-with-reason pattern for a
headless Gateway, which is a different kind of "nothing to show here").

## 7. What's explicitly not implemented here

- Wiring `spec.plugins: ["telemetry-store"]` into `sites.create`/`start.js`'s
  `extraPluginDirs` — not implemented (outside this task's file scope); the schema for
  the opt-in is in `design/plugins-fragment.json`.
- Actually calling `telemetryStore.poll` on a schedule (§4) — both wiring options touch
  files outside this task's scope; documented, not implemented.
- Extending `buildReveal()` with the parallel `probeTelemetryStoreStats()` call (§6) —
  same reason; the exact shape it would produce is specified instead.
- A bounded/rotating variant of the CSV store (§3's growth-policy trade-off) — flagged as
  a natural follow-up, not built, since unbounded growth is the intended transparency
  signal at this prototype's scale.
- General CSV parsing for values containing commas/quotes/newlines — `lib/store.js`'s
  `readAll()` only correctly re-parses what `appendSample()`'s `escapeCsv()` actually
  writes today (numbers, short enum strings); flagged in the code as a known scope limit
  rather than silently assumed to be a general CSV reader.
