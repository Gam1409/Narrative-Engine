import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_UI_SETTINGS,
    formatDebugValue,
    getSettingValue,
    normalizeUiSettings,
    registerDebugFunctions,
    setSettingValue,
} from '../src/ui/index.js';

test('normalizeUiSettings fills defaults and accepts legacy nested module values', () => {
    const normalized = normalizeUiSettings({ enabled: true, modules: { continuity: false }, memoryTopK: 9 });
    assert.equal(normalized.enabled, true);
    assert.equal(normalized.continuity, false);
    assert.equal(normalized.memoryTopK, 9);
    assert.equal(normalized.spriteDirector, true);
    assert.equal(DEFAULT_UI_SETTINGS.enabled, false);
});

test('normalizeUiSettings deeply merges prompt variants', () => {
    const source = { promptVariants: { continuity: 'strict' } };
    const normalized = normalizeUiSettings(source);

    assert.equal(normalized.promptVariants.continuity, 'strict');
    assert.equal(normalized.promptVariants.knowledge, 'strict');
    assert.equal(normalized.promptVariants.worldSimulation, 'balanced');
    assert.notEqual(normalized.promptVariants, source.promptVariants);
});

test('nested setting helpers preserve prompt variant siblings', () => {
    const settings = normalizeUiSettings({ promptVariants: { knowledge: 'strict' } });
    const variants = settings.promptVariants;
    setSettingValue(settings, 'promptVariants.continuity', 'light');

    assert.equal(getSettingValue(settings, 'promptVariants.continuity'), 'light');
    assert.equal(settings.promptVariants.knowledge, 'strict');
    assert.equal(settings.promptVariants, variants);
});

test('formatDebugValue renders arrays, objects, and empty values as plain text', () => {
    assert.equal(formatDebugValue(['Alice', 'Bob']), 'Alice, Bob');
    assert.equal(formatDebugValue({ scene: 'Atrium' }), '{\n  "scene": "Atrium"\n}');
    assert.equal(formatDebugValue(null), '—');
});

test('registerDebugFunctions uses the public four-argument API', async () => {
    const calls = [];
    let healthChecks = 0;
    const context = { registerDebugFunction: (...args) => calls.push(args) };
    const ids = registerDebugFunctions(context, {
        healthCheck: async () => { healthChecks += 1; },
    });

    assert.deepEqual(ids, ['narrative-engine:health-check']);
    assert.equal(calls[0][1], 'Health check');
    await calls[0][3]();
    assert.equal(healthChecks, 1);
});
