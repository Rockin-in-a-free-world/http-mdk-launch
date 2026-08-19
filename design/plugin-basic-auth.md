# Plugin design: `basic-auth` — username/password set at site-config time

Status: **design proposal + real, runnable prototype only.** Nothing under `templates/`,
`src/server.js`, `src/landing.js`, `src/app.css`, `src/schema/site-launch.json`, or
`openrpc/launch.openrpc.json` is touched by this doc. The prototype lives entirely under
`design/plugins/basic-auth/`. See `design/plugins-fragment.json` for the concrete
`SiteLaunch.spec.auth` schema addition, and `design/site-config-v2.md` for how this sits
alongside `spec.worker`/`spec.deployment`.

Grounding sources read for this doc (all in the sibling `../mdk` checkout unless noted):

- `backend/core/gateway/workers/http.node.wrk.js` (`WrkServerHttp.init()`/`_start()`) —
  how plugins are registered, what a controller receives, and the one global error hook.
- `backend/core/gateway/workers/lib/plugin-loader.js` (`loadPlugin()`) — manifest
  validation and the `require()`-once-per-boot loading model.
- `backend/core/gateway/workers/lib/plugin-adapter.js` (`buildFastifyRoutes()`) — the
  exact shape of `pluginReq` a controller gets, and that a controller's return value is
  always sent as HTTP 200.
- `backend/core/gateway/workers/lib/server/lib/send200.js` — confirms the 200-only path.
- `node_modules/@tetherto/svc-facs-httpd/index.js` (`HttpdFacility`) — confirms
  `addHook`/`addRoute`/`addPlugin` are only callable before `startServer()`, and only by
  the code that owns the facility instance (`WrkServerHttp`, not a plugin controller).
- `backend/core/mdk/index.js` (`startGateway()`) — confirms the Gateway runs
  **in-process** (`new WrkServerHttp({}, ctx)`), not forked/spawned, so a plugin
  controller shares `process.env` with `start.js`.
- `backend/core/plugins/auth/mdk-plugin.json` + `controllers/userinfo.js`,
  `backend/core/plugins/telemetry/mdk-plugin.json` — the built-in plugins that declare
  `"auth": true` on their routes, read as a second real example and to check whether
  that field is actually enforced anywhere in the framework (see §1.2 — it is not).
- This repo's `templates/minimal-site/plugins/dashboard/{mdk-plugin.json,
  controllers/overview.js}` (the only real, working example of this launcher's own
  Gateway plugin), `templates/minimal-site/start.js` (how `extraPluginDirs` and
  `MDK_SITE_ROOT`/env vars reach the child), `src/supervisor.js` (`spawnSite()` — how env
  vars are passed to the child and that they are never logged), and `src/server.js`
  (`revealCurl()`/`buildReveal()` — where a stored secret could leak back out through
  `sites.reveal`).

---

## 1. What's actually possible at the framework level (investigated, not assumed)

### 1.1 Plugins are routes, nothing more

`loadPlugin()` (`plugin-loader.js`) validates a manifest's `routes[]` and, for each
route, `require()`s its handler file once, wraps it, and returns `{ manifest, routes }`.
`WrkServerHttp.registerPlugin()` (`http.node.wrk.js`) then does:

```js
for (const route of plugin.routes) {
  const handler = route._handler
  route._handler = (req) => handler(req, services)
}
this._plugins.push(plugin)
```

and later, in `_start()`, every plugin's routes are turned into independent Fastify
route objects via `buildFastifyRoutes()` and added with `httpd.addRoute(r)` — one at a
time, no grouping, no shared middleware chain. A controller receives exactly
`(pluginReq, services)` where `pluginReq = { params, query, body, headers, _info }` and
`services = { dataProxy, mdkClient, conf }`. There is no `app`/`fastify`/`httpd` handle
in `services` — a plugin genuinely cannot reach the raw server instance.

### 1.2 A plugin cannot wrap or intercept another plugin's route

Three independent findings, each closing off a different way this might have worked:

1. **No shared request pipeline is exposed to plugins.** `HttpdFacility.addHook()`
   (`@tetherto/svc-facs-httpd/index.js`) throws `ERR_FACS_SERVER_HTTP_ALREADY_INITED` if
   called after `this.server` exists, and it's only ever called by `WrkServerHttp` itself
   (once, for `onError`, in `_start()`) — never by plugin code, which has no reference to
   the facility. So a plugin cannot install an `onRequest`/`preHandler` hook that would
   run before another plugin's handler.
2. **Fastify won't let two plugins register the same route.** `httpd.addRoute()` for the
   three built-ins (`telemetry`, `site-hashrate`, `site-monitor`) happens before
   `extraPluginDirs` are registered (`WrkServerHttp.init()`), and every route ends up on
   the same underlying Fastify instance. Registering `GET /overview` a second time from a
   different plugin would collide, not override.
3. **A catch-all route can't hijack an existing exact path either.** Fastify's router
   (find-my-way) prioritizes an exact static match over a wildcard regardless of
   registration order, so a `basic-auth` plugin registering something like `GET /*` would
   never intercept `GET /overview` once `dashboard.overview` is also registered.

**Conclusion, stated plainly:** the plugin-loader/Gateway framework gives a plugin no
way to protect *someone else's* route. `route.auth: true`, which appears on the built-in
`auth`/`telemetry` plugins' manifests, is corroborating evidence for this rather than a
counterexample — grepping the whole gateway/plugin-loader/plugin-adapter code path for
any reader of `route.auth` finds nothing; it is pure, unenforced manifest metadata in
this build. `auth/controllers/userinfo.js` reads `req._info.user`, but nothing in this
Gateway's own code path (`buildFastifyRoutes` sets `_info: req._info || {}`, i.e. passes
through whatever's already on the raw request, defaulting to `{}`) ever populates that —
if it's populated at all, that would have to happen in a JWT-checking facility this
minimal Gateway config doesn't wire up. So "protect an existing route" is not a switch to
flip; it's a manual, source-level change: the protected controller has to import a guard
and call it itself. That's exactly what this design ships (§2).

### 1.3 There is no real HTTP 401 available to a plugin

`buildFastifyRoutes()`'s generated Fastify handler always ends in
`send200(rep, result)` (`send200.js`: `rep.status(200).send(data)`) for a normal return.
The only way a controller can produce a non-200 response is to `throw`, and the single
global error hook `WrkServerHttp` installs —

```js
httpd.addHook('onError', async (request, reply, error) => {
  const isSafe = error.message && error.message.startsWith('ERR_')
  const message = isSafe ? error.message : 'Bad Request'
  return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message })
})
```

— always answers **400**, never 401, and never sets a `WWW-Authenticate` header. So a
plugin-based "Basic Auth" in this Gateway can check credentials and reject bad ones, but
it cannot make a browser pop its native basic-auth credential dialog (that only happens
on a genuine 401 + `WWW-Authenticate: Basic realm="..."`). This prototype's guard throws
`ERR_UNAUTHORIZED: ...` and accepts the resulting HTTP 400 as the honest ceiling of what
this framework lets a plugin do — good enough for an API client / a custom login form
that reads the JSON body, not a drop-in for a browser-native prompt. A real 401 would
require changing the Gateway's own `errorHandler`/hook wiring (an `httpd` facility-level
change `startGateway()`'s caller could pass in), which is outside a plugin's authority
and is **not** designed here.

### 1.4 The one thing that *is* real: shared process, shared env, shared filesystem

`startGateway()` (`../mdk/backend/core/mdk/index.js`) does `new WrkServerHttp({}, ctx)`
directly — the Gateway is not a forked child process. It runs in the exact same Node
process as `templates/minimal-site/start.js`, which is why `start.js` itself can read
`process.env.MDK_SITE_ROOT` and pass a plain object (`ctx`) into `startGateway()`. A
plugin controller, `require()`d into that same process, can read `process.env` too — this
is how `design/plugins/basic-auth/lib/guard.js` receives the site's credential (§3), with
no new plumbing through `services`/`conf` required. This is also, separately, the answer
to the sibling question `design/plugin-telemetry-store.md` asks about lifecycle hooks:
there is no *declared* boot/interval hook in the plugin manifest schema, but `require()`
only runs a module's top-level code once, at the moment `loadPlugin()` requires it during
Gateway boot — a real, if incidental, one-time-at-boot hook, just not an on-going
interval one.

## 2. What this plugin actually does, given §1

Given a plugin cannot wrap another plugin's route, `design/plugins/basic-auth/` ships:

- `lib/guard.js` — `requireBasicAuth(req)`, a plain function: parses the
  `Authorization: Basic ...` header, recomputes a scrypt hash of the submitted password
  with the site's stored salt, and `crypto.timingSafeEqual`-compares both the username
  and the hash. Throws `ERR_UNAUTHORIZED: ...` (→ HTTP 400, see §1.3) on any mismatch or
  missing/malformed header. Never logs the header or password, success or failure.
- `controllers/protected-overview.js` — a byte-for-byte copy of
  `templates/minimal-site/plugins/dashboard/controllers/overview.js`'s body with exactly
  one added line, `requireBasicAuth(req)`, at the top. Registered as its own route,
  `GET /auth-overview` (`mdk-plugin.json`'s `basicAuth.overview`), so it's runnable today
  without touching the dashboard plugin's files.

This demonstrates the only mechanism that actually exists for "protecting an existing
route": a controller author imports the guard and calls it first. Protecting the real
`dashboard.overview` route later is therefore a **one-line future change** to
`templates/minimal-site/plugins/dashboard/controllers/overview.js` (add the same
`require` + call this design's guard doesn't touch), not a config flag. The built-in
`telemetry`/`site-hashrate`/`site-monitor` plugins could be protected the same way if
their controllers were edited to call the guard — but since they're one directory up in
`../mdk`, not part of this launcher, that is out of scope here and flagged rather than
attempted.

## 3. Password handling — where does the plaintext ever exist, and for how long

The task framing is worth repeating: this is a **per-process, per-site secret with no
shared database.** The design below is built around one question — *does the code that
checks each request ever need the original plaintext password stored anywhere?* — and the
answer is no, if hashing happens once, immediately, at the point of first contact.

**The flow:**

1. **Client → launcher, once, at `sites.create` time.** The caller submits
   `spec.auth = { username, password }` as plaintext in the RPC body (see
   `design/plugins-fragment.json`'s `SiteLaunchSpecAuth`). This one hop of plaintext is
   unavoidable for any "set a password" API and is no different in kind from how this
   launcher already handles the WDK seed phrase once, over the same transport (this
   launcher assumes TLS terminates upstream — Railway's edge — exactly as
   `src/session.js`'s `x-forwarded-proto` check already assumes for the session cookie).
2. **Launcher hashes immediately, before the value is stored anywhere.** On receipt (in
   whatever `sites.create` validation/normalization step a future implementer adds,
   mirroring how `src/validate-site.js` already injects the `worker`/`deployment`
   defaults per `design/site-config-v2.md` §4), the launcher computes:
   ```js
   const salt = crypto.randomBytes(16)
   const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
   ```
   `crypto.scryptSync` is a Node core built-in — no new dependency, and deliberately
   memory/CPU-hard (unlike a bare `sha256`/HMAC), which is the actual reason to prefer it
   over a fast general-purpose hash for a password: it resists offline brute force on the
   stored hash, at a cost that's negligible for a once-per-site-create operation. The
   plaintext `password` variable then goes out of scope; nothing further in the launcher
   ever needs it again.
3. **What gets stored in the launcher's own `SiteRecord`:** `{ username, salt, hash }` —
   never the plaintext. This matters for a reason beyond "don't keep secrets around":
   `src/server.js`'s `revealCurl()` reproduces `record.spec` verbatim inside the
   reproduction curl returned by `sites.reveal`, and `sites.notes`' downloadable
   `spec.yaml` does something similar. If the stored `spec.auth.password` were ever the
   real plaintext (or even the hash+salt), either of those existing features would hand
   it right back out. The fix has to be at the point of storage, not at the reveal
   call site: `design/plugins-fragment.json`'s redaction note specifies normalizing
   `record.spec.spec.auth.password` to a fixed placeholder (e.g. `"<redacted>"`) before
   it is ever written into the `SiteRecord`, so `sites.reveal`/`spec.yaml` structurally
   cannot leak it — there's nothing sensitive left in the object being serialized.
4. **What reaches the child process:** only `{ username, salt, hash }`, as env vars —
   `MDK_BASIC_AUTH_USER`, `MDK_BASIC_AUTH_SALT` (hex), `MDK_BASIC_AUTH_HASH` (hex) —
   passed alongside the existing `MDK_SLOT`/`MDK_HTTP_PORT`/etc. env vars
   `src/supervisor.js`'s `spawnSite()` already sets. `spawnSite()`'s own stdout/stderr
   logging (`prefix()`) only ever logs the child's *process output* lines, never the env
   object it was spawned with, so this doesn't get logged by anything already in place.
5. **What the plugin does per-request:** `guard.js`'s `requireBasicAuth()` reads the
   *submitted* plaintext password straight off the current request's `Authorization`
   header (transient, request-scoped, never written anywhere), recomputes
   `scryptSync(submittedPassword, storedSalt, ...)`, and compares the result to the
   stored hash with `crypto.timingSafeEqual`. It never needs — and never has access to —
   the original plaintext from step 1 again. If it matches, the request is authenticated;
   the freshly-computed candidate hash and the submitted plaintext are both discarded at
   the end of the function call.

**Where the real plaintext exists, and for how long, summarized:**

| Location | Plaintext present? | Lifetime |
|---|---|---|
| RPC request body (`sites.create`) | yes | one HTTP request |
| Launcher process memory, during hashing | yes | microseconds, one function call |
| `SiteRecord` (in-memory, this launcher has no DB) | **no** — `salt`+`hash` only | site's lifetime |
| `sites.reveal` / downloadable `spec.yaml` | **no** — redacted placeholder | n/a |
| Child process env (`MDK_BASIC_AUTH_*`) | **no** — `salt`+`hash` only | child's lifetime |
| Any log line (`spawnSite`'s stdout/stderr prefixing, `guard.js`) | **no**, never logged | n/a |
| Incoming request's `Authorization` header, per check | yes (the *submitted* one) | one function call, per request |

This is why the task's framing — "don't design 'store the plaintext forever'" — is
satisfiable without a shared database: the only two places plaintext ever exists are both
transient and both request/creation-scoped, never a stored value.

## 4. What's explicitly not implemented here

- Wiring `spec.auth` into `src/validate-site.js`/`src/server.js`'s `sites.create` handler
  (the hashing step of §3, and the redaction fix in `design/plugins-fragment.json`'s
  `$comment_redaction`) — not implemented, since this task doesn't edit those files. This
  design doc specifies exactly what that change needs to do.
- Wiring the guard onto the real `dashboard.overview` controller, or onto the three
  built-in plugins — not implemented, for the same reason (those files are out of scope
  here); §2 shows the one-line pattern a future edit would use.
- A real HTTP 401 + `WWW-Authenticate` challenge (§1.3) — not achievable from a plugin at
  all in this Gateway build; flagged as a Gateway-facility-level change, not attempted.
- Rotating/removing a site's credential after creation (`spec.auth` is currently
  write-once, at `sites.create` time only, matching how `spec.persistence`/`spec.template`
  are also immutable-at-create in the existing schema) — no update path designed.
