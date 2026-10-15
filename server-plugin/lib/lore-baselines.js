'use strict';

function normalizeBaselines(value) {
    if (value === undefined) return [];
    const fail = () => { throw Object.assign(new Error('Invalid lore state baselines'), {status:400}); };
    if (!Array.isArray(value) || value.length > 20) fail();
    const seen = new Set();
    return value.map(item => {
        if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['entityId','parameter','value'].includes(key))
            || typeof item.entityId !== 'string' || !item.entityId.trim() || item.entityId.length > 100
            || typeof item.parameter !== 'string' || !item.parameter.trim() || item.parameter.length > 100
            || !['string','number','boolean'].includes(typeof item.value)
            || typeof item.value === 'number' && !Number.isFinite(item.value)
            || typeof item.value === 'string' && item.value.length > 1000) fail();
        const key = JSON.stringify([item.entityId,item.parameter]);
        if (seen.has(key)) fail();
        seen.add(key);
        return {entityId:item.entityId,parameter:item.parameter,value:item.value};
    });
}
module.exports = {normalizeBaselines};
