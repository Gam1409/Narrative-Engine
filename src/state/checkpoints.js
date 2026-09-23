import { clone } from '../utils/object.js';

export function createCheckpoint(state, messageIndex, metadata = {}) {
    return {
        schemaVersion: state.schemaVersion,
        messageIndex,
        state: clone(state),
        createdAt: metadata.createdAt || new Date().toISOString(),
        ...metadata,
    };
}

export function nearestCheckpoint(checkpoints, messageIndex = Infinity) {
    return [...(checkpoints || [])]
        .filter((item) => Number(item.messageIndex) <= messageIndex)
        .sort((a, b) => b.messageIndex - a.messageIndex)[0] || null;
}
