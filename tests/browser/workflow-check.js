import {bindWorkflowLibrary} from '../../src/ui/visualWorkflows.js';

// Run in the loopback settings preview: real DOM/module, controlled server replies.
export async function runWorkflowCheckBrowserTests() {
    const markup = await (await fetch('/settings.html')).text();
    const host = document.createElement('div');
    host.innerHTML = markup;
    document.body.append(host);
    const controller = new AbortController();
    const requests = [];
    const settings = {visualUserWorkflows: ['a', 'b'].map(id => ({id: 'user-'+id, name:id, recipe:{operation:'illustration'}})), visualEndpoint:'https://example.invalid', visualCheckpoint:'one'};
    const ui = bindWorkflowLibrary(host, settings, (key,value) => {settings[key]=value;ui.render();}, controller.signal,
        () => new Promise((resolve,reject) => requests.push({resolve,reject})));
    const list=host.querySelector('[data-workflow-library]'),button=host.querySelector('[data-workflow-check]'),status=host.querySelector('[data-workflow-notice]');
    const results=[];
    const assert=(value,message)=>{if(!value)throw Error(message);};
    const choose=id=>{list.value='user-'+id;list.dispatchEvent(new Event('change'));};
    const settle=async()=>{await Promise.resolve();await Promise.resolve();};
    const ok={ok:true,errors:[],note:'No job was created.'};
    try {
        ui.render();assert(button.disabled,'No selection must disable check');
        choose('a');button.click();assert(button.disabled,'Pending check must disable button');
        requests[0].resolve(ok);await settle();assert(status.textContent.includes('matches'),'Success missing');assert(!button.disabled,'Button must recover');results.push('success');
        settings.visualCheckpoint='two';ui.render();assert(status.textContent.includes('Settings changed'),'Stale success survived settings edit');results.push('invalidate-success');
        button.click();requests[1].resolve({ok:false,errors:['2.text: missing input'],note:'No job was created.'});await settle();assert(status.dataset.kind==='error'&&status.textContent.includes('2.text'),'Validation details missing');results.push('validation-error');
        button.click();requests[2].reject(Error('offline'));await settle();assert(status.textContent.includes('not verified: offline'),'Offline claimed success');results.push('offline');
        button.click();choose('b');button.click();assert(button.disabled,'Second pending check not disabled');
        requests[3].resolve(ok);await settle();assert(button.disabled,'Old completion unlocked new request');assert(!status.textContent.includes('a: saved graph'),'Old selection overwrote status');
        requests[4].resolve(ok);await settle();assert(status.textContent.startsWith('b:'),'New selection result missing');results.push('overlapping-selections');
        button.click();settings.visualEndpoint='https://changed.invalid';ui.render();assert(button.disabled,'Render unlocked pending request');requests[5].reject(Error('old endpoint offline'));await settle();assert(status.textContent.includes('Settings changed'),'Old endpoint error accepted');results.push('changed-endpoint');
        button.click();requests[6].resolve({ok:true,errors:['contradiction']});await settle();assert(status.textContent.includes('Invalid workflow check response'),'Contradictory success accepted');results.push('malformed-response');
        button.click();controller.abort();const previous=status.textContent;requests[7].resolve(ok);await settle();assert(status.textContent===previous,'Disposed UI was updated');results.push('disposed-ui');
        return {passed:results.length,results,serverRequests:0};
    } finally {controller.abort();host.remove();}
}


export async function runWorkflowCheckSettingsIntegration() {
    const {initUi} = await import('../../src/ui/index.js');
    const host=document.createElement('div');host.innerHTML=await(await fetch('/settings.html')).text();document.body.append(host);
    const ui=initUi({root:host,settings:{visualUserWorkflows:[{id:'user-test',name:'Test',recipe:{operation:'illustration'}}]},actions:{checkVisualWorkflow:async()=>({ok:true,errors:[],note:'No job was created.'})}});
    try {
        const list=host.querySelector('[data-workflow-library]');list.value='user-test';list.dispatchEvent(new Event('change'));
        host.querySelector('[data-workflow-check]').click();await Promise.resolve();await Promise.resolve();
        const status=host.querySelector('[data-workflow-notice]');if(!status.textContent.includes('matches'))throw Error('No success state');
        const endpoint=host.querySelector('[data-setting="visualEndpoint"]');endpoint.value='https://new.invalid';endpoint.dispatchEvent(new Event('change'));
        if(!status.textContent.includes('Settings changed'))throw Error('Real settings handler did not invalidate result');
        return {passed:1,result:'settings-change-invalidates-check'};
    } finally {ui.destroy();host.remove();}
}
