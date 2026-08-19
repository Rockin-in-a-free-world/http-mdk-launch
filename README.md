# http-mdk-launch

Project: HTTP launcher for one MDK 0.6 site. Develop on branch `0.6-railway` only.

Requirement: Prove the site **locally first**. Railway is only needed later for a public Hobby URL. 

Ports: The launcher owns `PORT` (default 8080). MDK binds loopback: Gateway `127.0.0.1:3000`, demo mock `127.0.0.1:9101`.

## Local

Node 24+. Clone public MDK at tag [v0.6.0](https://github.com/tetherto/mdk/releases/tag/v0.6.0) next to this repo (already done under `mdk-entrypoints/mdk` on branch `0.6-railway`):

```bash
cd ../mdk
git checkout 0.6-railway   # created from tag v0.6.0
npm install --omit=dev --allow-git=all
cd ../http-mdk-launch
npm install
npm test
PORT=8099 npm start
```

The launcher speaks JSON-RPC 2.0 on a single endpoint, `POST /v1/rpc` — see `openrpc/launch.openrpc.json` for the full method list, or browse and run it interactively at `GET /docs` (run `npm run build:console` once before starting the server). `GET /health`, `GET /ready`, and `GET /v1/sites/{id}/spec.yaml` (a file download) stay plain HTTP GET.

```bash
export HOST=http://127.0.0.1:8099
curl -sS "$HOST/health"
# Create a WDK seed (shown once) and a session cookie, or session.create with an existing phrase
curl -sS -c /tmp/launcher.cj -X POST "$HOST/v1/rpc" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","method":"auth.createWallet","id":1}'
curl -sS -b /tmp/launcher.cj -X POST "$HOST/v1/rpc" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","method":"sites.create","params":{"spec":{"apiVersion":"launch.mdk.tether.io/v1alpha1","kind":"SiteLaunch","metadata":{"name":"hobby-demo"},"spec":{"template":{"name":"minimal-site","version":"0.6.0"},"persistence":"ephemeral"}}},"id":2}'
```

`sites.create` needs a session. With `LAUNCHER_PUBLIC_KEYS` unset, any valid BIP-39 seed works. Set that env var to a comma-separated allowlist if you want to lock it down later. `SESSION_SECRET` should be set on Railway. JSON-RPC-over-HTTP convention: the outer HTTP response is always 200; check the body for a top-level `error` object.

## Railway

Not required for this local boot. When you deploy, point the Hobby service at this GitHub repo, branch `0.6-railway`. Healthcheck path `/health` (launcher liveness, not MDK readiness).
