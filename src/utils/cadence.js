const positive = (value, fallback) => Math.max(1, Number(value) || fallback);

export function shouldRunPre() { return true; }
export function shouldRunPost() { return true; }
export function shouldRunPlotMaintenance({ turn = 0, interval = 3 } = {}) {
    return turn > 0 && turn % positive(interval, 3) === 0;
}
export function shouldRunMemoryConsolidation({ messageCount = 0, sceneChanged = false, interval = 8 } = {}) {
    return Boolean(sceneChanged) || (messageCount > 0 && messageCount % positive(interval, 8) === 0);
}
export function shouldCreateCheckpoint({ messageCount = 0, interval = 10 } = {}) {
    return messageCount > 0 && messageCount % positive(interval, 10) === 0;
}
export function shouldRunWorldSimulation({ timeAdvanceMinutes = 0, dueEvent = false, sceneChanged = false, cadenceDue = false, thresholdMinutes = 5 } = {}) {
    return Boolean(dueEvent || sceneChanged || cadenceDue) || Number(timeAdvanceMinutes) >= Number(thresholdMinutes);
}

export const shouldRunPlot = shouldRunPlotMaintenance;
export const shouldConsolidateMemory = shouldRunMemoryConsolidation;
export const shouldCheckpoint = shouldCreateCheckpoint;
