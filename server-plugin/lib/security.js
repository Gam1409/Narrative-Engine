'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

function isLoopback(address) {
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return address === '::1' || address.startsWith('127.') || address === '0:0:0:0:0:0:0:1'
        || Boolean(mapped && mapped.startsWith('127.'));
}

function isBlockedAddress(address) {
    if (isLoopback(address)) return false;
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return isBlockedAddress(mapped);
    if (net.isIPv4(address)) {
        const octets = address.split('.').map(Number);
        return octets[0] === 0 || octets[0] === 10 || octets[0] === 127
            || (octets[0] === 169 && octets[1] === 254)
            || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
            || (octets[0] === 192 && octets[1] === 168)
            || octets[0] >= 224;
    }
    const normalized = address.toLowerCase().split('%')[0];
    return normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd')
        || normalized.startsWith('fe8') || normalized.startsWith('fe9')
        || normalized.startsWith('fea') || normalized.startsWith('feb')
        || normalized.startsWith('ff');
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
