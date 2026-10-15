import test from 'node:test';
import assert from 'node:assert/strict';
import { getChatFingerprint, resolveMessageSpeaker, resolveParticipants } from '../src/context/stContext.js';
import { normalizeOpenAiBase, withTimeout, fetchJson } from '../src/providers/http.js';
import { SillyTavernProvider } from '../src/providers/sillyTavern.js';
import { ConnectionProfileProvider, listConnectionProfiles } from '../src/providers/connectionProfile.js';
import { createProvider } from '../src/providers/index.js';
import { normalizeSettings } from '../src/settings.js';
import { applySpriteDecisions } from '../src/sprites/integration.js';
import { filterSpriteCandidates, validateSpriteManifest } from '../src/sprites/manifest.js';

test('provider config is normalized without browser secrets', () => {
    const settings = normalizeSettings({ provider: 'openai', endpoint: 'http://localhost:1234', apiKey: 'must-not-survive', 'secret-id': 'also-remove', memoryTopK: 999 });
    assert.equal(settings.apiKey, undefined);
    assert.equal(settings['secret-id'], undefined);
    assert.equal(settings.memoryTopK, 20);
    assert.equal(normalizeOpenAiBase(settings.endpoint), 'http://localhost:1234/v1');
    const profileSettings = normalizeSettings({ provider: 'connectionProfile', connectionProfileId: '  openrouter-director  ' });
    assert.equal(profileSettings.provider, 'connectionProfile');
    assert.equal(profileSettings.connectionProfileId, 'openrouter-director');
});

test('connection profile provider delegates messages to SillyTavern without handling credentials', async () => {
    const calls = [];
    const profiles = [{ id: 'openrouter-director', name: 'OpenRouter Director', api: 'openrouter', model: 'openai/gpt-4.1-mini', 'secret-id': 'never-exposed' }];
    const service = {
        getSupportedProfiles: () => profiles,
        getProfile: (id) => profiles.find((profile) => profile.id === id),
        validateProfile: () => ({ selected: 'openai', source: 'openrouter' }),
        sendRequest: async (...args) => { calls.push(args); return { content: '{"ok":true}' }; },
    };
    const context = { ConnectionManagerRequestService: service };
    assert.ok(createProvider({ provider: 'connectionProfile', connectionProfileId: 'openrouter-director' }, context) instanceof ConnectionProfileProvider);
    assert.deepEqual(listConnectionProfiles(context), [{
        id: 'openrouter-director', name: 'OpenRouter Director', api: 'openrouter', model: 'openai/gpt-4.1-mini',
    }]);
    const provider = new ConnectionProfileProvider({ connectionProfileId: 'openrouter-director', temperature: 0.15 }, context);
    const result = await provider.complete({ messages: [{ role: 'user', content: 'Return JSON.' }], maxTokens: 321, timeoutMs: 1000 });
    assert.equal(result.content, '{"ok":true}');
    assert.equal(result.model, 'openai/gpt-4.1-mini');
    assert.equal(calls[0][0], 'openrouter-director');
    assert.deepEqual(calls[0][1], [{ role: 'user', content: 'Return JSON.' }]);
    assert.equal(calls[0][2], 321);
    assert.equal(calls[0][3].includePreset, true);
    assert.equal(calls[0][4].temperature, 0.15);
    assert.doesNotMatch(JSON.stringify(calls), /never-exposed/);
});

test('connection profile provider reports missing and unavailable profiles clearly', async () => {
    await assert.rejects(
        () => new ConnectionProfileProvider({ connectionProfileId: '' }, {}).healthCheck(),
        /Connection Manager is unavailable/,
    );
    const context = { ConnectionManagerRequestService: {
        sendRequest: async () => ({ content: '' }), getProfile: () => { throw new Error('missing'); },
    } };
    await assert.rejects(
        () => new ConnectionProfileProvider({ connectionProfileId: 'deleted' }, context).healthCheck(),
        /no longer exists/,
    );
});

test('group identity and actual speaker do not depend on characterId', () => {
    const context = {
        groupId: 'group-1', chatId: 'chat-a',
        groups: [{ id: 'group-1', chat_id: 'chat-a', members: ['a.png', 'b.png'] }],
        characters: [{ name: 'A', avatar: 'a.png' }, { name: 'B', avatar: 'b.png' }],
        characterId: 0,
    };
    assert.deepEqual(resolveParticipants(context).map((item) => item.name), ['A', 'B']);
    assert.equal(resolveMessageSpeaker({ name: 'B', original_avatar: 'b.png' }, context).name, 'B');
    assert.match(getChatFingerprint(context), /^ne-[0-9a-f]{8}$/);
});

test('2000 sprites are filtered to a bounded shortlist and traversal names are rejected', () => {
    const sprites = Array.from({ length: 2000 }, (_, index) => ({
        file: `mood-${index}.png`, character: index < 1000 ? 'Kenzie' : 'Bex',
        expression: index % 2 ? 'joy' : 'anger', costume: index % 3 ? 'winter' : 'summer', pose: 'standing',
    }));
    assert.equal(validateSpriteManifest([...sprites, { file: '../bad.png', character: 'Kenzie' }]).valid, false);
    const candidates = filterSpriteCandidates(sprites, { character: 'Kenzie', costume: 'winter', expression: 'joy', pose: 'standing' }, 20);
    assert.equal(candidates.length, 20);
    assert.ok(candidates.every((item) => item.character === 'Kenzie'));
});

test('KEEP preserves state and an out-of-shortlist sprite is not executed', async () => {
    const commands = [];
    const context = { executeSlashCommandsWithOptions: async (value) => commands.push(value) };
    const previous = { Kenzie: 'joy-1.png', Bex: 'neutral.png' };
    const next = await applySpriteDecisions({
        Kenzie: 'KEEP',
        Bex: { action: 'SET', sprite: 'invented.png' },
    }, {
        context, currentSpeaker: 'Bex', previous,
        allowedCandidates: { Bex: [{ file: 'sad.png' }] },
    });
    assert.deepEqual(next, previous);
    assert.deepEqual(commands, []);
});


test('matching expression cannot outweigh incompatible clothing or a missing wardrobe signature', () => {
    const sprites = [
        { character: 'Anna', file: 'old.png', costume: 'old', expression: 'joy', pose: 'standing' },
        { character: 'Anna', file: 'unknown.png', expression: 'joy' },
        { character: 'Anna', file: 'new.png', costume: 'new', wardrobeSignature: 'torn' },
    ];
    const candidates = filterSpriteCandidates(sprites, { character: 'Anna', costume: 'new', expression: 'joy', wardrobeSignature: 'torn' });
    assert.deepEqual(candidates.map(item => item.file), ['new.png']);
});

test('rejected sprite cannot execute a costume command', async () => {
    const commands = [];
    await applySpriteDecisions({ Anna: { action: 'SET', sprite: 'bad.png', costume: 'invented' } }, {
        context: { executeSlashCommandsWithOptions: async command => commands.push(command) },
        currentSpeaker: 'Anna', allowedCandidates: { Anna: [{ file: 'good.png', costume: 'canon' }] },
    });
    assert.deepEqual(commands, []);
});


test('validated costume change applies even with the same expression filename',async()=>{
    const commands=[];
    await applySpriteDecisions({Anna:{sprite:'neutral.png',costume:'formal'}},{
        context:{executeSlashCommandsWithOptions:async command=>commands.push(command)},
        currentSpeaker:'Anna',previous:{Anna:'neutral.png'},allowedCandidates:{Anna:[{file:'neutral.png',costume:'formal'}]}});
    assert.equal(commands.length,2);assert.match(commands[0],/costume.*formal/);
    assert.match(commands[1],/expression-set/);
});


test('speaker avatar wins over an earlier card with the same name', () => {
    const context = {characters: [{name:'Anna',avatar:'a.png'}, {name:'Anna',avatar:'b.png'}]};
    assert.equal(resolveMessageSpeaker({name:'Anna',original_avatar:'b.png'},context).id,'b.png');
    assert.equal(resolveMessageSpeaker({name:'Renamed',force_avatar:'b.png'},context).id,'b.png');
    assert.equal(resolveMessageSpeaker({name:'Anna'},context).id,'a.png');
});

test('already cancelled requests never reach fetch and preserve the abort reason', async () => {
    const parent = new AbortController();
    const reason = new DOMException('Chat changed', 'AbortError');
    parent.abort(reason);
    const timeout = withTimeout(parent.signal, 1000);
    try {
        assert.equal(timeout.signal.aborted, true);
        assert.equal(timeout.signal.reason, reason);
    } finally { timeout.dispose(); }
    const original = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw Error('must not send'); };
    try {
        await assert.rejects(fetchJson('https://example.invalid', {}, {signal:parent.signal}), error => error.cause === reason);
        assert.equal(requests, 0);
    } finally { globalThis.fetch = original; }
});

test('later parent cancellation propagates until timeout disposal', () => {
    const parent = new AbortController(), timeout = withTimeout(parent.signal, 1000);
    parent.abort('stopped');
    assert.equal(timeout.signal.reason, 'stopped');
    timeout.dispose();
    const second = new AbortController(), disposed = withTimeout(second.signal, 1000);
    disposed.dispose(); second.abort();
    assert.equal(disposed.signal.aborted, false);
});


test('cancelled requests do not start either SillyTavern transport', async () => {
    const controller = new AbortController(); controller.abort();
    let calls = 0;
    const context = {
        generateRaw: async () => {calls++;return '{}';},
        ConnectionManagerRequestService: {
            getProfile: () => ({id:'test'}),
            sendRequest: async () => {calls++;return '{}';},
        },
    };
    for (const provider of [new SillyTavernProvider({},context), new ConnectionProfileProvider({connectionProfileId:'test'},context)]) {
        await assert.rejects(provider.complete({signal:controller.signal,timeoutMs:1000,messages:[{role:'user',content:'test'}]}));
    }
    assert.equal(calls,0);
});
