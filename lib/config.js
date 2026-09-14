const crypto = require('node:crypto');

const VERSION = 3;
const SECRET_ENV = 'NCORE_CONFIG_SECRET';

function getSecret() {
  const secret = String(process.env[SECRET_ENV] || '').trim();
  if (!secret || secret.length < 32) {
    throw new Error(`${SECRET_ENV} must be set and be at least 32 characters`);
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function encodeConfig({ username, password, torboxApiKey }) {
  if (!username || !password || !torboxApiKey) {
    throw new Error('username, password and torboxApiKey are required');
  }

  const payload = JSON.stringify({
    v: VERSION,
    u: String(username),
    p: String(password),
    t: String(torboxApiKey),
  });

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSecret(), iv);
  const encrypted = Buffer.concat([
    cipher.update(payload, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([Buffer.from([VERSION]), iv, tag, encrypted]).toString('base64url');
}

function decodeConfig(token) {
  if (!token) throw new Error('missing config token');

  let packed;
  try {
    packed = Buffer.from(String(token), 'base64url');
  } catch {
    throw new Error('invalid config token encoding');
  }

  if (packed.length < 30 || packed[0] !== VERSION) {
    throw new Error('invalid config token');
  }

  try {
    const iv = packed.subarray(1, 13);
    const tag = packed.subarray(13, 29);
    const encrypted = packed.subarray(29);

    const decipher = crypto.createDecipheriv('aes-256-gcm', getSecret(), iv);
    decipher.setAuthTag(tag);

    const json = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');

    const parsed = JSON.parse(json);

    if (!parsed || !parsed.u || !parsed.p || !parsed.t || parsed.v !== VERSION) {
      throw new Error('invalid config token payload');
    }

    return {
      username: String(parsed.u),
      password: String(parsed.p),
      torboxApiKey: String(parsed.t),
    };
  } catch (error) {
    if (error?.message === 'invalid config token payload') throw error;
    throw new Error('invalid or expired config token');
  }
}

module.exports = {
  encodeConfig,
  decodeConfig,
};
