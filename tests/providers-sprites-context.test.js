import test from 'node:test';
import assert from 'node:assert/strict';
import { getChatFingerprint, resolveMessageSpeaker, resolveParticipants } from '../src/context/stContext.js';
import { normalizeOpenAiBase } from '../src/providers/http.js';
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
