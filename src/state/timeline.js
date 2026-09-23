import { clone } from '../utils/object.js';

export function advanceTimeline(timeline = {}, minutes = 0) {
    const next = clone(timeline || {});
    const amount = Number(minutes);
    if (!Number.isFinite(amount)) throw new TypeError('minutes must be finite');
    next.elapsedMinutes = Number(next.elapsedMinutes || 0) + amount;
    if (next.date && next.time && /^\d{4}-\d{2}-\d{2}$/.test(next.date) && /^\d{2}:\d{2}$/.test(next.time)) {
        const instant = new Date(`${next.date}T${next.time}:00Z`);
        if (!Number.isNaN(instant.valueOf())) {
            instant.setUTCMinutes(instant.getUTCMinutes() + amount);
            next.date = instant.toISOString().slice(0, 10);
            next.time = instant.toISOString().slice(11, 16);
        }
    }
    return next;
}

export function dueEvents(timeline = {}) {
    if (!timeline.date || !timeline.time) return [];
    const now = `${timeline.date}T${timeline.time}`;
    return (timeline.scheduled || []).filter((event) => event?.due && event.due.slice(0, 16) <= now);
}
