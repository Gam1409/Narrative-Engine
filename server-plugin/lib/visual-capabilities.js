'use strict';

function checkGraph(graph, inventory) {
    const errors = [];
    if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory))
        return ['Invalid ComfyUI node inventory'];
    if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return ['Expected ComfyUI API prompt graph'];
    for (const [id, node] of Object.entries(graph)) {
        const schema = inventory[node?.class_type];
        if (!schema) {
            errors.push(`${id}: node ${node?.class_type || '(missing class_type)'} is not installed`);
            continue;
        }
        const definitions = { ...schema.input?.required, ...schema.input?.optional };
        for (const name of Object.keys(schema.input?.required || {})) {
            if (!Object.hasOwn(node.inputs || {}, name)) errors.push(`${id}.${name}: required input is missing`);
        }
        for (const [name, value] of Object.entries(node.inputs || {})) {
            const descriptor = definitions[name];
            if (!descriptor) {
                errors.push(`${id}.${name}: input is not supported`);
                continue;
            }
            const type = descriptor[0];
            if (
                Array.isArray(value) &&
                value.length === 2 &&
                typeof value[0] === 'string' &&
                Number.isInteger(value[1])
            ) {
                const source = graph[value[0]],
                    output = inventory[source?.class_type]?.output?.[value[1]];
                if (!source || value[1] < 0 || !output) errors.push(`${id}.${name}: invalid output link`);
                else if (typeof type === 'string' && type !== '*' && output !== '*' && output !== type)
                    errors.push(`${id}.${name}: expected ${type}, got ${output}`);
            } else if (type === 'COMBO' && Array.isArray(descriptor[1]?.options)) {
                if (!descriptor[1].options.includes(value)) errors.push(`${id}.${name}: unavailable value ${String(value)}`);
            } else if (Array.isArray(type)) {
                if (!type.includes(value)) errors.push(`${id}.${name}: unavailable value ${String(value)}`);
            } else if (['INT', 'FLOAT'].includes(type)) {
                const limits = descriptor[1] || {};
                if (
                    typeof value !== 'number' ||
                    !Number.isFinite(value) ||
                    (type === 'INT' && !Number.isInteger(value)) ||
                    (limits.min !== undefined && value < limits.min) ||
                    (limits.max !== undefined && value > limits.max)
                )
                    errors.push(`${id}.${name}: invalid numeric value`);
            } else if (type === 'STRING' && typeof value !== 'string') errors.push(`${id}.${name}: expected text`);
            else if (type === 'BOOLEAN' && typeof value !== 'boolean') errors.push(`${id}.${name}: expected boolean`);
        }
    }
    const visiting = new Set(),
        visited = new Set();
    function visit(id) {
        if (visiting.has(id)) {
            errors.push(`${id}: graph cycle`);
            return;
        }
        if (visited.has(id) || !graph[id]) return;
        visiting.add(id);
        for (const value of Object.values(graph[id].inputs || {})) {
            if (
                Array.isArray(value) &&
                value.length === 2 &&
                typeof value[0] === 'string' &&
                Number.isInteger(value[1])
            )
                visit(value[0]);
        }
        visiting.delete(id);
        visited.add(id);
    }
    Object.keys(graph).forEach(visit);
    if (!Object.values(graph).some((node) => inventory[node.class_type]?.output_node))
        errors.push('Workflow has no output node');
    return errors;
}
function summarizeInventory(inventory) {
    const choices = (node, input) => {
        const descriptor = inventory[node]?.input?.required?.[input];
        return Array.isArray(descriptor?.[0]) ? descriptor[0] : descriptor?.[0] === 'COMBO' ? descriptor[1]?.options || [] : [];
    };
    return {
        checkpoints: choices('CheckpointLoaderSimple', 'ckpt_name'),
        loras: choices('LoraLoader', 'lora_name'),
        faceDetectors: [...choices('NEAnimeFaceMask','model_name'), ...choices('LoadMediaPipeFaceLandmarker','model_name')],
        nodes: Object.keys(inventory),
        compatibility: 'File presence only; choose the exact SDXL or Pony family explicitly.',
    };
}
module.exports = { checkGraph, summarizeInventory };
