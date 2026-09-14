# nCore web Stremio addon

Web-based Stremio addon for nCore search + TorBox resolve (Node.js hosting, cPanel/CloudLinux).

## Local run

```bash
npm install
npm start
```

Configure page: `http://localhost:3000/configure`

## Current behavior

- Streams come from nCore IMDb search.
- For series (`tt...:season:episode`) filtering is strict:
  - only torrents containing the requested episode are kept
  - filtering is based on parsed video filenames from torrent metadata
  - parser: `@ctrl/video-filename-parser`
- Resolve flow is TorBox-style find-or-create.

## cPanel / CloudLinux deploy

- Application root: repository root (where `server.js` and `package.json` are)
- Application URL: `/` or `/addon-path`
- Application startup file: `server.js`
- Node.js version: `14+` (example: `24`)
- Environment variables:
  - `APP_BASE_PATH` = empty for root URL, or `/addon-path` when using a subpath
  - `PORT` = optional (usually set by hosting automatically)
  - `TORBOX_DEBUG` = `true|false` (default: `true`)
  - `ENABLE_STREAM_CACHE_PRECHECK` = `true|false` (default: `true`)
  - `NCORE_RESULT_LIMIT` = max nCore rows before enrichment (default: `120`)
  - `NCORE_META_CONCURRENCY` = parallel torrent metadata fetches (default: `6`)

After deploy:
- Configure page: `https://<domain>/configure` or `https://<domain>/<addon-path>/configure`
- Manifest: `https://<domain>/<token>/manifest.json` or `https://<domain>/<addon-path>/<token>/manifest.json`

## Important

- `user:pass` data is tokenized into the URL.
- The token is not encrypted (only base64url-encoded), so use it in a trusted environment.
- If you run behind a reverse proxy/CDN, make sure encoded stream IDs are passed through unchanged.




MÓDOSITOTT TELEPÍTÉS:
1. Friss klónozás
cd ~
git clone git@github.com:Taur1/nCore-addon-javitott.git nCore-addon
cd ~/nCore-addon

git status
git log --oneline -3
git remote -v

A logban a legfelső commitnak ennek kell lennie:

2e3342c Merge remote main with TorBox cache and token configure fixes
2. Új secret generálása
cd ~/nCore-addon

openssl rand -hex 32

Másold ki a kapott 64 karakteres értéket, majd:

nano .env

Tartalma:

NCORE_CONFIG_SECRET=IDE_JON_AZ_UJ_64_KARAKTERES_SECRET

Mentés: Ctrl+O, Enter, kilépés: Ctrl+X.

Majd:

chmod 600 .env
3. Ellenőrizzük a Compose-t
cat docker-compose.yml

Ennek nagyjából ezt kell mutatnia:

services:
  ncore-addon:
    build: .
    container_name: ncore-addon
    ports:
      - "3005:3000"
    restart: unless-stopped
    environment:
      - TORBOX_DEBUG=true
      - NCORE_CONFIG_SECRET=${NCORE_CONFIG_SECRET}
