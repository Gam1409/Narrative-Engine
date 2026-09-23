import { createInitialState, CURRENT_SCHEMA_VERSION } from './model.js';
import { clone } from '../utils/object.js';

const migrations = new Map([
    [1, (input) => createInitialState(input)],
]);

export function registerMigration(targetVersion, migrate) {
    if (!Number.isInteger(targetVersion) || targetVersion < 1 || typeof migrate !== 'function') throw new TypeError('invalid migration');
    migrations.set(targetVersion, migrate);
}

export function migrateState(input, targetVersion = CURRENT_SCHEMA_VERSION) {
    let state = clone(input || {});
    let version = Number(state.schemaVersion || 0);
    if (version > targetVersion) throw new Error(`State schema ${version} is newer than supported ${targetVersion}`);
    while (version < targetVersion) {
        const nextVersion = version + 1;
        const migrate = migrations.get(nextVersion);
        if (!migrate) throw new Error(`Missing migration to schema ${nextVersion}`);
        state = migrate(state);
        state.schemaVersion = nextVersion;
        version = nextVersion;
    }
    return state;
}
