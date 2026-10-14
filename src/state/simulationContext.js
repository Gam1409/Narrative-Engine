import { resolveEvidence } from './evidence.js';
import { clone } from '../utils/object.js';
import { applyStateDelta } from './model.js';
import { sceneViewers, visibleTo } from '../memory/policy.js';
import { SIMULATION_DEFAULTS } from './simulation.js';

export function simulationPolicy(settings, state, participants, playerName) {
    return { ...Object.fromEntries(Object.keys(SIMULATION_DEFAULTS).map(k=>[k,settings[k] ?? SIMULATION_DEFAULTS[k]])),
        innerLifeMode: settings.characterState ? (settings.innerLifeMode || 'light') : 'off',
        simulationLevel: settings.worldSimulation ? (settings.simulationLevel || 'standard') : 'minimal',
        appraisalConfidence: settings.minimumConfidence ?? 0.5,
        characterEnabled: settings.characterState, relationshipsEnabled: settings.relationships,
        characterIds: sceneViewers({...state,scene:{present:[]}},participants),
        activeCharacters: sceneViewers(state,participants,false),
        playerIds: [...new Set([playerName || 'User','USER', ...Object.values(state.entities || {}).filter(e=>[e.id,e.name,...(e.aliases||[])].includes(playerName)).map(e=>e.id)])] };
}

export function prepareSimulation(post, delta, state, policy, texts) {
    delta=clone(delta);
    // New extractions use the causal contract. Legacy journal entries still replay unchanged.
    for (const key of ['relationships','world_events','npc_plans']) if (Object.keys(delta[key] || {}).length) throw new Error(`Simulation: Use simulation_delta for ${key}`);
    if ((post.relationship_delta || []).length || Object.keys(post.world_event_delta || {}).length) throw new Error('Simulation: Use causal simulation_delta for relationships and world events');
    if (delta.simulation) throw new Error('Simulation: Use top-level simulation_delta');
    for (const value of Object.values(delta.characters || {})) {
        if (value && typeof value==='object' && ['profile','emotions','mood','body','appraisals','expectations','expressedVsFelt','pendingProcessing','motivation'].some(k=>Object.hasOwn(value,k))) throw new Error('Simulation: Use simulation_delta for internal state');
    }
    const input=clone(post.simulation_delta || {});
    if (policy.simulationLevel === 'minimal') {
        delete delta.scene?.weather; delete delta.scene?.lighting;
        input.schedules=[]; input.resolveEvents=[];
    }
    if (Object.hasOwn(input,'policy')) throw new Error('Simulation: Policy cannot be changed by the Director');
    for (const event of input.events || []) {
        event.evidence = resolveEvidence(event.evidence, texts);
    }
    if (!policy.characterEnabled) input.characters=[];
    if (!policy.relationshipsEnabled) input.relationships=[];
    delta.simulation={...input,policy};
    // Validate before strict rewrite as well as inside the storage transaction.
    try { applyStateDelta(state,delta,{source:'director'}); }
    catch (error) { if (error.message.startsWith('Simulation:')) throw error; } // Entity errors retain transactional rejection semantics.
    return delta;
}

/** Private thoughts are supplied only when one generation recipient is unambiguous. */
export function innerLifeContext(state, participants, settings, viewers, target = undefined) {
    const observations={};
    const present=sceneViewers(state,participants,false);
    for (const id of present) {
        const c=state.simulation?.characters?.[id];
        if (viewers.every(viewer=>present.includes(viewer) && (c?.expressionViewers || []).includes(viewer)) && c?.expressionScene === (state.scene.location || null) && c?.expressedVsFelt?.expressed?.length) observations[id]={expressed:clone(c.expressedVsFelt.expressed)};
    }
    const recipients=target===undefined ? (participants.length===1 ? participants : []) : (target ? [target] : []);
    const recipient=recipients.length===1 ? sceneViewers({...state,scene:{present:[]}},recipients)[0] : null;
    const c=recipient && state.simulation?.characters?.[recipient];
    let own=null;
    if (c && settings.characterState) {
        own={characterId:recipient,emotions:clone(c.emotions || []),rule:'Private guidance for this character only. Express through behavior; do not grant this knowledge to others or dictate player actions.'};
        if (settings.innerLifeMode!=='off') Object.assign(own,{mood:clone(c.mood),expectations:clone(c.expectations || []),appraisals:clone((c.appraisals || []).slice(-3)),motivation:clone(c.motivation || [])});
        if (settings.innerLifeMode==='full') Object.assign(own,{body:clone(c.body),expressedVsFelt:clone(c.expressedVsFelt),tendencies:clone(c.profile?.behaviorTendencies),pendingProcessing:clone((c.pendingProcessing || []).filter(p=>p.status!=='processed'))});
    }
    if (own) {
        const shorten=v=>typeof v==='string' ? v.slice(0,180) : Array.isArray(v) ? v.slice(0,2).map(shorten) : v && typeof v==='object' ? Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).map(([k,x])=>[k,shorten(x)])) : v;
        own={...shorten(own),characterId:recipient};
    }
    const events=Object.values(state.simulation?.events || {}).filter(e=>e.status==='occurred' && !e.resolved && visibleTo(e,viewers)).map(e=>({id:e.id,summary:e.summary,gameTime:e.gameTime}));
    return {own,observations,events};
}


export function inspectionState(runtime) {
    const state=runtime.stateManager.snapshot();
    if (runtime.settings.showInternalState) return state;
    if (state.simulation) state.simulation.characters=Object.fromEntries(Object.entries(state.simulation.characters).map(([id,c])=>[id,{characterId:id,expressed:c.expressedVsFelt?.expressed || [],privateState:'Hidden; enable Show private state to inspect'}]));
    return state;
}
export function inspectionPacket(runtime) {
    const packet=runtime.diagnostics.lastPacket || '';
    return runtime.settings.showInternalState ? packet : packet.replace(/PRIVATE CHARACTER GUIDANCE\n[\s\S]*?(?=\n\n[A-Z][A-Z ]+\n|\n\nWrite only|$)/g,'PRIVATE CHARACTER GUIDANCE\n[Hidden in author inspection]');
}
export function postSimulationState(state, policy) {
    const next=clone(state);
    if (next.simulation) for (const [id,c] of Object.entries(next.simulation.characters)) {
        if (!policy.activeCharacters.includes(id)) next.simulation.characters[id]={characterId:id,mood:c.mood,emotions:(c.emotions || []).slice(0,2),pendingProcessing:(c.pendingProcessing || []).filter(p=>p.status!=='processed'),detail:'background'};
        else {c.appraisals=(c.appraisals || []).slice(-10);c.pendingProcessing=(c.pendingProcessing || []).filter(p=>p.status!=='processed');}
    }
    return next;
}
