import {initUi, settingChangePatch} from '../../src/ui/index.js';

// Loopback preview only; real controls with a local runtime substitute.
export async function runSettingsFeedbackTests() {
    const host = document.createElement('div');
    host.innerHTML = await (await fetch('/settings.html')).text();
    document.body.append(host);
    let live = {enabled:true,model:'old',promptVariants:{continuity:'strict',knowledge:'strict'}};
    const calls = [];
    const ui = initUi({root:host,settings:live,
        onSettingsChange: (_next,{path,value}) => {live={...live,...settingChangePatch(live,path,value)};ui.updateSettings(live);},
        actions:{loreRequest:async(path,body)=>{
            calls.push({path,body});
            if(path==='preview')return {revision:1,generation:4,entries:[],report:{adapter:'test',total:0,unsupported:[]}};
            if(path==='import')return {revision:2,generation:4,report:{public:0,hidden:0}};
            throw Error('Unexpected request');
        }},
    });
    const assert=(value,message)=>{if(!value)throw Error(message);};
    const change=(path,value)=>{const control=host.querySelector(`[data-setting="${path}"]`);control.value=value;control.dispatchEvent(new Event('change'));};
    try {
        // Even before a diagnostic refresh, an unrelated change must not undo OFF.
        live={...live,enabled:false,model:'external-model',promptVariants:{continuity:'strict',knowledge:'light'}};
        change('memoryTopK','9');
        assert(!live.enabled && live.model==='external-model','Stale UI overwrote external changes');
        assert(!host.querySelector('[data-setting="enabled"]').checked,'UI did not reflect external OFF');
        change('promptVariants.continuity','balanced');
        assert(live.promptVariants.knowledge==='light','Nested update reverted live sibling');
        live={...live,enabled:true};ui.updateSettings(live);
        assert(host.querySelector('[data-setting="enabled"]').checked,'External ON not reflected');
        const file=host.querySelector('[data-lore-file]'),transfer=new DataTransfer();
        transfer.items.add(new File(['{}'],'lore.json',{type:'application/json'}));file.files=transfer.files;
        file.dispatchEvent(new Event('change'));
        for(let i=0;i<40 && host.querySelector('[data-lore-save]').disabled;i++)await new Promise(resolve=>setTimeout(resolve,10));
        assert(!host.querySelector('[data-lore-save]').disabled,'Preview did not finish');
        host.querySelector('[data-lore-save]').click();await Promise.resolve();
        const imported=calls.find(call=>call.path==='import');
        assert(imported?.body.expectedGeneration===4 && imported.body.expectedRevision===1,'Lore CAS tokens lost between preview and import');
        return {passed:4,checks:['external-disable-preserved','nested-sibling-preserved','external-state-rendered','lore-generation-forwarded'],serverRequests:0};
    } finally {ui.destroy();host.remove();}
}
