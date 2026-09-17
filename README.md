nCore Web Addon – Javított változat
================================

Ez a projekt a Thsandorh/nCore-addon repó forkja:
https://github.com/Thsandorh/nCore-addon

Módosított fork:
https://github.com/Taur1/nCore-addon-javitott

Az eredeti projekt nCore keresésre és TorBox alapú streamelésre készült, saját szerveren futtatható Stremio addon. Ez a változat több saját javítást és módosítást tartalmaz.

FŐBB MÓDOSÍTÁSOK
----------------
- TorBox torrent-forwarding / resolve folyamat javítása.
- TorBox globális cache ellenőrzésének javítása.
- A már cached torrentek felismerése a resolve előtt.
- Személyes konfiguráció kezelése titkosított tokenen keresztül.
- AES-256-GCM alapú konfigurációtitkosítás.
- Szerveroldali NCORE_CONFIG_SECRET használata.
- Tokenes /<token>/configure útvonal.
- Meglévő tokenes configure oldalról a meglévő manifest URL megtartása.
- Docker és Docker Compose támogatás.
- GHCR/Docker build workflow támogatás.
- IMDb keresési fallback: ha az IMDb-alapú nCore keresés nem ad találatot, a rendszer cím alapján keres.
- IMDb cím fallback találatok szigorú cím szerinti szűrése, hogy a hasonló nevű, nem kapcsolódó torrentek ne jelenjenek meg.
- Sorozatoknál javított évad/epizód felismerés olyan torrentfájlneveknél is, amelyekből hiányzik az S01/S02 jelölés, de a torrent címében szerepel.
- A tokenes configure oldalon „Jelenlegi manifest másolása” gomb, amely az aktuális tokenhez tartozó manifest URL-t a vágólapra másolja.
- A meglévő tokenes configure oldal továbbra is megtartja a meglévő manifest URL-t.
- Jelenlegi verzió: 1.5.

1.5-ÖS KIADÁS ÚJDONSÁGAI
--------------------------
- IMDb keresés után cím-alapú fallback, ha nincs IMDb-találat.
- A fallback címkeresés eredményei relevancia alapján szűrve vannak.
- Sorozatoknál javult az epizódkeresés season marker nélküli fájlneveknél.
- A tokenes configure oldalon közvetlenül másolható az aktuális manifest URL.
- Az addon verziója: 1.5.

SZÜKSÉGES
---------
- nCore fiók
- TorBox fiók és API-kulcs
- Docker + Docker Compose
- Folyamatosan elérhető szerver vagy VPS
- Internetes használathoz ajánlott HTTPS

GYORS TELEPÍTÉS DOCKERREL
-------------------------
1. Repository klónozása:

   git clone git@github.com:Taur1/nCore-addon-javitott.git nCore-addon
   cd nCore-addon

2. Secret generálása:

   openssl rand -hex 32

3. `.env` létrehozása:

   NCORE_CONFIG_SECRET=IDE_A_GENERALT_SECRET

A `.env` és a secret nem kerülhet GitHubra.

4. Indítás:

   docker compose up -d --build

5. Ellenőrzés:

   docker ps
   curl http://127.0.0.1:3005/health

Sikeres válasz:

   {"ok":true}

KONFIGURÁCIÓ
------------
Nyisd meg:

   https://SAJAT-DOMAIN/configure

Add meg:
- nCore felhasználóneved
- nCore jelszavad
- TorBox API-kulcsod

A rendszer létrehozza a személyes manifest URL-t. Ezt telepítsd Stremióba az „Install in Stremio” gombbal, vagy add hozzá manuálisan.

TOKENES KONFIGURÁCIÓ
--------------------
Személyes manifest:

   https://SAJAT-DOMAIN/TOKEN/manifest.json

Tokenes configure:

   https://SAJAT-DOMAIN/TOKEN/configure

A meglévő tokenes configure oldal ugyanahhoz a manifesthez kapcsolódhat, így az URL nem változik csak azért, mert újra megnyitod a konfigurációs oldalt.

BIZTONSÁG
---------
A konfiguráció nem adatbázisban tárolódik.

Az nCore username, nCore password és TorBox API-kulcs AES-256-GCM titkosítással kerül konfigurációs tokenbe.

A titkosításhoz szükséges kulcs a:

   NCORE_CONFIG_SECRET

értékből származik.

A személyes manifest URL hozzáférési adatnak tekintendő. Ne oszd meg nyilvánosan.

Soha ne töltsd fel:
- `.env`
- `NCORE_CONFIG_SECRET`
- nCore hitelesítő adatokat
- TorBox API-kulcsot
- személyes manifest URL-t

TORBOX CACHE
------------
Az addon az info hash-ek alapján ellenőrzi a TorBox cache állapotát.

Folyamat:

   nCore keresés
       ↓
   info hash kinyerése
       ↓
   TorBox cache ellenőrzés
       ↓
   cached / uncached
       ↓
   TorBox resolve
       ↓
   Stremio stream

A TorBox cache ellenőrzés POST és GET fallbacket is támogat, és több gyakori hash-mezőt is felismer.

NCORE FELDOLGOZÁS
-----------------
Az addon a konfigurált adatokkal bejelentkezik nCore-ra és megfelelő találatokat keres.

A torrentadatokból többek között használhatók:
- release név
- info hash
- magnet
- torrent fájl
- seederek
- méret
- kategória
- IMDb információ
- freeleech információ

Az addon torrent metaadatot is feldolgozhat, és szükség esetén a torrentfájlt használja.

SOROZAT / EPIZÓD SZŰRÉS
-----------------------
Sorozatoknál az IMDb ID, évad és epizód alapján történik a találatok szűrése.

Példa:

   tt1234567:2:5

jelentése:

   IMDb ID: tt1234567
   Évad: 2
   Epizód: 5

A rendszer a torrent- és videófájlneveket is elemzi, hogy csökkentse a nem megfelelő epizódok megjelenését.

REVERSE PROXY / HTTPS
---------------------
Internet felől ajánlott HTTPS mögött futtatni.

Példa:

   https://ncore-addon.example.com

Használható például Cloudflare Tunnel, Nginx, Caddy vagy Traefik.

A proxy-nak változatlanul kell továbbítania a tokenes útvonalakat:

   /TOKEN/configure
   /TOKEN/manifest.json
   /TOKEN/stream/...
   /TOKEN/resolve/...

PORT
----
Alapértelmezett Docker port:

   3005:3000

A konténeren belül a Node alkalmazás a 3000-es porton fut, a hoston a 3005-ös porton érhető el.

HEALTH CHECK
------------
Endpoint:

   GET /health

Példa:

   curl http://127.0.0.1:3005/health

Várt eredmény:

   {"ok":true}

HASZNOS PARANCSOK
-----------------
Logok:

   docker logs --tail 100 ncore-addon

Élő log:

   docker logs -f ncore-addon

Újraindítás:

   docker compose restart

Leállítás:

   docker compose down

Újraépítés:

   docker compose up -d --build

FRISSÍTÉS
---------
GitHubról:

   cd ~/nCore-addon
   git pull --ff-only
   docker compose up -d --build

A `.env` fájlt frissítéskor tartsd meg.

SECRET CSERE
-----------
Új secret:

   openssl rand -hex 32

Ezután frissítsd a `.env` fájlt, majd építsd újra a containert.

A secret cseréje után a régi tokenek nem fejthetők vissza az új secrettel, ezért új konfigurációs tokeneket kell létrehozni.

PROJEKT FELÉPÍTÉSE
------------------
api/app.js
  HTTP route-ok, manifest, stream, resolve, health és configure kezelés.

lib/config.js
  Titkosított konfigurációs tokenek létrehozása és ellenőrzése.

lib/ncore-client.js
  nCore login, keresés, torrentletöltés és metadata feldolgozás.

lib/torbox-client.js
  TorBox API, cache ellenőrzés, torrent kezelés és resolve logika.

public/configure.html
  Webes konfigurációs felület.

Dockerfile
  Docker image.

docker-compose.yml
  Docker Compose telepítés.

VERZIÓ
------
1.5

EREDET
------
Eredeti projekt:
https://github.com/Thsandorh/nCore-addon

Ez a projekt annak módosított forkja:
https://github.com/Taur1/nCore-addon-javitott

A fő módosítások a TorBox integrációt, a cache-kezelést, a titkosított konfigurációs tokeneket, a tokenes configure útvonalat és a Dockeres telepítést érintik.

MEGJEGYZÉS
----------
Érvényes nCore és TorBox hozzáférés szükséges. A felhasználó felelős az nCore, TorBox és az alkalmazandó jogszabályok szabályainak betartásáért.


==============================================================================

nCore Web Addon – Modified Version
===================================

This project is a fork of the original Thsandorh/nCore-addon repository:
https://github.com/Thsandorh/nCore-addon

Modified fork:
https://github.com/Taur1/nCore-addon-javitott

The original project is a self-hosted Stremio addon for nCore search and TorBox-based streaming. This fork contains custom fixes and modifications focused on TorBox integration, caching, configuration, and Docker deployment.

MAIN MODIFICATIONS
------------------
- Improved TorBox torrent-forwarding / resolve flow.
- Improved TorBox global cache checking.
- Cached torrents can be identified before the resolve process.
- Personal configuration is handled through encrypted configuration tokens.
- Configuration uses AES-256-GCM encryption with a server-side secret.
- Added token-based /<token>/configure support.
- Existing token-based configure URLs can keep the same manifest URL.
- Docker and Docker Compose support.
- GHCR/Docker build workflow support.
- Server-side configuration secret is kept outside the Git repository.
- IMDb title-search fallback when IMDb-based nCore search returns no results.
- Strict title filtering for IMDb fallback results to prevent unrelated similarly named torrents from being returned.
- Improved series season/episode matching for torrent filenames that do not contain S01/S02 season markers but whose torrent title contains the season information.
- Added a "Copy current manifest" button to the token-specific configure page, allowing the current token's manifest URL to be copied directly to the clipboard.
- Existing token-based configure pages continue to preserve their existing manifest URL.
- Current addon version: 1.5.

WHAT'S NEW IN 1.5
------------------
- IMDb title fallback when IMDb search returns no results.
- Fallback title-search results are filtered for relevance.
- Improved series episode matching for filenames without explicit season markers.
- Added direct copying of the current manifest URL from the token-specific configure page.
- Current addon version: 1.5.

REQUIREMENTS
------------
- nCore account
- TorBox account and API key
- Docker + Docker Compose for containerized deployment
- A server/VPS that can be kept available
- HTTPS is strongly recommended for public deployment

DOCKER INSTALLATION
-------------------
1. Clone the repository:

   git clone git@github.com:Taur1/nCore-addon-javitott.git nCore-addon
   cd nCore-addon

2. Generate a secret:

   openssl rand -hex 32

3. Create a .env file:

   NCORE_CONFIG_SECRET=YOUR_GENERATED_SECRET

Do not upload the .env file or secret to GitHub.

4. Start the addon:

   docker compose up -d --build

5. Check the container:

   docker ps
   curl http://127.0.0.1:3005/health

Expected response:

   {"ok":true}

CONFIGURATION
-------------
Open:

   https://YOUR-DOMAIN/configure

Enter:
- nCore username
- nCore password
- TorBox API key

The addon generates a personal manifest URL. Install it in Stremio using the "Install in Stremio" button or add the manifest URL manually.

TOKEN CONFIGURATION
-------------------
Personal manifest:

   https://YOUR-DOMAIN/TOKEN/manifest.json

Token-specific configure page:

   https://YOUR-DOMAIN/TOKEN/configure

The existing token-based configure page can keep using the same manifest, so the manifest URL does not change just because the configure page is opened again.

SECURITY
--------
The configuration is not stored in a database.

The nCore username, nCore password and TorBox API key are stored inside an AES-256-GCM encrypted configuration token.

The encryption key is derived from:

   NCORE_CONFIG_SECRET

The personal manifest URL should be treated as access information. Do not share it publicly.

Never commit or upload:
- .env
- NCORE_CONFIG_SECRET
- nCore credentials
- TorBox API keys
- personal manifest URLs

TORBOX CACHE
------------
The addon checks TorBox cache status using torrent info hashes.

The flow is:

   nCore search
       ↓
   info hash extraction
       ↓
   TorBox cache check
       ↓
   cached / uncached status
       ↓
   TorBox resolve
       ↓
   Stremio stream

The TorBox cache check supports POST and GET fallback handling and recognizes common hash field formats returned by the API.

NCORE PROCESSING
----------------
The addon logs into nCore using the configured credentials and searches for matching content.

Torrent data may include:
- release name
- info hash
- magnet
- torrent file
- seeders
- size
- category
- IMDb information
- freeleech information

The addon can process torrent metadata and use torrent files when needed.

SERIES / EPISODE FILTERING
--------------------------
For series requests, the addon uses the IMDb ID, season and episode information to filter matching torrent results.

Example:

   tt1234567:2:5

means:

   IMDb ID: tt1234567
   Season: 2
   Episode: 5

The addon also analyzes torrent/video filenames to reduce unrelated episode results.

REVERSE PROXY / HTTPS
---------------------
For public use, run the addon behind HTTPS.

Example:

   https://ncore-addon.example.com

Cloudflare Tunnel, Nginx, Caddy, Traefik or another reverse proxy can be used.

The proxy must preserve token-based paths such as:

   /TOKEN/configure
   /TOKEN/manifest.json
   /TOKEN/stream/...
   /TOKEN/resolve/...

PORT
----
The default Docker mapping is:

   3005:3000

The addon listens on port 3000 inside the container and is exposed as port 3005 on the host.

HEALTH CHECK
------------
Endpoint:

   GET /health

Example:

   curl http://127.0.0.1:3005/health

Expected:

   {"ok":true}

USEFUL COMMANDS
---------------
View logs:

   docker logs --tail 100 ncore-addon

Follow logs:

   docker logs -f ncore-addon

Restart:

   docker compose restart

Stop:

   docker compose down

Rebuild:

   docker compose up -d --build

UPDATE
------
To update the installation from GitHub:

   cd ~/nCore-addon
   git pull --ff-only
   docker compose up -d --build

Keep the .env file when updating.

SECRET ROTATION
---------------
If NCORE_CONFIG_SECRET is changed, existing configuration tokens can no longer be decoded with the new secret.

Generate a new secret:

   openssl rand -hex 32

Update .env and rebuild the container.

After changing the secret, new configuration tokens must be generated.

PROJECT STRUCTURE
-----------------
Important files:

   api/app.js
      HTTP routes, Stremio manifest, stream and resolve handling.

   lib/config.js
      Encrypted configuration token creation and validation.

   lib/ncore-client.js
      nCore authentication, search, torrent download and metadata processing.

   lib/torbox-client.js
      TorBox API, cache checking, torrent handling and resolve logic.

   public/configure.html
      Web configuration interface.

   Dockerfile
      Container image definition.

   docker-compose.yml
      Docker Compose deployment configuration.

VERSION
-------
Current addon version: 1.5

ORIGINAL PROJECT / FORK
-----------------------
Original project:
https://github.com/Thsandorh/nCore-addon

This project:
https://github.com/Taur1/nCore-addon-javitott

The fork keeps the original project's core concept while adding and fixing TorBox integration, caching, encrypted configuration tokens, token-based configure URLs and Docker deployment.

LEGAL / USAGE NOTE
------------------
A valid nCore account and TorBox account are required.

Users are responsible for complying with the rules of nCore, TorBox and applicable laws in their jurisdiction.
