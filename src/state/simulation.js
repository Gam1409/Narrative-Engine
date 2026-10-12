import { clone } from '../utils/object.js';
import { assertSafeData } from './entities.js';

export const SIMULATION_DEFAULTS = Object.freeze({ innerLifeMode: 'light', simulationLevel: 'standard',
    significanceThreshold: 0.7, relationshipConfidence: 0.7, relationshipMaxChange: 0.15,
    repetitionThreshold: 3, minTurnMinutes: 0, maxTurnMinutes: 1440 });
const fail = message => { throw new Error(`Simulation: ${message}`); };
const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
function number(n, min = 0, max = 1) { if (!Number.isFinite(n) || n < min || n > max) fail(`number outside ${min}..${max}`); return n; }
function text(s) { if (typeof s !== 'string' || !s.trim() || ['__proto__','constructor','prototype'].includes(s) || s.length > 4000) fail('nonempty bounded text required'); return s; }
function list(value = []) { if (!Array.isArray(value) || value.length > 100) fail('expected bounded list'); return value; }
function exact(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected object'); for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`unsupported field ${key}`); }
export function gameMinute(timeline) {
    if (!timeline?.date || !timeline?.time) return null;
    const stamp = `${timeline.date}T${timeline.time}`;
    const time = Date.parse(`${stamp}:00Z`);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0,16) !== stamp) fail('invalid game date/time');
    return time / 60000;
}
export function gameStamp(minute) { return new Date(minute * 60000).toISOString().slice(0,16); }
function dueMinute(value, now) {
    if (value === 'next_morning') {
        if (now === null) fail('next_morning needs a game date/time');
        return Math.floor(now / 1440) * 1440 + 1440 + 8 * 60;
    }
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) fail('absolute game time required');
    return gameMinute({date:value.slice(0,10), time:value.slice(11)});
}
export function emptySimulation() { return { version: 1, characters: {}, events: {}, schedules: {} }; }
function character(state, id) {
    text(id);
    if (!(Object.hasOwn(state.characters || {}, id) || state.entities?.[id]?.type === 'character')) fail(`unknown character ${id}`);
}
function cause(sim, id, who) {
    const event = sim.events[id];
    if (!event || event.status !== 'occurred') fail(`missing occurred cause ${id}`);
    if (who && !event.participants.includes(who) && !event.visibleTo.includes('*') && !event.visibleTo.includes(who)) fail(`cause unknown to ${who}`);
    return event;
}
function policyFor(input) {
    const p = { ...SIMULATION_DEFAULTS, ...(input || {}) };
    if (!['off','light','full'].includes(p.innerLifeMode) || !['minimal','standard','living'].includes(p.simulationLevel)) fail('invalid mode');
    for (const key of ['significanceThreshold','relationshipConfidence','relationshipMaxChange']) number(p[key]);
    number(p.repetitionThreshold,2,20); number(p.minTurnMinutes,0,525600); number(p.maxTurnMinutes,p.minTurnMinutes,525600);
    list(p.activeCharacters); list(p.playerIds);
    return p;
}

/** Pure deterministic transition. Policy and observations belong to the immutable turn. */
export function applySimulation(previous, state, input, metadata = {}) {
    assertSafeData(input);
    exact(input, ['policy','events','characters','relationships','schedules','resolveEvents']);
    const author = metadata.source === 'author';
    const policy = policyFor(input.policy);
    const checkCharacter = id => { if ([...(policy.characterIds || []), ...(policy.playerIds || [])].includes(id)) text(id); else character(state,id); };
    const sim = clone(previous.simulation || emptySimulation());
    const now = gameMinute(state.timeline), before = gameMinute(previous.timeline);
    const elapsed = now !== null && before !== null ? now-before : Number(state.timeline?.elapsedMinutes || 0)-Number(previous.timeline?.elapsedMinutes || 0);
    if (!author && (elapsed < policy.minTurnMinutes || elapsed > policy.maxTurnMinutes)) fail('game time advance outside configured bounds');
    if (now!==null && before!==null) state.timeline.elapsedMinutes=Number(previous.timeline.elapsedMinutes || 0)+elapsed;
    const clock = now ?? Number(state.timeline?.elapsedMinutes || 0);
    const sceneChanged = previous.scene?.location !== state.scene?.location;
    const active = new Set(policy.activeCharacters || []), players = new Set(policy.playerIds || []);
    // Decay is based solely on game time and scene transitions, never wall-clock time.
    for (const c of Object.values(sim.characters)) {
        c.emotions = (c.emotions || []).map(e => ({...e, intensity: clamp(e.intensity * (e.decay === 'per_scene' ? (sceneChanged ? 0.5 : 1) : e.decay === 'none' ? 1 : 2 ** (-Math.max(0,elapsed) / e.halfLifeMinutes)))})).filter(e => e.intensity >= 0.01);
        if (c.mood) { const factor = 2 ** (-Math.max(0,elapsed)/1440); c.mood.valence *= factor; c.mood.arousal *= factor; }
        for (const pending of c.pendingProcessing || []) if (pending.status === 'pending' && now !== null && pending.dueMinute <= now) pending.status = 'due';
        c.detail = active.has(c.characterId) ? policy.innerLifeMode : 'background';
    }
    for (const e of list(input.events)) {
        exact(e,['id','kind','summary','participants','visibleTo','significance','status','dueGameTime','condition','effects','evidence']);
        text(e.id); text(e.kind); text(e.summary); number(e.significance);
        if (!author && e.evidence?.source === 'player_assertion') fail('NPC agency: player assertion is not an event');
        list(e.participants).forEach(id => checkCharacter(id)); list(e.visibleTo).forEach(text);
        if (sim.events[e.id]) fail(`event already exists ${e.id}`);
        if (!['occurred','scheduled'].includes(e.status)) fail('invalid event status');
        if (e.status === 'scheduled' && !e.dueGameTime && !e.condition) fail('scheduled event needs a trigger');
        if (e.status === 'occurred' && e.effects) fail('effects only belong to scheduled events');
        if (e.condition) { exact(e.condition,['eventId']); text(e.condition.eventId); }
        if (e.effects) { exact(e.effects,['weather','lighting']); for (const v of Object.values(e.effects)) text(v); }
        sim.events[e.id] = {...clone(e), participants: e.participants || [], visibleTo: e.visibleTo || [],
            gameTime: now === null ? null : gameStamp(now), occurredAt: e.status === 'occurred' ? clock : null,
            ...(e.dueGameTime ? {dueMinute:dueMinute(e.dueGameTime,now)} : {})};
    }
    if (policy.simulationLevel!=='minimal') {
        // Fixed-point iteration allows deterministic chains of conditional events.
        let fired=true;
        while(fired) { fired=false; for (const event of Object.values(sim.events)) {
            if (event.status!=='scheduled') continue;
            const timed=event.dueMinute===undefined || (now!==null && event.dueMinute<=now);
            const condition=!event.condition || sim.events[event.condition.eventId]?.status==='occurred';
            if (timed && condition) {event.status='occurred';event.occurredAt=clock;event.gameTime=now===null?null:gameStamp(now);if(event.effects) Object.assign(state.scene,clone(event.effects));fired=true;}
        }}
        if (now!==null && state.scene.lighting===previous.scene?.lighting) {
            const hour=((now%1440)+1440)%1440/60;
            state.scene.lighting=hour<6||hour>=20?'night':hour<8?'dawn':hour<18?'day':'dusk';
        }
    }
    for (const update of list(input.characters)) {
        exact(update,['characterId','profile','motivation','mood','body','appraisals','emotions','expectations','expressedVsFelt','processing','basis','consistency']);
        const id = update.characterId; checkCharacter(id);
        if (!author && players.has(id)) fail('player agency: internal state is author-controlled');
        if (!author && update.basis === 'player_assertion') fail('NPC agency: player assertion is not evidence');
        if (!author && !['character_appraisal','explicit_expression'].includes(update.basis)) fail('reaction needs an appraisal basis');
        if (!author && update.consistency?.valid !== true) fail('character consistency must be audited');
        if (update.consistency) { exact(update.consistency,['valid','reason']); text(update.consistency.reason); }
        const c = sim.characters[id] ||= {characterId:id, profile:{}, emotions:[], appraisals:[], expectations:[], pendingProcessing:[]};
        const full = policy.innerLifeMode === 'full' && active.has(id), light = policy.innerLifeMode !== 'off' && active.has(id);
        if (update.profile) { if (!author) fail('profile changes require an author correction'); exact(update.profile,['age','traits','formativeExperiences','behaviorTendencies']); if (update.profile.age !== undefined) number(update.profile.age,0,10000); if (update.profile.traits) exact(update.profile.traits,['temperament','values','defenses','attachment']);
            if (update.profile.behaviorTendencies) {exact(update.profile.behaviorTendencies,['likelyTo','unlikelyTo']);Object.values(update.profile.behaviorTendencies).forEach(v=>list(v).forEach(text));}
            list(update.profile.formativeExperiences).forEach(e=>{exact(e,['id','summary','salience']);text(e.id);text(e.summary);number(e.salience);});
            c.profile = clone(update.profile); }
        const appraisals = list(update.appraisals);
        for (const a of appraisals) {
            exact(a,['eventId','meaning','significance','confidence','ambivalence']); cause(sim,a.eventId,id); text(a.meaning); number(a.significance); number(a.confidence); list(a.ambivalence).forEach(text);
            if (!author && a.confidence < (policy.appraisalConfidence ?? 0.5)) fail('appraisal confidence below threshold');
            if (light) c.appraisals = [...c.appraisals.filter(old => old.eventId !== a.eventId), {...clone(a), gameTime: now === null ? null : gameStamp(now)}];
            if (full && a.significance >= policy.significanceThreshold && !c.pendingProcessing.some(p => p.eventId === a.eventId)) {
                if (now === null) fail('significant full reaction requires game date/time');
                const due = dueMinute('next_morning',now);
                c.pendingProcessing.push({eventId:a.eventId,kind:'emotional_aftermath',dueGameTime:gameStamp(due),dueMinute:due,status:'pending'});
            }
        }
        if (update.emotions) c.emotions = list(update.emotions).map(e => {
            exact(e,['type','intensity','causeEventId','toward','decay','halfLifeMinutes']); text(e.type); number(e.intensity); cause(sim,e.causeEventId,id);
            if (!author && !appraisals.some(a => a.eventId === e.causeEventId) && !c.appraisals.some(a => a.eventId === e.causeEventId)) fail('emotion requires a personal appraisal');
            if (e.toward) checkCharacter(e.toward);
            if (!['per_scene','exponential','none'].includes(e.decay)) fail('unknown decay law');
            if (e.decay === 'exponential') number(e.halfLifeMinutes,1,525600);
            return {...clone(e),since:now === null ? null : gameStamp(now)};
        });
        if (update.mood && light) { exact(update.mood,['valence','arousal']); number(update.mood.valence,-1,1); number(update.mood.arousal); c.mood={...clone(update.mood),since:now === null ? null : gameStamp(now)}; }
        if (update.expectations && light) c.expectations=list(update.expectations).map(e => { exact(e,['about','text','strength']); text(e.about);text(e.text);number(e.strength);return clone(e); });
        if (update.motivation && light) { list(update.motivation).forEach(text); c.motivation=clone(update.motivation); }
        if (update.body && full) { exact(update.body,['tension','fatigue','pain']); Object.values(update.body).forEach(v => number(v)); c.body=clone(update.body); }
        if (update.expressedVsFelt && full) { const x=update.expressedVsFelt; exact(x,['expressed','felt','maskingLevel']);list(x.expressed).forEach(text);list(x.felt).forEach(text);number(x.maskingLevel);c.expressedVsFelt=clone(x); c.expressionScene=state.scene.location || null; c.expressionViewers=[...active]; }
        for (const processing of list(update.processing)) {
            exact(processing,['eventId','interpretation']); text(processing.interpretation);
            const p=c.pendingProcessing.find(p => p.eventId===processing.eventId && p.status==='due');
            if (!p || !appraisals.some(a => a.eventId===p.eventId)) fail('processing requires a due item and renewed appraisal');
            p.status='processed';p.interpretation=processing.interpretation;p.processedAt=now === null ? null : gameStamp(now);
        }
        c.detail=active.has(id) ? policy.innerLifeMode : 'background';
        if (!active.has(id)) c.emotions=c.emotions.slice().sort((a,b)=>b.intensity-a.intensity).slice(0,2);
    }
    const used = new Map();
    for (const change of list(input.relationships)) {
        exact(change,['from','to','dimension','delta','eventIds','interpretation','confidence']);
        checkCharacter(change.from);checkCharacter(change.to);text(change.dimension);text(change.interpretation);number(change.confidence);number(change.delta,-1,1);
        if (!author && players.has(change.from)) fail('player relationship is author-controlled');
        const events=[...new Set(list(change.eventIds))].map(id=>cause(sim,id,change.from));
        if (!events.length) fail('relationship requires causal events');
        if (events.some(e=>!e.participants.includes(change.to))) fail('relationship cause must involve its target');
        const significant=events.some(e=>e.significance>=policy.significanceThreshold);
        const repeated=events.length>=policy.repetitionThreshold && events.every(e=>e.kind===events[0].kind && e.participants.includes(change.to));
        if (!author && (change.confidence<policy.relationshipConfidence || (!significant && !repeated))) fail('relationship evidence below threshold');
        const key=JSON.stringify([change.from,change.to]);
        const relation=state.relationships[key] ||= {from:change.from,to:change.to,dimensions:{},history:[],visibleTo:[change.from]};
        if (relation.history.some(h=>h.dimension===change.dimension && h.eventIds?.some(id=>change.eventIds.includes(id)))) fail('relationship evidence already consumed');
        const spent=used.get(key)||0, amount=author ? change.delta : Math.sign(change.delta)*Math.min(Math.abs(change.delta),Math.max(0,policy.relationshipMaxChange-spent));
        used.set(key,spent+Math.abs(amount));
        const old=relation.dimensions[change.dimension]??0.5;
        relation.dimensions[change.dimension]=clamp(old+amount);
        relation.history.push({...clone(change),delta:relation.dimensions[change.dimension]-old,source:metadata.source||'director',gameTime:now===null?null:gameStamp(now)});
    }
    for (const schedule of list(input.schedules)) {
        exact(schedule,['id','characterId','at','activity','location','visibleTo']); text(schedule.id);checkCharacter(schedule.characterId);text(schedule.activity);list(schedule.visibleTo).forEach(text);
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.at)) fail('schedule time must be HH:MM');
        if (schedule.location !== undefined) text(schedule.location);
        sim.schedules[schedule.id]=clone(schedule);
    }
    if (policy.simulationLevel==='living' && now!==null) {
        const minute=((now%1440)+1440)%1440;
        const latest=new Map();
        for (const schedule of Object.values(sim.schedules)) {
            if (players.has(schedule.characterId)) continue;
            const [h,m]=schedule.at.split(':').map(Number), offset=h*60+m;
            const occurrence=now-minute+offset-(offset>minute?1440:0);
            if (!latest.has(schedule.characterId) || latest.get(schedule.characterId).occurrence<occurrence) latest.set(schedule.characterId,{schedule,occurrence});
        }
        for (const [id,{schedule,occurrence}] of latest) state.npc_plans[id]={scheduleId:schedule.id,activity:schedule.activity,location:schedule.location||null,gameTime:gameStamp(occurrence),visibleTo:schedule.visibleTo||[]};
    }
    for (const id of list(input.resolveEvents)) {const event=cause(sim,id);event.resolved=true;}
    if (policy.innerLifeMode==='full' && policy.characterEnabled!==false) for (const id of active) {
        if ((sim.characters[id]?.pendingProcessing || []).some(p=>p.status==='due')) fail(`due emotional processing required for ${id}`);
    }
    state.simulation=sim;
    validateSimulationState(state);
    return state;
}

export function pendingReactions(state, active = []) {
    return Object.fromEntries(Object.entries(state.simulation?.characters || {}).filter(([id])=>active.includes(id)).map(([id,c])=>[id,(c.pendingProcessing||[]).filter(p=>p.status==='due')]));
}


function storedList(value) { if (!Array.isArray(value)) fail('invalid stored list'); return value; }

export function validateSimulationState(state) {
    const sim=state.simulation;
    if (sim===undefined) return;
    assertSafeData(sim);exact(sim,['version','characters','events','schedules']);
    if(sim.version!==1) fail('unsupported simulation version');
    for(const key of ['characters','events','schedules']) if(!sim[key] || typeof sim[key]!=='object' || Array.isArray(sim[key])) fail(`invalid ${key} map`);
    for(const [id,e] of Object.entries(sim.events)) {
        if(e.id!==id || !['occurred','scheduled'].includes(e.status)) fail('invalid stored event');
        text(e.summary);text(e.kind);number(e.significance);list(e.participants).forEach(text);list(e.visibleTo).forEach(text);
        if(e.dueMinute!==undefined) number(e.dueMinute,-10000000000,10000000000);
    }
    for(const [id,c] of Object.entries(sim.characters)) {
        if(c.characterId!==id) fail('character key mismatch');
        for(const e of storedList(c.emotions)) {text(e.type);number(e.intensity);cause(sim,e.causeEventId,id);if(!['none','per_scene','exponential'].includes(e.decay)) fail('invalid stored decay');if(e.decay==='exponential')number(e.halfLifeMinutes,1,525600);}
        for(const a of storedList(c.appraisals)) {cause(sim,a.eventId,id);text(a.meaning);number(a.significance);number(a.confidence);}
        for(const pending of storedList(c.pendingProcessing)) {cause(sim,pending.eventId,id);if(!['pending','due','processed'].includes(pending.status))fail('invalid processing status');number(pending.dueMinute,-10000000000,10000000000);}
        if(c.mood) {number(c.mood.valence,-1,1);number(c.mood.arousal);}
        if(c.body) Object.values(c.body).forEach(v=>number(v));
    }
}
