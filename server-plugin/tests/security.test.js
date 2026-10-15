'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isBlockedAddress, validateId, validateProviderUrl } = require('../lib/security');

test('SSRF validation permits loopback for local Director', async () => {
    const result = await validateProviderUrl('http://localhost:8080/v1', new Set(), async () => [{ address: '127.0.0.1', family: 4 }]);
    assert.equal(result.url.hostname, 'localhost');
});

test('SSRF validation rejects protected networks unless explicitly allowlisted', async () => {
    const lookup = async () => [{ address: '192.168.1.20', family: 4 }];
    await assert.rejects(validateProviderUrl('http://director.lan/v1', new Set(), lookup), /protected network/);
    const accepted = await validateProviderUrl('http://director.lan/v1', new Set(['director.lan']), lookup);
    assert.equal(accepted.explicitlyAllowed, true);
});

test('SSRF validation rejects credentials and unsupported protocols', async () => {
    await assert.rejects(validateProviderUrl('file:///etc/passwd'), /HTTP/);
    await assert.rejects(validateProviderUrl('https://user:password@example.com'), /Credentials/);
});

test('address and identifier validation covers unsafe inputs', () => {
    assert.equal(isBlockedAddress('10.0.0.1'), true);
    assert.equal(isBlockedAddress('::ffff:192.168.1.1'), true);
    assert.equal(isBlockedAddress('8.8.8.8'), false);
    assert.equal(validateId('chat:group-1'), 'chat:group-1');
    assert.throws(() => validateId('../escape'), /Invalid/);
});


test('SSRF blocks canonical hex and dotted IPv4-mapped IPv6 while retaining explicit allowlist', async () => {
    for (const address of ['::ffff:169.254.169.254','::ffff:a9fe:a9fe','0:0:0:0:0:ffff:0a00:0001','::ffff:c0a8:101']) {
        assert.equal(isBlockedAddress(address), true);
        await assert.rejects(validateProviderUrl(`http://[${address}]/`), /protected network/);
    }
    await assert.rejects(validateProviderUrl('http://mapped.example/',new Set(),async()=>[{address:'::ffff:a00:1',family:6}]), /protected network/);
    assert.equal(isBlockedAddress('::ffff:7f00:1'),false);
    assert.equal(isBlockedAddress('::ffff:808:808'),false);
    const accepted=await validateProviderUrl('http://[::ffff:a00:1]/',new Set(['::ffff:a00:1']));
    assert.equal(accepted.explicitlyAllowed,true);
});
