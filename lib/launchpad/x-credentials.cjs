'use strict';
const fs = require('node:fs');

// Server-only. Keep the original credential document outside the project/release.
function loadXBearerToken(env = process.env, read = fs.readFileSync) {
  if (env.X_BEARER_TOKEN?.trim()) return env.X_BEARER_TOKEN.trim();
  if (!env.X_CREDENTIALS_FILE) return undefined;
  let source;
  try { source = read(env.X_CREDENTIALS_FILE, 'utf8'); }
  catch { throw new Error('Unable to read the private X credentials file.'); }
  const match = source.match(/^\s*Bearer[ _]Token\s*(?:[:=][ \t]*)?\r?\n?[ \t]*([^\s]+)[ \t]*$/im);
  if (!match || match[1].length < 20) throw new Error('The private X credentials file has no valid Bearer Token entry.');
  return match[1];
}

module.exports = { loadXBearerToken };
