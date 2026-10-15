export function createStudyDeadline(limitMs = 40000, now = () => performance.now()) {
    if (!Number.isFinite(limitMs) || limitMs <= 0) throw Error('Invalid time budget');
    const end = now() + limitMs;
    return {
        remaining() {
            const ms = Math.floor(end - now());
            if (ms <= 0) throw Error('Shared time budget exhausted');
            return ms;
        },
    };
}
