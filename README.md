# http-mdk-launch

HTTP launcher for one MDK 0.6 site. Develop on branch `0.6-railway` only.

Prove the site **locally first**. Railway is only needed later for a public Hobby URL. The launcher owns `PORT` (default 8080). MDK binds loopback: Gateway `127.0.0.1:3000`, demo mock `127.0.0.1:9101`.

## Local

Node 24+. Clone public MDK at tag [v0.6.0](https://github.com/tetherto/mdk/releases/tag/v0.6.0) next to this repo (already done under `mdk-entrypoints/mdk` on branch `0.6-railway`):

```bash
cd ../mdk
git checkout 0.6-railway   # created from tag v0.6.0
npm install --omit=dev --allow-git=all
cd ../http-mdk-launch
npm install
npm test
npm run build:docs
PORT=8099 npm start
```

```bash
export HOST=http://127.0.0.1:8099
curl -sS "$HOST/health"
curl -sS -X POST "$HOST/v1/sites" \
  -H "content-type: application/json" \
  -H "Idempotency-Key: demo-1" \
  -d '{"apiVersion":"launch.mdk.tether.io/v1alpha1","kind":"SiteLaunch","metadata":{"name":"hobby-demo"},"spec":{"template":{"name":"minimal-site","version":"0.6.0"},"persistence":"ephemeral"}}'
curl -sS "$HOST/v1/sites/<siteId>"
curl -sS "$HOST/ready"
curl -sS "$HOST/v1/sites/<siteId>/gateway/overview"
```

`POST /v1/sites` returns 202 immediately (`accepted` → `booting` → `live`). Auth routes still return 501.

## Railway

Not required for this local boot. When you deploy, point the Hobby service at this GitHub repo, branch `0.6-railway`. Healthcheck path `/health` (launcher liveness, not MDK readiness).
