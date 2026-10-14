const {resourceKey} = require('./visual-assets');
const {buildWorkflow} = require('./visual-workflow');
const stable = value => value && typeof value === 'object' ? (Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]))) : value;
const identity = scene => {const {lighting,weather,...location}=scene.location || {};return JSON.stringify(stable(location));};
/** Conservative, same-chat migration. Never infer location from an image or filename. */
function reuseLegacyBackground(queue,scope,job,recipe,input) {
    if(input.backgroundPolicy!=='location' || input.backgroundManual || job.operation!=='background')return null;
    const alias=queue.db.prepare('SELECT asset_id FROM visual_background_aliases WHERE scope=? AND resource_key=?').get(scope,job.resourceKey);
    if(alias){try{return queue.assets.metadata(scope,alias.asset_id);}catch{}}
    const rows=queue.db.prepare("SELECT data_json FROM visual_jobs WHERE scope=? AND status='done' AND json_extract(data_json,'$.operation')='background' ORDER BY updated_at DESC LIMIT 1000").all(scope);
    for(const row of rows){
        const old=JSON.parse(row.data_json);
        if(old.backgroundPolicy || !old.graph || !old.asset?.id || old.workflow!==job.workflow || old.recipeVersion!==job.recipeVersion || identity(old.scene)!==identity(job.scene))continue;
        try {
            // Rebuilding the old scene with TODAY's settings must reproduce its exact graph key.
            const graph=buildWorkflow(recipe,{...input,scene:old.scene,seed:old.seed});
            if(resourceKey({...old,graph})!==old.resourceKey)continue;
            const asset=queue.assets.metadata(scope,old.asset.id);
            queue.db.prepare('INSERT OR REPLACE INTO visual_background_aliases VALUES(?,?,?)').run(scope,job.resourceKey,asset.id);
            return asset;
        } catch { /* Missing/compacted evidence is not permission to reuse a different scene. */ }
    }
    return null;
}
module.exports={reuseLegacyBackground};
