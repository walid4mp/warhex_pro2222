/**
 * turn.js — TURN/STUN credential generation for Metered.ca Open Relay.
 *
 * Uses coturn's "time-limited credentials" (REST API auth):
 *   username = "expiryTimestamp:userId"
 *   credential = HMAC-SHA1(secret, username) in base64
 *
 * This lets us serve rotating TURN credentials to each client without
 * a Metered account — the Open Relay static-auth endpoint accepts them.
 *
 * Ref: https://www.metered.ca/tools/openrelay/#static-auth
 * Ref: RFC 5389 §15.4 (TURN REST API)
 */
const crypto = require('crypto');
const logger = require('./logger');

const TURN_HOST   = process.env.TURN_HOST   || 'staticauth.openrelay.metered.ca';
const TURN_PORT   = parseInt(process.env.TURN_PORT || '80', 10);
const TURN_PORT_TLS = parseInt(process.env.TURN_PORT_TLS || '443', 10);
const TURN_SECRET = process.env.TURN_SECRET || 'openrelayprojectsecret';
const STUN_URL    = process.env.STUN_URL    || 'stun:stun.l.google.com:19302';
const METERED_KEY = process.env.METERED_API_KEY || '';

/**
 * Generate time-limited TURN credentials valid for `ttl` seconds.
 * @returns {{username:string, credential:string, urls:string[]}}
 */
function generateTurnCredentials(userId = 'guest', ttl = 86400) {
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const username = `${expiry}:${userId}`;
  const hmac = crypto.createHmac('sha1', TURN_SECRET);
  hmac.update(username);
  const credential = hmac.digest('base64');
  return { username, credential };
}

/**
 * Build the full iceServers array for a client.
 * Always includes STUN; adds TURN (UDP + TCP + TLS) when configured.
 */
function getIceServers(userId = 'guest') {
  const ice = [{ urls: STUN_URL }];

  // If we have a Metered API key, instructions are in the dashboard.
  // Otherwise, use Open Relay static auth with generated credentials.
  if (TURN_HOST && TURN_SECRET) {
    try {
      const { username, credential } = generateTurnCredentials(userId);
      ice.push(
        // UDP on port 80
        { urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=udp`, username, credential },
        // TCP on port 80 (bypasses UDP-blocked firewalls)
        { urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=tcp`, username, credential },
        // TLS on port 443 (bypasses deep packet inspection)
        { urls: `turns:${TURN_HOST}:${TURN_PORT_TLS}`, username, credential },
      );
      logger.debug('TURN credentials generated', { userId, expiry: username.split(':')[0] });
    } catch (e) {
      logger.warn('TURN credential generation failed', { error: e.message });
    }
  }

  return ice;
}

module.exports = { getIceServers, generateTurnCredentials };
