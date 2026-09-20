const crypto = require('crypto');

const VERSION = 3;

function getSecret() {
  const secret = process.env.NCORE_CONFIG_SECRET;

  if (!secret) {
    throw new Error('NCORE_CONFIG_SECRET is not configured');
  }

  return crypto
    .createHash('sha256')
    .update(secret)
    .digest();
}

function encodeConfig({
  username,
  password,
  torboxApiKey,
  seedEnabled = false,
}) {
  const payload = JSON.stringify({
    v: VERSION,
    u: String(username),
    p: String(password),
    t: String(torboxApiKey),
    s: Boolean(seedEnabled),
  });

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    getSecret(),
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(payload, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    authTag.toString('base64url'),
  ].join('.');
}

function decodeConfig(token) {
  try {
    const value = String(token || '');

    // ============================================================
    // ÚJ tokenformátum:
    // IV.encrypted.authTag
    // ============================================================
    if (value.includes('.')) {
      const parts = value.split('.');

      if (parts.length !== 3) {
        throw new Error('invalid config token');
      }

      const [ivPart, encryptedPart, authTagPart] = parts;

      const iv = Buffer.from(ivPart, 'base64url');
      const encrypted = Buffer.from(encryptedPart, 'base64url');
      const authTag = Buffer.from(authTagPart, 'base64url');

      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        getSecret(),
        iv
      );

      decipher.setAuthTag(authTag);

      const payload = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8');

      return parseConfigPayload(payload);
    }

    // ============================================================
    // RÉGI tokenformátum:
    // [VERSION][IV 12 byte][AUTH TAG 16 byte][encrypted]
    // ============================================================
    const packed = Buffer.from(value, 'base64url');

    if (
      packed.length < 30 ||
      packed[0] !== VERSION
    ) {
      throw new Error('invalid config token');
    }

    const iv = packed.subarray(1, 13);
    const authTag = packed.subarray(13, 29);
    const encrypted = packed.subarray(29);

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getSecret(),
      iv
    );

    decipher.setAuthTag(authTag);

    const payload = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');

    return parseConfigPayload(payload);

  } catch (error) {
    if (error?.message === 'invalid config token payload') {
      throw error;
    }

    throw new Error('invalid config token');
  }
}

function parseConfigPayload(payload) {
  const config = JSON.parse(payload);

  if (!config || typeof config !== 'object') {
    throw new Error('invalid config token payload');
  }

  if (config.v !== VERSION) {
    throw new Error('unsupported config token version');
  }

  if (
    typeof config.u !== 'string' ||
    typeof config.p !== 'string' ||
    typeof config.t !== 'string'
  ) {
    throw new Error('invalid config token payload');
  }

  return {
    username: config.u,
    password: config.p,
    torboxApiKey: config.t,

    // Régi manifesteknél nincs "s" mező,
    // ezért alapértelmezés szerint nincs seedelés.
    seedEnabled: Boolean(config.s),
  };
}

module.exports = {
  VERSION,
  encodeConfig,
  decodeConfig,
};
