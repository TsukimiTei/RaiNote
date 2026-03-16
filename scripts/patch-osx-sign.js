#!/usr/bin/env node
/**
 * Patch @electron/osx-sign to add retry logic for Apple timestamp server failures.
 *
 * Apple's timestamp server rate-limits rapid sequential requests. When signing
 * 200+ files in an Electron app bundle, requests start failing around file 15.
 * This patch wraps execFileAsync with exponential backoff retry (up to 5 retries).
 *
 * Run automatically via npm postinstall, or manually: node scripts/patch-osx-sign.js
 */
const fs = require('fs')
const path = require('path')

const utilPath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@electron',
  'osx-sign',
  'dist',
  'cjs',
  'util.js'
)

if (!fs.existsSync(utilPath)) {
  console.log('[patch-osx-sign] @electron/osx-sign not found, skipping patch.')
  process.exit(0)
}

const MARKER = '// PATCHED: timestamp retry logic'

let content = fs.readFileSync(utilPath, 'utf8')

if (content.includes(MARKER)) {
  console.log('[patch-osx-sign] Already patched, skipping.')
  process.exit(0)
}

const original = `async function execFileAsync(file, args, options = {}) {
    if (exports.debugLog.enabled) {
        (0, exports.debugLog)('Executing...', file, args && Array.isArray(args) ? removePassword(args.join(' ')) : '');
    }
    return new Promise(function (resolve, reject) {
        child.execFile(file, args, options, function (err, stdout, stderr) {
            if (err) {
                (0, exports.debugLog)('Error executing file:', '\\n', '> Stdout:', stdout, '\\n', '> Stderr:', stderr);
                reject(err);
                return;
            }
            resolve(stdout);
        });
    });
}`

const patched = `${MARKER}
async function execFileAsync(file, args, options = {}) {
    if (exports.debugLog.enabled) {
        (0, exports.debugLog)('Executing...', file, args && Array.isArray(args) ? removePassword(args.join(' ')) : '');
    }
    const maxRetries = 5;
    const baseDelay = 1000;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await new Promise(function (resolve, reject) {
                child.execFile(file, args, options, function (err, stdout, stderr) {
                    if (err) {
                        err._stderr = stderr;
                        err._stdout = stdout;
                        reject(err);
                        return;
                    }
                    resolve(stdout);
                });
            });
            return result;
        } catch (err) {
            const errMsg = String(err.message || '') + String(err._stderr || '');
            const isTimestampError = /timestamp/i.test(errMsg) || /not available/i.test(errMsg) || /time-stamp/i.test(errMsg);
            if (isTimestampError && attempt < maxRetries) {
                const delay = baseDelay * Math.pow(2, attempt);
                (0, exports.debugLog)('Timestamp error on attempt ' + (attempt + 1) + '/' + (maxRetries + 1) + ', retrying in ' + delay + 'ms...');
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            (0, exports.debugLog)('Error executing file:', '\\n', '> Stdout:', err._stdout || '', '\\n', '> Stderr:', err._stderr || '');
            throw err;
        }
    }
}`

if (!content.includes('async function execFileAsync(file, args, options = {})')) {
  console.log('[patch-osx-sign] Could not find execFileAsync function, skipping.')
  process.exit(0)
}

content = content.replace(original, patched)

if (!content.includes(MARKER)) {
  console.log('[patch-osx-sign] Patch replacement failed (source may have changed), skipping.')
  process.exit(0)
}

fs.writeFileSync(utilPath, content, 'utf8')
console.log('[patch-osx-sign] Successfully patched execFileAsync with timestamp retry logic.')
