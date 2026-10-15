import { mountWorkflowGraph } from './visualWorkflowGraph.js';
import { readWorkflowFile, validateUserRecipe, saveUserWorkflow, WORKFLOW_SETTINGS, RECIPE_LIMIT, isPromptInput } from '../visual/workflows.js';

export function bindWorkflowLibrary(panel, settings, commit, signal, checkWorkflow) {
    const doc = panel.ownerDocument;
    const picker = panel.querySelector('[data-workflow-file]');
    const list = panel.querySelector('[data-workflow-library]');
    const status = panel.querySelector('[data-workflow-notice]');
    if (!picker || !list) return {render() {}};
    let dialog;
    let checkRevision = 0, pendingCheck = 0, checkedSnapshot = null;
    const selectionSnapshot = () => JSON.stringify([settings.visualUserWorkflows?.find(row => row.id === list.value), settings.visualEndpoint, settings.visualCheckpoint]);
    const notice = (text, error=false) => {status.textContent=text;status.dataset.kind=error?'error':'info';};
    const option = (value, label) => {const o=doc.createElement('option');o.value=value;o.textContent=label;return o;};
    const render = () => {
        const selected=list.value;
        list.replaceChildren(option('','Choose an imported workflow'));
        for(const item of settings.visualUserWorkflows || []) list.append(option(item.id,`${item.name} · ${item.recipe.operation}`));
        list.value=selected;
        for(const button of panel.querySelectorAll('[data-workflow-edit],[data-workflow-export],[data-workflow-remove],[data-workflow-check]')) button.disabled=!list.value;
        const checkButton = panel.querySelector('[data-workflow-check]');
        if (checkButton) checkButton.disabled = !list.value || pendingCheck === checkRevision && pendingCheck !== 0;
        if (checkedSnapshot !== null && checkedSnapshot !== selectionSnapshot()) {
            checkedSnapshot = null; notice('Settings changed. Check this workflow again.');
        }
        const suggestions=panel.querySelector('#ne-user-workflows');
        suggestions?.replaceChildren(...['scene_full','scene_integrated','background','background_integrated','sprite_integrated','scene_anima','background_anima','sprite_anima'].map(id=>option(id,id)), ...(settings.visualUserWorkflows || []).map(item=>option(item.id,item.name)));
    };
    const download = (name,value) => {
        const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
        const a=doc.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    panel.querySelector('[data-anima-preset]')?.addEventListener('click',()=>{
        commit('visualWorkflow','scene_anima');commit('visualBackgroundWorkflow','background_anima');commit('visualSpriteWorkflow','sprite_anima');
        if(!settings.visualTextEncoder)commit('visualTextEncoder','qwen_3_06b_base.safetensors');
        if(!settings.visualVae)commit('visualVae','qwen_image_vae.safetensors');
        notice('Anima workflows selected. Choose your diffusion model filename and matching Base, Aesthetic or Turbo variant. Generation was not started.');
    },{signal});
    panel.querySelector('[data-workflow-import]').addEventListener('click',()=>picker.click(),{signal});
    list.addEventListener('change',render,{signal});
    panel.querySelector('[data-workflow-edit]').addEventListener('click',()=>{
        const item=settings.visualUserWorkflows?.find(x=>x.id===list.value);
        if(item) openImport({graph:item.recipe.workflow,recipe:structuredClone(item.recipe)},item.name,item.id);
    },{signal});
    list.addEventListener('change', () => {checkRevision++; checkedSnapshot = null; render(); notice('Selection changed. Check this workflow separately.');}, {signal});
    panel.querySelector('[data-workflow-check]').addEventListener('click', async (event) => {
        const item = settings.visualUserWorkflows?.find(row => row.id === list.value);
        if (!item) return;
        if (typeof checkWorkflow !== 'function') return notice('Workflow checking is unavailable in this preview.', true);
        const revision = ++checkRevision;
        pendingCheck = revision;
        checkedSnapshot = null;
        const snapshot = JSON.stringify([item, settings.visualEndpoint, settings.visualCheckpoint]);
        const button = event.currentTarget;
        button.disabled = true;
        notice('Reading ComfyUI node and model inventory. No generation will be started.');
        try {
            const result = await checkWorkflow(structuredClone(item));
            if (signal.aborted || revision !== checkRevision) return;
            const current = settings.visualUserWorkflows?.find(row => row.id === list.value);
            if (snapshot !== JSON.stringify([current, settings.visualEndpoint, settings.visualCheckpoint])) {
                notice('Settings changed during the check. Check the workflow again.'); return;
            }
            if (typeof result?.ok !== 'boolean' || !Array.isArray(result.errors) || result.errors.some(error => typeof error !== 'string') || result.ok !== (result.errors.length === 0)) throw Error('Invalid workflow check response.');
            checkedSnapshot = snapshot;
            notice(`${item.name}: ${result.ok ? 'saved graph matches the server inventory.' : result.errors.join('; ')} ${result.note || ''}`, !result.ok);
        } catch (error) {
            if (!signal.aborted && revision === checkRevision) {
                if (snapshot !== selectionSnapshot()) notice('Settings changed during the check. Check the workflow again.');
                else notice(`Workflow was not verified: ${error.message}`, true);
            }
        } finally {
            if (pendingCheck === revision) pendingCheck = 0;
            if (!signal.aborted) render();
        }
    }, {signal});
    panel.querySelector('[data-workflow-export]').addEventListener('click',()=>{
        const item=settings.visualUserWorkflows?.find(x=>x.id===list.value);
        if(item) {download(item.id+'.json',item.recipe);notice('Generation preset exported. It contains workflow parameters, not model files.');}
    },{signal});
    panel.querySelector('[data-workflow-remove]').addEventListener('click',()=>{
        const id=list.value;
        if(WORKFLOW_SETTINGS.some(key=>settings[key]===id)) return notice('This workflow is in use. Choose a replacement in the image settings before removing it.',true);
        commit('visualUserWorkflows',(settings.visualUserWorkflows || []).filter(x=>x.id!==id));
        render();notice('Workflow removed from settings. Generated images are unchanged.');
    },{signal});
    picker.addEventListener('change',async()=>{
        const file=picker.files?.[0];if(!file)return;
        try {
            if(file.size>RECIPE_LIMIT)throw Error('Workflow file exceeds 128 KiB.');
            const parsed=readWorkflowFile(await file.text());
            if(signal.aborted)return;
            openImport(parsed,file.name);
        } catch(error) {notice(error.message,true);} finally {picker.value='';}
    },{signal});
    function openImport({graph,recipe},filename,existingId=null) {
        dialog?.remove();dialog=doc.createElement('dialog');dialog.className='ne-workflow-dialog';
        dialog.setAttribute('aria-labelledby','ne-import-title');
        dialog.innerHTML=`<form><h3 id="ne-import-title">Import workflow</h3><p>Map the scene inputs, then save. Importing does not connect to ComfyUI or generate an image.</p><label class="ne-field">Name<input name="name" maxlength="80" required></label><label class="ne-field">Image type<select name="operation"><option value="illustration">Illustration</option><option value="background">Background</option><option value="sprite">Transparent sprite</option></select></label><div data-bindings></div><label class="ne-check"><input name="assign" type="checkbox" checked>Use for this image type after import</label><p class="ne-help">Sprites must produce transparent PNGs. Availability of models and nodes is checked on the server before generation. Imported graphs must come from a source you trust.</p><p role="status" data-error></p><div class="ne-action-list"><button type="button" data-cancel class="menu_button">Cancel</button><button type="submit" class="menu_button">Save workflow</button></div></form>`;
        const form=dialog.querySelector('form');form.elements.name.value=filename.replace(/\.json$/i,'');
        if(recipe?.operation) form.elements.operation.value=recipe.operation;
        if(existingId){form.elements.operation.disabled=true;dialog.querySelector('h3').textContent='Edit workflow inputs';}
        const fields=dialog.querySelector('[data-bindings]');
        const mapping = [['positive','Scene prompt (required)','string'],['negative','Negative prompt','string'],['seed','Seed','number'],['checkpoint','Checkpoint filename','string'],['output','Image output node','output'],['lora','Character LoRA node (optional)','lora']];
        if(recipe) {
            const summary=doc.createElement('p');summary.textContent=`Generation preset includes ${recipe.bindings?.length || 0} bindings. Prompt inputs and templates can be edited below; other bindings, stages and LoRA slots are retained.`;fields.append(summary);
        } else for(const [key,label,type] of mapping) {
            const wrapper=doc.createElement('label');wrapper.className='ne-field';wrapper.append(doc.createTextNode(label));
            const select=doc.createElement('select');select.name=key;select.required=['positive','output'].includes(key);
            select.append(option('',type==='output'?'Choose the final image node':key==='positive'?'Choose the scene text input':'Leave unchanged / not bound'));
            for(const [id,node] of Object.entries(graph)) {
                if(type==='lora') { if(node.class_type === 'LoraLoader')select.append(option(id,`${id} · ${node.class_type}`)); }
                else if(type==='output') select.append(option(id,`${id} · ${node.class_type}`));
                else for(const [input,value] of Object.entries(node.inputs)) if(typeof value===type && (!['positive','negative'].includes(key) || isPromptInput(input,value))) select.append(option(JSON.stringify([id,input]),`${id} · ${node.class_type} · ${input}`));
            }
            wrapper.append(select);fields.append(wrapper);
        }
        const templates = new Map();
        function templateEditor(source, binding, index) {
            const block=doc.createElement('div');block.className='ne-prompt-template';
            const label=doc.createElement('label');label.className='ne-field';
            label.textContent=`${source === 'positive' ? 'Positive' : 'Negative'} input template${binding ? ' · '+binding.node+'.'+binding.input : ''}`;
            const area=doc.createElement('textarea');area.rows=3;area.maxLength=4000;
            area.value=binding?.template ?? `{{${source}}}\n{{${source === 'positive' ? 'userPositive' : 'userNegative'}}}`;
            label.append(area);block.append(label);
            const chips=doc.createElement('div');chips.className='ne-prompt-chips';chips.setAttribute('aria-label','Insert prompt source');
            for(const [token,title] of [['positive','Scene positive'],['negative','Scene negative'],['userPositive','My positive'],['userNegative','My negative']]){
                const button=doc.createElement('button');button.type='button';button.className='ne-prompt-chip';button.textContent=title;
                button.addEventListener('click',()=>{const start=area.selectionStart,end=area.selectionEnd;area.setRangeText('{{'+token+'}}',start,end,'end');area.dispatchEvent(new Event('input',{bubbles:true}));area.focus();},{signal});chips.append(button);
            }
            block.append(chips);
            const preview=doc.createElement('pre');preview.className='ne-prompt-preview';preview.setAttribute('aria-label','Template preview');block.append(preview);
            const update=()=>{preview.textContent=area.value.replace(/\{\{([^{}]+)\}\}/g,(_,token)=>({positive:'[Compiled scene description]',negative:'[Compiled scene exclusions]',userPositive:settings.visualPositive || '[My positive is empty]',userNegative:settings.visualNegative || '[My negative is empty]'}[token] || '[Unknown source: '+token+']'));};
            area.addEventListener('input',update,{signal});update();fields.append(block);templates.set(index,{source,binding,area});
        }
        if(recipe) (recipe.bindings || []).forEach((binding,index)=>{if(['positive','negative'].includes(binding.source))templateEditor(binding.source,binding,index);});
        else {templateEditor('positive',null,'positive');templateEditor('negative',null,'negative');}
        mountWorkflowGraph(fields,graph,(source,node,input)=>{
            if(recipe) {
                const editor=[...templates.values()].find(e=>e.source===source);
                if(!editor) {dialog.querySelector('[data-error]').textContent='This generation preset has no '+source+' binding. Import the API graph to add one.';return;}
                editor.binding={...editor.binding,node,input};
                editor.area.closest('label').firstChild.textContent=`${source} input template · ${node}.${input}`;
                editor.area.focus();
            } else {form.elements[source].value=JSON.stringify([node,input]);form.elements[source].focus();}
            dialog.querySelector('[data-error]').textContent=`Assigned ${source} to ${node}.${input}.`;
        });
        form.addEventListener('submit',event=>{
            event.preventDefault();
            try {
                let next=recipe?structuredClone(recipe):{version:1,workflow:graph,bindings:[],loraSlots:[]};
                next.operation=form.elements.operation.value;
                if(!recipe) {
                    next.outputNode=form.elements.output.value;
                    next.loraSlots=form.elements.lora.value?[form.elements.lora.value]:[];
                    for(const key of ['positive','negative','seed','checkpoint']) {
                        const value=form.elements[key].value;if(!value)continue;
                        const [node,input]=JSON.parse(value);
                        if(key==='checkpoint')next.checkpointBinding={node,input};else next.bindings.push({node,input,source:key});
                    }
                }
                if(recipe) {
                    for(const [index,editor] of templates) next.bindings[index]={...editor.binding,template:editor.area.value};
                } else {
                    for(const b of next.bindings) if(templates.has(b.source)) b.template=templates.get(b.source).area.value;
                }
                next=validateUserRecipe(next);
                const id=existingId || 'user-'+crypto.randomUUID();
                commit('visualUserWorkflows',saveUserWorkflow(settings,{id,name:form.elements.name.value,recipe:next}));
                if(form.elements.assign.checked)commit({illustration:'visualWorkflow',background:'visualBackgroundWorkflow',sprite:'visualSpriteWorkflow'}[next.operation],id);
                render();list.value=id;render();
                notice(`Saved ${form.elements.name.value}. File structure checked; models and nodes have not been checked on ComfyUI.`);
                dialog.close();
            }catch(error){dialog.querySelector('[data-error]').textContent=error.message;}
        },{signal});
        dialog.querySelector('[data-cancel]').addEventListener('click',()=>dialog.close(),{signal});
        dialog.addEventListener('close',()=>{dialog.remove();panel.querySelector('[data-workflow-import]')?.focus();},{once:true});
        panel.append(dialog);dialog.showModal();form.elements.name.focus();
    }
    signal.addEventListener('abort',()=>dialog?.remove(),{once:true});
    render();return {render};
}
