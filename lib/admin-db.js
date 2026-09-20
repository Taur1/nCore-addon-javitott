const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');

fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'admin.db');

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS manifests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    seed_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    usage_count INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS manifest_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manifest_id INTEGER NOT NULL,
    imdb_id TEXT,
    stream_type TEXT,
    title TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (manifest_id)
      REFERENCES manifests(id)
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_manifests_token_hash
    ON manifests(token_hash);

  CREATE INDEX IF NOT EXISTS idx_manifest_usage_manifest_id
    ON manifest_usage(manifest_id);

  CREATE INDEX IF NOT EXISTS idx_manifest_usage_created_at
    ON manifest_usage(created_at);
`);

function hashToken(token) {
  return require('crypto')
    .createHash('sha256')
    .update(String(token || ''))
    .digest('hex');
}

function registerManifest({
  token,
  username,
  seedEnabled = false,
}) {
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  const existing = db
    .prepare(`
      SELECT *
      FROM manifests
      WHERE token_hash = ?
    `)
    .get(tokenHash);

  if (existing) {
    return existing;
  }

  const result = db
    .prepare(`
      INSERT INTO manifests (
        token_hash,
        username,
        seed_enabled,
        created_at,
        active
      )
      VALUES (?, ?, ?, ?, 1)
    `)
    .run(
      tokenHash,
      String(username || ''),
      seedEnabled ? 1 : 0,
      now
    );

  return db
    .prepare(`
      SELECT *
      FROM manifests
      WHERE id = ?
    `)
    .get(result.lastInsertRowid);
}

function touchManifest(token) {
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE manifests
    SET
      last_used_at = ?,
      usage_count = usage_count + 1
    WHERE token_hash = ?
  `).run(now, tokenHash);
}

function addUsage({
  token,
  imdbId = '',
  streamType = '',
  title = '',
}) {
  const tokenHash = hashToken(token);

  const manifest = db
    .prepare(`
      SELECT id
      FROM manifests
      WHERE token_hash = ?
    `)
    .get(tokenHash);

  if (!manifest) {
    return;
  }

  db.prepare(`
    INSERT INTO manifest_usage (
      manifest_id,
      imdb_id,
      stream_type,
      title,
      created_at
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(
    manifest.id,
    String(imdbId || ''),
    String(streamType || ''),
    String(title || ''),
    new Date().toISOString()
  );
}

function getStats() {
  return {
    manifests: db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM manifests
      `)
      .get().count,

    activeManifests: db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM manifests
        WHERE active = 1
      `)
      .get().count,

    seedEnabled: db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM manifests
        WHERE seed_enabled = 1
      `)
      .get().count,

    totalUsage: db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM manifest_usage
      `)
      .get().count,
  };
}

function getManifests() {
  return db
    .prepare(`
      SELECT
        id,
        username,
        seed_enabled,
        created_at,
        last_used_at,
        usage_count,
        active
      FROM manifests
      ORDER BY created_at DESC
    `)
    .all();
}

function getManifest(id) {
  return db
    .prepare(`
      SELECT
        id,
        username,
        seed_enabled,
        created_at,
        last_used_at,
        usage_count,
        active
      FROM manifests
      WHERE id = ?
    `)
    .get(id);
}

function getManifestHistory(id, limit = 100) {
  return db
    .prepare(`
      SELECT
        id,
        imdb_id,
        stream_type,
        title,
        created_at
      FROM manifest_usage
      WHERE manifest_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(id, limit);
}

function setManifestActive(id, active) {
  db.prepare(`
    UPDATE manifests
    SET active = ?
    WHERE id = ?
  `).run(active ? 1 : 0, id);
}

function deleteManifest(id) {
  db.prepare(`
    DELETE FROM manifests
    WHERE id = ?
  `).run(id);
}

module.exports = {
  db,
  hashToken,
  registerManifest,
  touchManifest,
  addUsage,
  getStats,
  getManifests,
  getManifest,
  getManifestHistory,
  setManifestActive,
  deleteManifest,
};
