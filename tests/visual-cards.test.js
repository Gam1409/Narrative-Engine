import test from 'node:test';
import assert from 'node:assert/strict';
import { cardProfiles, saveCardVisual } from '../src/visual/cards.js';
import { StateManager } from '../src/state/manager.js';
import { MemoryStorageAdapter } from '../src/memory/storage.js';

const profile = {
    entityId: 'Anna',
    appearance: 'dark hair',
    lora: [{ name: 'anna.safetensors', weight: 0.8, family: 'illustrious' }],
};

test('card visual profile overrides legacy settings using an explicit entity ID', () => {
    const context = {
        characterId: 0,
        characters: [
            {
                avatar: 'Anna.png',
                name: 'Renamed',
                data: {
                    extensions: {
                        narrative_engine: {
                            visual: { version: 1, cardId: 'stable', profile },
                        },
                    },
                },
            },
        ],
    };
    assert.equal(
        cardProfiles(context, { characters: { Anna: {} } }, { Anna: { ...profile, appearance: 'old' } }).Anna
            .appearance,
        'dark hair',
    );
    context.characters.push({ ...structuredClone(context.characters[0]), avatar: 'Copy.png' });
    context.groupId = 'group';
    context.groups = [{ id: 'group', members: ['Anna.png', 'Copy.png'] }];
    assert.throws(() => cardProfiles(context, { characters: { Anna: {} } }), /Duplicate/);
});

test('card save preserves sibling fields and verifies server persistence', async () => {
    const card = { avatar: 'Anna.png', data: { extensions: { narrative_engine: { spriteManifest: ['keep'] } } } };
    const context = {
        characters: [card],
        writeExtensionField: async (_index, _key, value) => {
            card.data.extensions.narrative_engine = value;
        },
    };
    const result = await saveCardVisual(context, 0, profile, async () => ({ ok: true, json: async () => card }));
    assert.ok(result.cardId);
    assert.deepEqual(card.data.extensions.narrative_engine.spriteManifest, ['keep']);
    await assert.rejects(
        saveCardVisual(context, 0, profile, async () => ({
            ok: true,
            json: async () => ({ data: { extensions: {} } }),
        })),
        /not saved/,
    );
});

test('visual profiles persist and import in the same atomic world bundle', async () => {
    const storage = new MemoryStorageAdapter();
    const manager = new StateManager({ storage, chatFingerprint: 'visual-export' });
    await manager.commit({ visualProfiles: { Anna: profile } });
    const next = new StateManager({ storage, chatFingerprint: 'visual-export' });
    await next.load();
    assert.deepEqual(next.visualProfiles, { Anna: profile });
    const exported = next.exportData();
    exported.visualProfiles.Anna.appearance = 'updated';
    await next.importData(exported);
    assert.equal(next.visualProfiles.Anna.appearance, 'updated');
    const broken = new StateManager({
        storage: {
            setItem: async () => {
                throw new Error('disk full');
            },
        },
        chatFingerprint: 'visual-export',
    });
    await assert.rejects(broken.importData(exported), /disk full/);
    assert.equal(broken.visualProfiles, null);
});
