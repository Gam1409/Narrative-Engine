let runtime = null;

export function installInterceptor(activeRuntime) {
    runtime = activeRuntime;
    globalThis.narrativeEngineInterceptor = narrativeEngineInterceptor;
}

export async function narrativeEngineInterceptor(chat, contextSize, _abort, type) {
    if (!runtime) return;
    let packet;
    try { packet = await runtime.preparePacket(chat, contextSize, type); }
    catch (error) { runtime.diagnostics?.error?.(error, 'pre'); return; }
    if (!packet) return;
    chat.push({
        is_user: false,
        is_system: true,
        name: 'Narrative Engine',
        send_date: Date.now(),
        mes: packet,
        extra: { narrative_engine: { ephemeral: true, kind: 'director_packet' } },
    });
}

export function uninstallInterceptor() {
    runtime = null;
    delete globalThis.narrativeEngineInterceptor;
}
