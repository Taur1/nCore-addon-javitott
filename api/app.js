'use strict';

const crypto = require('node:crypto');
const { encodeConfig, decodeConfig } = require('../lib/config');

const {
  registerManifest,
  touchManifest,
  addUsage,
  getStats,
  getManifests,
  getManifest,
  getManifestHistory,
  setManifestActive,
  deleteManifest,
} = require('../lib/admin-db');

let logInfo = (...args) => console.log(...args);
let logError = (...args) => console.error(...args);

try {
  ({ logInfo, logError } = require('../lib/logger'));
} catch {
  // Fallback to console if logger module is not deployed yet.
}

const {
  loginAndSearch,
  loginAndFetchTorrentFile,
  parseTorrentMeta,
  torrentToMagnet,
} = require('../lib/ncore-client');

const {
  checkCached,
  getMyTorrents,
  resolveLink,
  infoHashFromMagnet,
  isTorrentReady,
  getTorrentState,
  getTorrentProgress,
} = require('../lib/torbox-client');

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const MANIFEST = {
  id: 'community.ncore.web',
  version: '1.6.0',
  name: 'nCore Web Addon',
  description: 'nCore + TorBox stream addon',
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [],
  behaviorHints: { configurable: true },
};

const SETUP_MANIFEST = {
  ...MANIFEST,
  id: 'community.ncore.web.setup',
  name: 'nCore Web Addon (Setup)',
  description: 'Open /configure to generate your personal manifest URL.',
  behaviorHints: {
    configurable: true,
    configurationRequired: true,
  },
};

// ---------------------------------------------------------------------------
// Cache-ek
// ---------------------------------------------------------------------------

const resolveCache = new Map();
const resolveInFlight = new Map();
const selections = new Map();
const myListCache = new Map();
const streamListCache = new Map();

const RESOLVE_TTL = 20 * 60 * 1000;
const SELECTION_TTL = 90 * 60 * 1000;
const MYLIST_TTL = 15 * 1000;

const STREAM_LIST_TTL_MS = toPositiveInt(
  process.env.STREAM_LIST_TTL_MS,
  15000
);

const STREAM_RESULT_LIMIT = Math.min(
  toPositiveInt(process.env.STREAM_RESULT_LIMIT, 30),
  60
);

const RESOLVE_MAX_WAIT_MS = toPositiveInt(
  process.env.TORBOX_RESOLVE_MAX_WAIT_MS,
  30000
);

const ENABLE_STREAM_CACHE_PRECHECK =
  String(process.env.ENABLE_STREAM_CACHE_PRECHECK || 'true').toLowerCase() ===
  'true';

const ENABLE_STREAM_MYLIST_PRECHECK =
  String(process.env.ENABLE_STREAM_MYLIST_PRECHECK || '').toLowerCase() ===
  'true';

const TORBOX_DEBUG =
  String(process.env.TORBOX_DEBUG || 'false').toLowerCase() === 'true';

function debugErr(message, meta) {
  if (!TORBOX_DEBUG) return;
  logError(message, meta || {});
}

function pruneCache() {
  const now = Date.now();

  for (const [k, v] of resolveCache) {
    if (v.expiresAt <= now) resolveCache.delete(k);
  }

  for (const [k, v] of selections) {
    if (v.expiresAt <= now) selections.delete(k);
  }

  for (const [k, v] of myListCache) {
    if (v.expiresAt <= now) myListCache.delete(k);
  }

  for (const [k, v] of streamListCache) {
    if (v.expiresAt <= now) streamListCache.delete(k);
  }
}

// ---------------------------------------------------------------------------
// HTTP segédek
// ---------------------------------------------------------------------------

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);
}

function setCorsHeaders(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, HEAD, OPTIONS');
  res.setHeader('access-control-allow-headers', '*');
}


function requireAdminAuth(req, res) {
  const configuredPassword =
    process.env.ADMIN_PASSWORD || '';

  if (!configuredPassword) {
    sendJson(res, 503, {
      error: 'Admin authentication is not configured',
    });
    return false;
  }

  const header =
    req.headers.authorization || '';

  if (!header.startsWith('Basic ')) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="nCore Admin"',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });

    res.end(
      JSON.stringify({
        error: 'Authentication required',
      })
    );

    return false;
  }

  let decoded;

  try {
    decoded = Buffer
      .from(header.slice(6), 'base64')
      .toString('utf8');
  } catch {
    decoded = '';
  }

  const separator =
    decoded.indexOf(':');

  const password =
    separator >= 0
      ? decoded.slice(separator + 1)
      : '';

  const a = Buffer.from(password);
  const b = Buffer.from(configuredPassword);

  const valid =
    a.length === b.length &&
    require('crypto').timingSafeEqual(a, b);

  if (!valid) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="nCore Admin"',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });

    res.end(
      JSON.stringify({
        error: 'Invalid credentials',
      })
    );

    return false;
  }

  return true;
}

function sendJson(res, status, body) {
  setCorsHeaders(res);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendHtml(res, status, body) {
  setCorsHeaders(res);
  res.statusCode = status;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(body);
}

function sendRedirect(res, status, location) {
  setCorsHeaders(res);
  res.statusCode = status;
  res.setHeader('location', location);
  res.end();
}

async function readBody(req) {
  return new Promise((resolve) => {
    let s = '';

    req.on('data', (chunk) => {
      s += chunk;
    });

    req.on('end', () => resolve(s));
  });
}

// ---------------------------------------------------------------------------
// Kis segédek
// ---------------------------------------------------------------------------

function getOrigin(req) {
  const proto =
    String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim() || 'http';

  return `${proto}://${req.headers.host || 'localhost'}`;
}

function parseBasePath(value) {
  const s = String(value || '')
    .trim()
    .replace(/\/+$/, '');

  if (!s || s === '/') return '';

  return s.startsWith('/') ? s : `/${s}`;
}

function parseStreamId(raw) {
  let decoded = String(raw || '');

  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // keep original when malformed encoding
  }

  const parts = decoded.split(':');
  const season = Number(parts[1]);
  const episode = Number(parts[2]);

  return {
    raw: decoded,
    imdbId: parts[0] || '',
    season:
      Number.isInteger(season) && season > 0
        ? season
        : null,
    episode:
      Number.isInteger(episode) && episode > 0
        ? episode
        : null,
  };
}

function normalizeMagnet(value) {
  const s = String(value || '').trim();

  return /^magnet:\?/i.test(s) ? s : '';
}

function extractHash(magnet) {
  try {
    const xt = new URL(magnet).searchParams.get('xt') || '';
    const raw = xt.replace(/^urn:btih:/i, '').trim();

    if (/^[a-f0-9]{40}$/i.test(raw)) {
      return raw.toLowerCase();
    }
  } catch {
    // ignore
  }

  return infoHashFromMagnet(magnet);
}

function formatSize(bytes) {
  const n = Number(bytes);

  if (!n || !Number.isFinite(n)) return '';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];

  let value = n;
  let index = 0;

  while (
    value >= 1024 &&
    index < units.length - 1
  ) {
    value /= 1024;
    index++;
  }

  return `${
    value >= 10 || index === 0
      ? value.toFixed(0)
      : value.toFixed(1)
  } ${units[index]}`;
}

function inferQuality(title) {
  const t = String(title || '').toLowerCase();

  if (
    t.includes('2160') ||
    t.includes('4k') ||
    t.includes('uhd')
  ) {
    return '2160p';
  }

  if (t.includes('1080')) return '1080p';
  if (t.includes('720')) return '720p';

  return '';
}

function readableCategory(cat) {
  return String(cat || '')
    .split('_')
    .map((part) => part.toUpperCase())
    .join(' ');
}

function shortHash(value) {
  return crypto
    .createHash('sha1')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 16);
}

function toPositiveInt(value, fallback) {
  const n = Number(value);

  if (Number.isInteger(n) && n > 0) {
    return n;
  }

  return fallback;
}

function buildSelectionKey({
  token,
  parsedIdRaw,
  infoHash,
  fileName,
  downloadUrl,
  magnet,
}) {
  return shortHash(
    [
      token || '',
      parsedIdRaw || '',
      String(infoHash || '').toLowerCase(),
      String(fileName || '').trim(),
      String(downloadUrl || '').trim(),
      String(magnet || '').trim(),
    ].join('|')
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function createApp(deps = {}) {
  const searchClient =
    deps.searchClient || loginAndSearch;

  const _checkCached =
    deps.torboxCachedChecker || checkCached;

  const _getMyTorrents =
    deps.torboxMyListFetcher || getMyTorrents;

  const _resolveLink =
    deps.torboxResolver || resolveLink;

  const configureHtml =
    deps.configureHtml;

  const adminHtml =
    deps.adminHtml;

  const logoBuffer =
    deps.logoBuffer;

  return async function app(req, res) {
    pruneCache();

    const url = new URL(
      req.url,
      `http://${req.headers.host || 'localhost'}`
    );

    const path = url.pathname;

    logInfo(
      `[${new Date().toISOString().slice(11, 19)}] ${req.method} ${path.slice(0, 120)}`
    );

    // -----------------------------------------------------------------------
    // OPTIONS
    // -----------------------------------------------------------------------

    if (req.method === 'OPTIONS') {
      setCorsHeaders(res);
      res.statusCode = 204;
      return res.end();
    }

    // -----------------------------------------------------------------------
    // Health
    // -----------------------------------------------------------------------

    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      path === '/health'
    ) {
      if (req.method === 'HEAD') {
        setCorsHeaders(res);
        res.statusCode = 200;
        return res.end();
      }

      return sendJson(res, 200, {
        ok: true,
      });
    }

    // -----------------------------------------------------------------------
    // Root -> configure redirect
    // -----------------------------------------------------------------------

    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      (path === '/' || path === '/index.html')
    ) {
      const basePath = parseBasePath(
        process.env.APP_BASE_PATH || ''
      );

      return sendRedirect(
        res,
        302,
        `${basePath}/configure${url.search || ''}`
      );
    }

    // -----------------------------------------------------------------------
    // Project logo
    // -----------------------------------------------------------------------

    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      path === '/logo.png'
    ) {
      if (!logoBuffer) {
        res.statusCode = 404;
        res.setHeader(
          'content-type',
          'text/plain; charset=utf-8'
        );
        return res.end('Logo not found');
      }

      setCorsHeaders(res);

      res.statusCode = 200;
      res.setHeader('content-type', 'image/png');
      res.setHeader(
        'cache-control',
        'public, max-age=86400'
      );

      if (req.method === 'HEAD') {
        return res.end();
      }

      return res.end(logoBuffer);
    }

    // -----------------------------------------------------------------------
    // Configure oldal
    // -----------------------------------------------------------------------

    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      (
        path === '/configure' ||
        path === '/configure/' ||
        path === '/configure/index.html'
      )
    ) {
      if (req.method === 'HEAD') {
        setCorsHeaders(res);
        res.statusCode = 200;
        res.setHeader(
          'content-type',
          'text/html; charset=utf-8'
        );
        return res.end();
      }

      return configureHtml
        ? sendHtml(res, 200, configureHtml)
        : sendHtml(
            res,
            500,
            'Missing configure.html'
          );
    }

    // -----------------------------------------------------------------------
    // Admin oldal
    // -----------------------------------------------------------------------

    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      (
        path === '/admin' ||
        path === '/admin/' ||
        path === '/admin/index.html'
      )
    ) {
      if (!requireAdminAuth(req, res)) {
        return;
      }

      if (req.method === 'HEAD') {
        res.statusCode = 200;
        res.setHeader(
          'content-type',
          'text/html; charset=utf-8'
        );
        res.setHeader(
          'cache-control',
          'no-store'
        );
        return res.end();
      }

      if (!adminHtml) {
        return sendHtml(
          res,
          500,
          'Missing admin.html'
        );
      }

      res.setHeader(
        'cache-control',
        'no-store'
      );

      return sendHtml(
        res,
        200,
        adminHtml
      );
    }

    // -----------------------------------------------------------------------
    // Admin API
    // -----------------------------------------------------------------------

    if (
      path === '/api/admin/stats' ||
      path === '/api/admin/manifests' ||
      path.startsWith('/api/admin/manifests/')
    ) {
      if (!requireAdminAuth(req, res)) {
        return;
      }

      // -------------------------------------------------------------
      // Statisztikák
      // -------------------------------------------------------------

      if (
        req.method === 'GET' &&
        path === '/api/admin/stats'
      ) {
        return sendJson(res, 200, getStats());
      }

      // -------------------------------------------------------------
      // Manifest lista
      // -------------------------------------------------------------

      if (
        req.method === 'GET' &&
        path === '/api/admin/manifests'
      ) {
        return sendJson(res, 200, {
          manifests: getManifests(),
        });
      }

      const manifestMatch =
        path.match(
          /^\/api\/admin\/manifests\/(\d+)(?:\/(history|active))?$/
        );

      if (!manifestMatch) {
        return sendJson(res, 404, {
          error: 'Admin endpoint not found',
        });
      }

      const manifestId =
        Number(manifestMatch[1]);

      const action =
        manifestMatch[2] || '';

      const manifest =
        getManifest(manifestId);

      if (!manifest) {
        return sendJson(res, 404, {
          error: 'Manifest not found',
        });
      }

      // -------------------------------------------------------------
      // Egy manifest
      // -------------------------------------------------------------

      if (
        req.method === 'GET' &&
        action === ''
      ) {
        return sendJson(res, 200, {
          manifest,
        });
      }

      // -------------------------------------------------------------
      // Használati előzmények
      // -------------------------------------------------------------

      if (
        req.method === 'GET' &&
        action === 'history'
      ) {
        return sendJson(res, 200, {
          manifest,
          history:
            getManifestHistory(manifestId),
        });
      }

      // -------------------------------------------------------------
      // Aktiválás / letiltás
      // -------------------------------------------------------------

      if (
        req.method === 'POST' &&
        action === 'active'
      ) {
        const raw =
          await readBody(req);

        const body =
          new URLSearchParams(raw);

        const active =
          body.get('active') === 'true';

        setManifestActive(
          manifestId,
          active
        );

        return sendJson(res, 200, {
          success: true,
          active,
        });
      }

      // -------------------------------------------------------------
      // Törlés
      // -------------------------------------------------------------

      if (
        req.method === 'DELETE' &&
        action === ''
      ) {
        deleteManifest(manifestId);

        return sendJson(res, 200, {
          success: true,
        });
      }

      return sendJson(res, 405, {
        error: 'Method not allowed',
      });
    }

    // -----------------------------------------------------------------------
    // Token generálás
    // -----------------------------------------------------------------------

    if (
      req.method === 'POST' &&
      path === '/api/config-token'
    ) {
      const raw = await readBody(req);
      const p = new URLSearchParams(raw);

      try {
        const token = encodeConfig({
          username:
            p.get('username') || '',

          password:
            p.get('password') || '',

          torboxApiKey:
            p.get('torboxApiKey') || '',

          // 1.6.0:
          // A configure.html által küldött seed beállítás.
          // Ha nincs megadva, alapértelmezés szerint false.
          seedEnabled:
            p.get('seedEnabled') === 'true',
        });

        // Admin adatbázis: csak a token hash-e kerül tárolásra.
        registerManifest({
          token,
          username: p.get('username') || '',
          seedEnabled: p.get('seedEnabled') === 'true',
        });

        return sendJson(res, 200, {
          token,
        });
      } catch (e) {
        return sendJson(res, 400, {
          error: e.message,
        });
      }
    }

    // -----------------------------------------------------------------------
    // Tokenes configure oldal
    // -----------------------------------------------------------------------

    const tokenConfigureM =
      path.match(/^\/([^/]+)\/configure\/?$/);

    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      tokenConfigureM
    ) {
      try {
        decodeConfig(tokenConfigureM[1]);

        if (req.method === 'HEAD') {
          setCorsHeaders(res);
          res.statusCode = 200;
          res.setHeader(
            'content-type',
            'text/html; charset=utf-8'
          );
          return res.end();
        }

        return configureHtml
          ? sendHtml(res, 200, configureHtml)
          : sendHtml(
              res,
              500,
              'Missing configure.html'
            );
      } catch (e) {
        return sendJson(res, 400, {
          error: e.message,
        });
      }
    }

    // -----------------------------------------------------------------------
    // Token root -> manifest redirect
    // -----------------------------------------------------------------------

    // A manifest.json ne kerüljön bele tokenként.
    const tokenRootM =
      path.match(/^\/(?!manifest\.json$)([^/]+)\/?$/);

    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      tokenRootM
    ) {
      try {
        decodeConfig(tokenRootM[1]);

        return sendRedirect(
          res,
          302,
          `/${tokenRootM[1]}/manifest.json`
        );
      } catch (e) {
        return sendJson(res, 400, {
          error: e.message,
        });
      }
    }

    // -----------------------------------------------------------------------
    // Setup manifest
    // -----------------------------------------------------------------------

    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      path === '/manifest.json'
    ) {
      const origin = getOrigin(req);
      const basePath = parseBasePath(
        process.env.APP_BASE_PATH || ''
      );

      if (req.method === 'HEAD') {
        setCorsHeaders(res);
        res.statusCode = 200;
        res.setHeader(
          'cache-control',
          'public, max-age=60'
        );
        return res.end();
      }

      res.setHeader(
        'cache-control',
        'public, max-age=60'
      );

      return sendJson(res, 200, {
        ...SETUP_MANIFEST,
        logo: `${origin}${basePath}/logo.png`,
      });
    }

    // -----------------------------------------------------------------------
    // Konfigurált manifest
    // -----------------------------------------------------------------------

    const manifestM =
      path.match(/^\/([^/]+)\/manifest\.json$/);

    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      manifestM
    ) {
      try {
        decodeConfig(manifestM[1]);

        const origin = getOrigin(req);
        const basePath = parseBasePath(
          process.env.APP_BASE_PATH || ''
        );

        if (req.method === 'HEAD') {
          setCorsHeaders(res);
          res.statusCode = 200;
          res.setHeader(
            'cache-control',
            'public, max-age=60'
          );
          return res.end();
        }

        const suffix = crypto
          .createHash('sha1')
          .update(manifestM[1])
          .digest('hex')
          .slice(0, 12);

        res.setHeader(
          'cache-control',
          'public, max-age=60'
        );

        return sendJson(res, 200, {
          ...MANIFEST,
          id: `community.ncore.web.${suffix}`,
          logo: `${origin}${basePath}/logo.png`,
        });
      } catch (e) {
        return sendJson(res, 400, {
          error: e.message,
        });
      }
    }

    // -----------------------------------------------------------------------
    // Stream – config nélkül
    // -----------------------------------------------------------------------

    if (
      req.method === 'GET' &&
      path.match(/^\/stream\/[^/]+\/[^/.]+\.json$/)
    ) {
      return sendJson(res, 200, {
        streams: [],
      });
    }

    // -----------------------------------------------------------------------
    // Resolve endpoint
    // -----------------------------------------------------------------------

    const resolveM =
      path.match(
        /^\/([^/]+)\/resolve\/([^/.]+)(?:\.[^/]+)?$/
      );

    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      resolveM
    ) {
      const token = resolveM[1];
      const selKey = resolveM[2];
      const resolveKey = `${token}|${selKey}`;

      try {
        const creds = decodeConfig(token);

        // A régi manifestek is automatikusan bekerülnek az admin DB-be
        // az első használatkor. A teljes token nincs eltárolva.
        registerManifest({
          token,
          username: creds.username,
          seedEnabled: creds.seedEnabled,
        });

        touchManifest(token);

        if (!creds.torboxApiKey) {
          return sendJson(res, 400, {
            error: 'Nincs TorBox API kulcs',
          });
        }

        // ---------------------------------------------------------------
        // Resolve cache
        // ---------------------------------------------------------------

        const hit = resolveCache.get(resolveKey);

        if (
          hit?.expiresAt > Date.now() &&
          hit.url
        ) {
          res.statusCode = 302;
          res.setHeader(
            'location',
            hit.url
          );
          return res.end();
        }

        // HEAD probe should not have side effects.
        if (req.method === 'HEAD') {
          res.statusCode = 204;
          return res.end();
        }

        // ---------------------------------------------------------------
        // Selection
        // ---------------------------------------------------------------

        const sel = selections.get(selKey);

        if (
          !sel ||
          sel.expiresAt <= Date.now() ||
          sel.token !== token
        ) {
          return sendJson(res, 404, {
            error: 'Selection not found or expired',
          });
        }

        let magnet = null;

        let infoHash = String(
          sel.infoHash ||
          extractHash(magnet) ||
          ''
        ).toLowerCase();

        let torrentFile = null;

        let torrentFileName =
          String(sel.fileName || '').trim() ||
          null;

        // ---------------------------------------------------------------
        // Torrent file fallback
        // ---------------------------------------------------------------

        if (sel.downloadUrl) {
          try {
            torrentFile =
              await loginAndFetchTorrentFile({
                username: creds.username,
                password: creds.password,
                downloadUrl: sel.downloadUrl,
              });

            const torrentMeta =
              parseTorrentMeta(torrentFile);

            infoHash = String(
              torrentMeta.infoHash || ''
            ).toLowerCase();

            magnet = null;

            if (!torrentFileName) {
              torrentFileName =
                torrentMeta.fileName || null;
            }
          } catch (err) {
            debugErr(
              'resolve-torrent-fallback-failed',
              {
                selKey,
                error:
                  err?.message ||
                  String(err || ''),
              }
            );
          }
        }

        if (
          !infoHash ||
          (!magnet && !torrentFile)
        ) {
          return sendJson(res, 422, {
            error:
              'Invalid infoHash/torrent source',
          });
        }

        logInfo(
          `[RESOLVE] selected hash=${infoHash.slice(0, 8)}... selKey=${selKey}`
        );

        debugErr(
          'resolve-selected',
          {
            selKey,
            infoHash,
            magnetPrefix:
              String(magnet || '').slice(0, 80),
            hasTorrentFile:
              Boolean(torrentFile),
          }
        );

        // ---------------------------------------------------------------
        // TorBox resolve
        // ---------------------------------------------------------------

        let promise =
          resolveInFlight.get(resolveKey);

        if (!promise) {
          promise = _resolveLink({
            apiKey: creds.torboxApiKey,
            magnet,
            infoHash,
            torrentFile,
            torrentFileName,

            preferredFile:
              sel.season && sel.episode
                ? null
                : (
                    sel.fileName ||
                    torrentFileName
                  ),

            season: sel.season,
            episode: sel.episode,
            maxWaitMs: RESOLVE_MAX_WAIT_MS,
          });

          resolveInFlight.set(
            resolveKey,
            promise
          );
        }

        let resolvedUrl;

        try {
          resolvedUrl = await promise;
        } finally {
          resolveInFlight.delete(
            resolveKey
          );
        }

        if (!resolvedUrl) {
          return sendJson(res, 502, {
            error:
              'TorBox nem adott vissza URL-t',
          });
        }

        resolveCache.set(
          resolveKey,
          {
            url: resolvedUrl,
            expiresAt:
              Date.now() + RESOLVE_TTL,
          }
        );

        res.statusCode = 302;

        res.setHeader(
          'location',
          resolvedUrl
        );

        return res.end();

      } catch (e) {
        logError(
          '[RESOLVE] Hiba',
          e
        );

        if (
          e.code === 'TORBOX_NOT_READY'
        ) {
          res.setHeader(
            'retry-after',
            '30'
          );

          return sendJson(res, 409, {
            error:
              'TorBox is not ready yet. Please try again.',
          });
        }

        return sendJson(res, 502, {
          error:
            e.message ||
            'Resolve failed',
        });
      }
    }

    // -----------------------------------------------------------------------
    // Stream lista
    // -----------------------------------------------------------------------

    const streamM =
      path.match(
        /^\/([^/]+)\/stream\/([^/]+)\/([^/.]+)\.json$/
      );

    if (
      req.method === 'GET' &&
      streamM
    ) {
      const token = streamM[1];
      const streamType = streamM[2];
      const parsedId = parseStreamId(
        streamM[3]
      );

      try {
        const creds = decodeConfig(token);

        if (!creds.torboxApiKey) {
          return sendJson(res, 200, {
            streams: [],
          });
        }

        const origin = getOrigin(req);

        const basePath = parseBasePath(
          process.env.APP_BASE_PATH || ''
        );

        const streamCacheKey = [
          token,
          streamType,
          parsedId.raw,
          origin,
          basePath,
        ].join('|');

        const streamCacheHit =
          streamListCache.get(
            streamCacheKey
          );

        if (
          streamCacheHit?.expiresAt >
            Date.now() &&
          Array.isArray(
            streamCacheHit.streams
          )
        ) {
          return sendJson(res, 200, {
            streams:
              streamCacheHit.streams,
          });
        }

        // ---------------------------------------------------------------
        // nCore keresés
        // ---------------------------------------------------------------

        const results =
          await searchClient({
            username: creds.username,
            password: creds.password,
            query: parsedId.raw,
          });

        // Admin előzmény teszt
        addUsage({
          token,
          imdbId: parsedId.raw,
          streamType,
          title: results?.[0]?.title || parsedId.raw,
        });

        // ---------------------------------------------------------------
        // TorBox mylist
        // ---------------------------------------------------------------

        let myListByHash = new Map();

        try {
          const key =
            shortHash(
              creds.torboxApiKey
            );

          const entry =
            myListCache.get(key);

          let list;

          if (
            entry?.expiresAt >
            Date.now()
          ) {
            list = entry.list;
          } else {
            list =
              await withTimeout(
                _getMyTorrents({
                  apiKey:
                    creds.torboxApiKey,
                }),
                8000
              );

            myListCache.set(
              key,
              {
                list,
                expiresAt:
                  Date.now() +
                  MYLIST_TTL,
              }
            );
          }

          for (const t of list || []) {
            const h = String(
              t?.hash ||
              t?.info_hash ||
              ''
            ).toLowerCase();

            if (
              /^[a-f0-9]{40}$/.test(h)
            ) {
              myListByHash.set(h, t);
            }
          }
        } catch {
          // ignore
        }

        // ---------------------------------------------------------------
        // TorBox global cache check
        // ---------------------------------------------------------------

        let cachedMap = new Map();

        if (
          ENABLE_STREAM_CACHE_PRECHECK
        ) {
          try {
            const hashes =
              results
                .slice(
                  0,
                  STREAM_RESULT_LIMIT
                )
                .map(
                  (r) =>
                    String(
                      r.infoHash ||
                      extractHash(
                        normalizeMagnet(
                          r.magnet
                        )
                      ) ||
                      ''
                    ).toLowerCase()
                )
                .filter(Boolean);

            cachedMap =
              await withTimeout(
                _checkCached({
                  apiKey:
                    creds.torboxApiKey,
                  infoHashes: hashes,
                }),
                8000
              );

            console.error(
              '[TORBOX-CHECKCACHED-MAP]',
              JSON.stringify(
                Object.fromEntries(
                  cachedMap
                )
              )
            );
          } catch {
            // ignore
          }
        }

        // ---------------------------------------------------------------
        // Stream objektumok
        // ---------------------------------------------------------------

        const streams = [];

        for (
          const item of results.slice(
            0,
            STREAM_RESULT_LIMIT
          )
        ) {
          const magnet =
            normalizeMagnet(
              item.magnet
            );

          const infoHash =
            String(
              item.infoHash ||
              extractHash(magnet) ||
              ''
            ).toLowerCase();

          const downloadUrl =
            String(
              item.downloadUrl ||
              ''
            ).trim();

          if (
            !infoHash &&
            !magnet &&
            !downloadUrl
          ) {
            continue;
          }

          const inMyList =
            infoHash
              ? (
                  myListByHash.get(
                    infoHash
                  ) || null
                )
              : null;

          const isReady =
            inMyList
              ? isTorrentReady(
                  inMyList
                )
              : false;

          const globalCached =
            infoHash
              ? (
                  cachedMap.get(
                    infoHash
                  ) ?? null
                )
              : null;

          // cached:
          // true  = kész
          // false = töltődik / uncached
          // null  = ismeretlen

          let cached;

          if (isReady) {
            cached = true;
          } else if (inMyList) {
            cached = false;
          } else if (
            globalCached != null
          ) {
            cached = globalCached;
          } else {
            cached = null;
          }

          const selKey =
            buildSelectionKey({
              token,
              parsedIdRaw:
                parsedId.raw,
              infoHash,
              fileName:
                item.fileName,
              downloadUrl,
              magnet,
            });

          selections.set(
            selKey,
            {
              token,
              magnet,
              infoHash,
              downloadUrl,

              fileName:
                item.fileName,

              season:
                parsedId.season,

              episode:
                parsedId.episode,

              cached,

              expiresAt:
                Date.now() +
                SELECTION_TTL,
            }
          );

          debugErr(
            'stream-selection-created',
            {
              selKey,
              infoHash,
              title:
                item.title || '',
            }
          );

          const quality =
            inferQuality(
              item.title
            );

          const size =
            formatSize(
              item.sizeBytes
            );

          const cat =
            readableCategory(
              item.category
            );

          let tag;
          let statusLine;

          if (
            inMyList &&
            !isReady
          ) {
            const st =
              getTorrentState(
                inMyList
              );

            const pct =
              getTorrentProgress(
                inMyList
              );

            tag =
              `[${st.toUpperCase()}${
                pct
                  ? ` ${pct}%`
                  : ''
              }]`;

            statusLine =
              `TorBox: ${st}${
                pct
                  ? ` ${pct}%`
                  : ''
              }`;

          } else if (
            cached === true
          ) {
            tag = '[CACHED]';
            statusLine =
              'TorBox: Cached';

          } else if (
            cached === false
          ) {
            tag = '[UNCACHED]';
            statusLine =
              'TorBox: Uncached';

          } else {
            tag = '[?]';
            statusLine =
              'TorBox: ?';
          }

          streams.push({
            _seeders:
              Number(
                item.seeders
              ) || 0,

            name:
              `nCore\nTorBox ${
                [
                  tag,
                  quality,
                ]
                  .filter(Boolean)
                  .join(' ')
              }`,

            title: [
              item.title,

              statusLine,

              [
                `S:${
                  Number(
                    item.seeders
                  ) || 0
                }`,
                size,
                cat,
                item.freeleech
                  ? 'Freeleech'
                  : '',
              ]
                .filter(Boolean)
                .join(' | '),

              item.imdbRating
                ? `IMDb ${
                    item.imdbRating
                  } | nCore + TorBox`
                : 'nCore + TorBox',
            ]
              .filter(Boolean)
              .join('\n'),

            url:
              `${origin}${basePath}/${token}/resolve/${selKey}`,

            behaviorHints: {
              notWebReady: true,

              bingeGroup:
                `nCore-TorBox-${
                  quality ||
                  'default'
                }`,
            },
          });
        }

        // ---------------------------------------------------------------
        // Stream prioritás
        // ---------------------------------------------------------------

        streams.sort((a, b) => {
          const getRanks = (stream) => {
            const name =
              String(
                stream?.name || ''
              );

            const title =
              String(
                stream?.title || ''
              ).toUpperCase();

            // 1. TorBox cache
            let cacheRank = 2;

            if (
              name.includes(
                '[CACHED]'
              )
            ) {
              cacheRank = 0;
            } else if (
              name.includes(
                '[?]'
              )
            ) {
              cacheRank = 1;
            }

            // 2. Felbontás
            let resolutionRank = 3;

            if (
              name.includes(
                '2160p'
              )
            ) {
              resolutionRank = 0;
            } else if (
              name.includes(
                '1080p'
              )
            ) {
              resolutionRank = 1;
            } else if (
              name.includes(
                '720p'
              )
            ) {
              resolutionRank = 2;
            }

            // 3. HDR / képminőség
            let hdrRank = 5;

            if (
              /DOLBY[ ._-]?VISION|\bDV\b/.test(
                title
              )
            ) {
              hdrRank = 0;
            } else if (
              /HDR10\+|HDR10PLUS/.test(
                title
              )
            ) {
              hdrRank = 1;
            } else if (
              /HDR10/.test(
                title
              )
            ) {
              hdrRank = 2;
            } else if (
              /\bHDR\b/.test(
                title
              )
            ) {
              hdrRank = 3;
            } else {
              hdrRank = 4;
            }

            // 4. Forrás
            let sourceRank = 6;

            if (
              /REMUX/.test(title)
            ) {
              sourceRank = 0;
            } else if (
              /BLU[ ._-]?RAY/.test(
                title
              )
            ) {
              sourceRank = 1;
            } else if (
              /WEB[ ._-]?DL|WEBDL/.test(
                title
              )
            ) {
              sourceRank = 2;
            } else if (
              /WEB[ ._-]?RIP|WEBRIP/.test(
                title
              )
            ) {
              sourceRank = 3;
            } else if (
              /HDTV/.test(title)
            ) {
              sourceRank = 4;
            } else if (
              /\b(CAM|CAMRIP|TS|TELESYNC)\b/.test(
                title
              )
            ) {
              sourceRank = 5;
            }

            // 5. Videocodec
            let codecRank = 5;

            if (
              /HEVC|H265|H\.265/.test(
                title
              )
            ) {
              codecRank = 0;
            } else if (
              /AV1/.test(title)
            ) {
              codecRank = 1;
            } else if (
              /H264|H\.264|AVC/.test(
                title
              )
            ) {
              codecRank = 2;
            } else if (
              /XVID|DIVX/.test(
                title
              )
            ) {
              codecRank = 3;
            }

            // 6. Hangminőség
            let audioRank = 8;

            if (
              /ATMOS/.test(title)
            ) {
              audioRank = 0;
            } else if (
              /DTS[ ._-]?HD[ ._-]?MA/.test(
                title
              )
            ) {
              audioRank = 1;
            } else if (
              /TRUEHD/.test(title)
            ) {
              audioRank = 2;
            } else if (
              /DTS/.test(title)
            ) {
              audioRank = 3;
            } else if (
              /EAC3|DDP|DD\+/.test(
                title
              )
            ) {
              audioRank = 4;
            } else if (
              /AC3|DD/.test(title)
            ) {
              audioRank = 5;
            } else if (
              /AAC/.test(title)
            ) {
              audioRank = 6;
            }

            // 7. Seeders
            const seeders =
              Number(
                stream?._seeders
              ) || 0;

            return {
              cacheRank,
              resolutionRank,
              hdrRank,
              sourceRank,
              codecRank,
              audioRank,
              seeders,
            };
          };

          const ra =
            getRanks(a);

          const rb =
            getRanks(b);

          if (
            ra.cacheRank !==
            rb.cacheRank
          ) {
            return (
              ra.cacheRank -
              rb.cacheRank
            );
          }

          if (
            ra.resolutionRank !==
            rb.resolutionRank
          ) {
            return (
              ra.resolutionRank -
              rb.resolutionRank
            );
          }

          if (
            ra.hdrRank !==
            rb.hdrRank
          ) {
            return (
              ra.hdrRank -
              rb.hdrRank
            );
          }

          if (
            ra.sourceRank !==
            rb.sourceRank
          ) {
            return (
              ra.sourceRank -
              rb.sourceRank
            );
          }

          if (
            ra.codecRank !==
            rb.codecRank
          ) {
            return (
              ra.codecRank -
              rb.codecRank
            );
          }

          if (
            ra.audioRank !==
            rb.audioRank
          ) {
            return (
              ra.audioRank -
              rb.audioRank
            );
          }

          return (
            rb.seeders -
            ra.seeders
          );
        });

        // ---------------------------------------------------------------
        // Stream cache
        // ---------------------------------------------------------------

        streamListCache.set(
          streamCacheKey,
          {
            streams,
            expiresAt:
              Date.now() +
              STREAM_LIST_TTL_MS,
          }
        );

        return sendJson(res, 200, {
          streams,
        });

      } catch (e) {
        logError(
          '[STREAM] Hiba',
          e
        );

        return sendJson(res, 200, {
          streams: [],
        });
      }
    }

    // -----------------------------------------------------------------------
    // 404
    // -----------------------------------------------------------------------

    return sendJson(res, 404, {
      error: 'Not found',
    });
  };
}

module.exports = {
  createApp,
  manifestTemplate: MANIFEST,
};
