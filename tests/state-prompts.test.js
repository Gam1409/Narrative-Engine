import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { clearStatePromptCache, loadStatePromptBundle, PROMPT_PRESETS, resolvePromptVariants } from '../src/director/statePrompts.js';
import { normalizeSettings } from '../src/settings.js';

const stateFiles = [
    'continuity', 'character_state', 'relationships', 'knowledge',
    'plot', 'world', 'memory', 'sprites',
];

test('all built-in prompt profiles resolve every state to a supported variant', () => {
    for (const preset of Object.keys(PROMPT_PRESETS)) {
        const resolved = resolvePromptVariants({ promptPreset: preset });
        assert.equal(Object.keys(resolved).length, 8);
        assert.ok(Object.values(resolved).every((variant) => ['light', 'balanced', 'strict'].includes(variant)));
    }
    assert.equal(resolvePromptVariants({ promptPreset: 'strictContinuity' }).continuity, 'strict');
    assert.equal(resolvePromptVariants({ promptPreset: 'livingWorld' }).worldSimulation, 'strict');
    assert.equal(resolvePromptVariants({ promptPreset: 'characterDriven' }).relationships, 'strict');
});

test('custom variants are normalized per state without discarding valid siblings', () => {
    const settings = normalizeSettings({
        promptPreset: 'custom',
        promptVariants: { continuity: 'light', knowledge: 'invalid', spriteDirector: 'strict' },
    });
    const resolved = resolvePromptVariants(settings);
    assert.equal(resolved.continuity, 'light');
    assert.equal(resolved.knowledge, 'strict');
    assert.equal(resolved.spriteDirector, 'strict');
});

test('all 24 state prompt fragments exist, are concise, and contain operational rules', async () => {
    for (const state of stateFiles) {
        for (const variant of ['light', 'balanced', 'strict']) {
            const url = new URL(`../prompts/states/${state}/${variant}.md`, import.meta.url);
            const content = (await readFile(fileURLToPath(url), 'utf8')).trim();
            assert.ok(content.length >= 80, `${state}/${variant} is too short`);
            assert.ok(content.length <= 900, `${state}/${variant} is too large`);
            assert.ok(content.split(/[.!?](?:\s|$)/).filter(Boolean).length >= 2, `${state}/${variant} needs actionable detail`);
        }
    }
});

test('bundle loads only enabled states, marks the phase, and reuses its cache', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url) => {
        calls.push(String(url));
        return { ok: true, text: async () => 'Preserve explicit facts. Record supported changes.' };
    };
    clearStatePromptCache();
    try {
        const settings = normalizeSettings({
            promptPreset: 'custom', promptVariants: { continuity: 'strict' },
            characterState: false, relationships: false, knowledge: false, plotManager: false,
            worldSimulation: false, memoryRetrieval: false, spriteDirector: false,
        });
        const pre = await loadStatePromptBundle(settings, 'pre');
        const post = await loadStatePromptBundle(settings, 'post');
        assert.match(pre, /PRE PHASE/);
        assert.match(post, /POST PHASE/);
        assert.match(pre, /continuity \(strict\)/);
        assert.equal(calls.length, 1);
        assert.match(calls[0], /continuity\/strict\.md$/);
    } finally {
        clearStatePromptCache();
        globalThis.fetch = originalFetch;
    }
});

test('POST schema explicitly accepts the world event delta used by runtime', async () => {
    const schema = JSON.parse(await readFile(fileURLToPath(new URL('../schemas/post_director.schema.json', import.meta.url)), 'utf8'));
    assert.ok(schema.required.includes('world_event_delta'));
    assert.equal(schema.properties.world_event_delta.type, 'object');
});
