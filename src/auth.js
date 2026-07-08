/**
 * auth.js — JWT authentication utilities.
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const logger = require('./logger');

const SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const refreshTokens = new Map(); // token → username (in-memory)

function signToken(username) {
  return jwt.sign({ username }, SECRET, { expiresIn: EXPIRES_IN });
}

function signRefreshToken(username) {
  const token = crypto.randomBytes(48).toString('hex');
  refreshTokens.set(token, username);
  return token;
}

function verifyToken(token) {
  try { return jwt.verify(token, SECRET); }
  catch { return null; }
}

function verifyRefreshToken(token) {
  return refreshTokens.get(token) || null;
}

function revokeRefreshToken(token) {
  refreshTokens.delete(token);
}

function hashPassword(pw) { return bcrypt.hashSync(pw, 12); }
function checkPassword(pw, hash) {
  try { return bcrypt.compareSync(pw, hash); }
  catch { return false; }
}

/**
 * Elo rating calculation (standard formula).
 */
function calcElo(playerElo, opponentElo, score, k = 32) {
  const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  return Math.round(playerElo + k * (score - expected));
}

module.exports = {
  signToken, signRefreshToken, verifyToken, verifyRefreshToken,
  revokeRefreshToken, hashPassword, checkPassword, calcElo,
};
