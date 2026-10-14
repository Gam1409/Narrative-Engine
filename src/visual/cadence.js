import { canonicalStringify } from '../utils/object.js';

// Expressions and small pose/position changes do not warrant a full illustration.
export function illustrationMilestone(scene) {
    return canonicalStringify({
        location: scene.location,
        keyObjects: scene.keyObjects,
        characters: scene.characters.map(({ pose, emotion, expressed, position, ...identity }) => identity),
    });
}
