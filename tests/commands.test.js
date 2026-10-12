import test from 'node:test';
import assert from 'node:assert/strict';
import { registerCommands } from '../src/commands/registerCommands.js';

test('English action commands register without aliases and invoke their handlers', async () => {
    const commands = [], edits = [];
    const context = { SlashCommand: { fromProps: props => props }, SlashCommandParser: { addCommandObject: command => commands.push(command) } };
    const runtime = { authorEdit: async value => { edits.push(value); return { accepted: true }; } };
    registerCommands(context, runtime, {});
    assert.equal(commands.length, 14);
    assert.ok(commands.every(c => c.name.startsWith('narrative-') && !/[\u0400-\u04ff]/.test(c.helpString)));
    const edit = commands.find(c => c.name === 'narrative-edit-world');
    assert.ok(commands.every(c => !Object.hasOwn(c, 'aliases')));
    assert.equal(await edit.callback({}, '{"reason":"Initial world","ops":[]}'), '{"accepted":true}');
    assert.deepEqual(edits, [{ reason: 'Initial world', ops: [] }]);
    assert.ok(commands.some(c => c.name === 'narrative-configure-session'));
    assert.ok(commands.every(c => !c.name.startsWith('ne-')));
});
