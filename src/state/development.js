/** Durable behavioral hypotheses; counts describe evidence coverage, not personality scores. */
const fail = text => { throw Error('Simulation: development ' + text); };
const bounded = value => typeof value === 'string' && value.trim() && value.length <= 500;
export function developmentStatus(evidence) {
    const support = new Set(evidence.filter(e=>e.direction==='supports').map(e=>e.turn));
    const counter = new Set(evidence.filter(e=>e.direction==='contradicts').map(e=>e.turn));
    return counter.size ? 'contested' : support.size >= 5 ? 'established' : support.size >= 3 ? 'forming' : 'hypothesis';
}
export function applyDevelopment(character, proposals, events, who, gameTime) {
    if (!Array.isArray(proposals) || proposals.length > 4) fail('accepts at most four proposals per turn');
    const map=character.development ||= {};
    for (const p of proposals) {
        if (!p || Object.keys(p).some(k=>!['id','description','context','eventId','direction','interpretation','confidence'].includes(k))) fail('invalid proposal');
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(p.id) || ['constructor','prototype','__proto__'].includes(p.id)) fail('invalid ID');
        if (![p.description,p.context,p.interpretation].every(bounded)) fail('requires bounded description, context and interpretation');
        if (!['supports','contradicts'].includes(p.direction) || !Number.isFinite(p.confidence) || p.confidence<0.7 || p.confidence>1) fail('insufficient or invalid evidence');
        const event=events[p.eventId];
        if (!event || event.status!=='occurred' || !(event.visibleTo.includes('*') || event.visibleTo.includes(who))) fail('cause must be known to recipient');
        if (!event.sourceTurn) fail('cause requires recorded turn provenance');
        if (!(character.appraisals || []).some(a=>a.eventId===p.eventId && a.confidence>=0.7)) fail('requires personal appraisal');
        let entry=map[p.id];
        if(!entry) {
            if(Object.keys(map).length>=12) fail('at most twelve tendencies per character');
            entry=map[p.id]={id:p.id,description:p.description,context:p.context,evidence:[],status:'hypothesis'};
        }
        if(entry.description!==p.description || entry.context!==p.context) fail('reuse the original description and context');
        if(entry.evidence.some(e=>e.eventId===p.eventId)) fail('event already counted for this tendency');
        if(entry.evidence.length>=40) fail('evidence limit reached; author review required');
        entry.evidence.push({eventId:p.eventId,turn:event.sourceTurn,direction:p.direction,interpretation:p.interpretation,confidence:p.confidence,gameTime});
        entry.status=developmentStatus(entry.evidence);
    }
}
export function validateDevelopment(character, events, who) {
    if(character.development===undefined)return;
    if(!character.development || Array.isArray(character.development) || typeof character.development!=='object' || Object.keys(character.development).length>12)fail('invalid stored tendencies');
    for(const [id,d] of Object.entries(character.development)) {
        if(d.id!==id || !bounded(d.description) || !bounded(d.context) || !Array.isArray(d.evidence) || !d.evidence.length || d.evidence.length>40)fail('invalid stored tendency');
        const seen=new Set();
        for(const e of d.evidence) {
            const event=events[e.eventId];
            if(!event || event.status!=='occurred' || !(event.visibleTo.includes('*') || event.visibleTo.includes(who)) || !event.sourceTurn || e.turn!==event.sourceTurn || seen.has(e.eventId))fail('invalid stored cause');
            if(!['supports','contradicts'].includes(e.direction) || !bounded(e.interpretation) || !Number.isFinite(e.confidence) || e.confidence<0.7 || e.confidence>1)fail('invalid stored evidence');
            seen.add(e.eventId);
        }
        if(d.status!==developmentStatus(d.evidence))fail('invalid stored status');
    }
}
