'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

// URL canonicalization also expands dotted IPv4-mapped IPv6 to hexadecimal.
function canonicalAddress(address) {
    const raw = String(address).toLowerCase().split('%')[0];
    if (!net.isIPv6(raw)) return raw;
    const normalized = new URL(`http://[${raw}]/`).hostname.slice(1,-1);
    const mapped = normalized.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
    if (!mapped) return normalized;
    const high = parseInt(mapped[1],16), low = parseInt(mapped[2],16);
    return [high >>> 8, high & 255, low >>> 8, low & 255].join('.');
}
function isLoopback(address) {
    const normalized = canonicalAddress(address);
    return normalized === '::1' || net.isIPv4(normalized) && normalized.startsWith('127.');
}
function isBlockedAddress(address) {
    address = canonicalAddress(address);
    if (isLoopback(address)) return false;
    if (net.isIPv4(address)) {
        const octets = address.split('.').map(Number);
        return octets[0] === 0 || octets[0] === 10 || octets[0] === 127
            || (octets[0] === 169 && octets[1] === 254)
            || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
            || (octets[0] === 192 && octets[1] === 168)
            || octets[0] >= 224;
    }
    return address === '::' || address.startsWith('fc') || address.startsWith('fd')
        || address.startsWith('fe8') || address.startsWith('fe9')
        || address.startsWith('fea') || address.startsWith('feb')
        || address.startsWith('ff');
}

async function validateProviderUrl(rawUrl, allowHosts = new Set(), lookup = dns.lookup) {
    let url;
    try { url = new URL(rawUrl); } catch { throw new Error('Director URL is invalid'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Director URL must use HTTP or HTTPS');
    if (url.username || url.password) throw new Error('Credentials are forbidden in Director URL');
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const explicitlyAllowed = allowHosts.has(hostname) || allowHosts.has(`${hostname}:${url.port || ''}`);
    const results = net.isIP(hostname)
        ? [{ address: hostname, family: net.isIP(hostname) }]
        : await lookup(hostname, { all: true, verbatim: true });
    if (!results.length) throw new Error('Director host did not resolve');
    for (const result of results) {
        if (isBlockedAddress(result.address) && !isLoopback(result.address) && !explicitlyAllowed) {
            throw new Error('Director URL resolves to a protected network; add it to the explicit allowlist');
        }
    }
    return { url, addresses: new Set(results.map((result) => result.address)), explicitlyAllowed };
}

function safeJson(value, maxBytes) {
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > maxBytes) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    return json;
}

function validateId(value, name = 'id') {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_.:@-]{1,200}$/.test(value)) {
        throw Object.assign(new Error(`Invalid ${name}`), { status: 400 });
    }
    return value;
}

function assertObject(value, name = 'body') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw Object.assign(new Error(`${name} must be an object`), { status: 400 });
    }
    return value;
}

function rateLimiter({ limit, windowMs }) {
    const clients = new Map();
    return (req, res, next) => {
        const now = Date.now();
        const key = req.ip || req.socket?.remoteAddress || 'unknown';
        const bucket = clients.get(key);
        if (!bucket || now - bucket.start >= windowMs) {
            clients.set(key, { start: now, count: 1 });
            if (clients.size > 10000) for (const [id, entry] of clients) if (now - entry.start >= windowMs) clients.delete(id);
            return next();
        }
        bucket.count += 1;
        if (bucket.count > limit) return res.status(429).json({ error: 'Rate limit exceeded' });
        return next();
    };
}

module.exports = { assertObject, isBlockedAddress, isLoopback, rateLimiter, safeJson, validateId, validateProviderUrl };
