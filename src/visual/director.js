import { describeScene, visualProfile } from './scene.js';
import { canonicalStringify } from '../utils/object.js';
import { textHash } from '../memory/semantic.js';
import { getContext, getChatFingerprint } from '../context/stContext.js';

export class VisualDirector {
    constructor(runtime,{fetchImpl=globalThis.fetch}={}) {this.runtime=runtime;this.fetch=fetchImpl;this.closed=false;this.lastScene=null;this.waiters=new Map();}
    key(){return `${this.runtime.stateManager.prefix}:visual-profiles`;}
    async profiles(){return await this.runtime.storage.getItem(this.key()) || {};}
    async setProfile(value) {
        const profile=visualProfile(value),runtime=this.runtime,state=runtime.stateManager.snapshot();
        if (!state.entities?.[profile.entityId] && !state.characters?.[profile.entityId] && !runtime.participants.some(p=>p.name===profile.entityId))throw new Error('Profile must refer to an existing entity or participant');
        const key=this.key(),storage=runtime.storage,profiles=await this.profiles();profiles[profile.entityId]=profile;await storage.setItem(key,profiles);runtime.spriteManifests.visualProfiles=profiles;return profile;
    }
    async scene(){const runtime=this.runtime,tail=runtime.stateManager.deltas.findLast(d=>d.source!=='author'&&d.messageIndex>=0);return describeScene(runtime.stateManager.snapshot(),runtime.participants,await this.profiles(),this.lastScene,tail?.messageRef || null);}
    async api(path,body) {
        const response=await this.fetch(`/api/plugins/narrative-engine/visual/${path}`,{method:body?'POST':'GET',headers:{...getContext().getRequestHeaders?.(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new Error(`Visual service returned HTTP ${response.status}`);return response.json();
    }
    matches(job,scene) { const key=job.scene.messageRef?.idempotencyKey;return scene.sceneId===job.scene.sceneId && (!key || this.runtime.stateManager.deltas.some(d=>d.idempotencyKey===key)); }
    async request({automatic=false}={}) {
        const runtime=this.runtime,context=getContext(),fingerprint=getChatFingerprint(context),manager=runtime.stateManager;
        if(!runtime.settings.visualEnabled)return {skipped:'Visual generation is disabled'};
        if(manager.pending.length)return {skipped:'World state is pending reconciliation'};
        const scene=await this.scene();
        if(this.closed || manager!==runtime.stateManager || getChatFingerprint(getContext())!==fingerprint)return {skipped:'Scene changed'};
        const settings=runtime.settings;
        const history=await this.api(`jobs/${fingerprint}`);
        const prior=history.find(j=>j.status==='done' && j.scene.location.id===scene.location.id);
        if(automatic && history.some(j=>this.matches(j,scene)))return {skipped:'Scene already requested'};
        scene.changesSincePrevious=['location','characters','keyObjects'].filter(k=>canonicalStringify(scene[k])!==canonicalStringify(prior?.scene?.[k]));
        const seed=settings.visualKeepSeed && prior ? prior.seed : crypto.getRandomValues(new Uint32Array(1))[0];
        const workflow=settings.visualPartial && prior ? settings.visualPartialWorkflow : settings.visualWorkflow;
        if(!workflow)throw new Error('Choose a configured visual workflow');
        const requestKey=automatic ? await textHash(JSON.stringify([scene.sceneId,scene.messageRef,workflow])) : crypto.randomUUID();
        if(this.closed || manager!==runtime.stateManager || getChatFingerprint(getContext())!==fingerprint)return {skipped:'Scene changed'};
        const job=await this.api('jobs',{chatId:fingerprint,requestKey,workflow,scene,seed,stages:settings.visualStages,previous:prior?.outputs?.[0] || null});
        this.lastScene=scene;
        if(this.closed || manager!==runtime.stateManager || getChatFingerprint(getContext())!==fingerprint)return job;
        this.follow(job,context,fingerprint,manager).catch(error=>runtime.diagnostics.error(error,'visual'));
        return job;
    }
    async follow(job,context,fingerprint,manager) {
        const runtime=this.runtime;
        for(let n=0;n<600;n++) {
            if(this.closed || manager!==runtime.stateManager || getChatFingerprint(getContext())!==fingerprint)return;
            if(['done','failed_final'].includes(job.status)) {
                const current=await this.scene();
                if(this.closed || manager!==runtime.stateManager || getChatFingerprint(getContext())!==fingerprint)return;
                const stale=!this.matches(job,current);
                const result={...job,stale,images:job.status==='done' ? job.outputs.map((_,i)=>`/api/plugins/narrative-engine/visual/image/${encodeURIComponent(fingerprint)}/${encodeURIComponent(job.id)}/${i}`) : []};
                context.chatMetadata.narrative_engine_visual=result;await context.saveMetadata?.();return;
            }
            await new Promise(resolve=>{const timer=setTimeout(()=>{this.waiters.delete(timer);resolve();},2000);timer.unref?.();this.waiters.set(timer,resolve);});
            if(this.closed)return;
            job=await this.api(`jobs/${fingerprint}/${job.id}`);
        }
    }
    async jobs(){const fingerprint=this.runtime.stateManager.chatFingerprint,scene=await this.scene(),jobs=await this.api(`jobs/${fingerprint}`);return jobs.map(job=>({...job,stale:!this.matches(job,scene),images:job.status==='done'?job.outputs.map((_,i)=>`/api/plugins/narrative-engine/visual/image/${encodeURIComponent(fingerprint)}/${encodeURIComponent(job.id)}/${i}`):[]}));}
    async resume(){const runtime=this.runtime,context=getContext(),manager=runtime.stateManager,fingerprint=manager.chatFingerprint;const jobs=await this.jobs();if(jobs[0]&&!this.closed)this.follow(jobs[0],context,fingerprint,manager).catch(error=>runtime.diagnostics.error(error,'visual'));}
    close(){this.closed=true;for(const [timer,wake] of this.waiters){clearTimeout(timer);wake();}this.waiters.clear();}
}
