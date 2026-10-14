import {isPromptInput} from '../visual/workflows.js';
/** A read-only view of the actual API graph; only prompt input assignments are editable. */
export function mountWorkflowGraph(container, graph, onAssign) {
    const doc=container.ownerDocument, ns='http://www.w3.org/2000/svg';
    const details=doc.createElement('details');details.className='ne-graph-view';
    const summary=doc.createElement('summary');summary.textContent='View graph and choose prompt inputs';details.append(summary);
    const note=doc.createElement('p');note.className='ne-help';note.textContent='Select a node to inspect its inputs. Connections are read-only; edit the workflow itself in ComfyUI.';details.append(note);
    const viewport=doc.createElement('div');viewport.className='ne-graph-scroll';viewport.tabIndex=0;viewport.setAttribute('aria-label','Workflow graph; scroll to inspect nodes');details.append(viewport);
    const inspector=doc.createElement('div');inspector.className='ne-graph-inspector';inspector.setAttribute('aria-live','polite');details.append(inspector);
    const entries=Object.entries(graph), links=[];
    for(const [target,node] of entries)for(const [input,value] of Object.entries(node.inputs))if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1])&&Object.hasOwn(graph,value[0]))links.push({source:value[0],target,input});
    const depths=new Map();
    function depth(id,trail=new Set()) {
        if(depths.has(id))return depths.get(id);if(trail.has(id))return 0;
        const next=new Set(trail);next.add(id);
        const sources=links.filter(l=>l.target===id).map(l=>l.source);
        const d=Math.min(12,sources.length?1+Math.max(...sources.map(x=>depth(x,next))):0);depths.set(id,d);return d;
    }
    const columns=new Map(), positions=new Map();
    for(const [id] of entries){const col=depth(id),row=columns.get(col)||0;columns.set(col,row+1);positions.set(id,{x:col*220+15,y:row*90+15});}
    const width=(Math.max(...columns.keys())+1)*220+15,height=Math.max(...columns.values())*90+15;
    const svg=doc.createElementNS(ns,'svg');svg.setAttribute('width',String(width));svg.setAttribute('height',String(height));svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','group');svg.setAttribute('aria-label','Nodes and connections from imported workflow');viewport.append(svg);
    for(const link of links){const a=positions.get(link.source),b=positions.get(link.target);const path=doc.createElementNS(ns,'path');path.setAttribute('d',`M ${a.x+190} ${a.y+28} C ${a.x+210} ${a.y+28}, ${b.x-20} ${b.y+28}, ${b.x} ${b.y+28}`);path.classList.add('ne-graph-link');const title=doc.createElementNS(ns,'title');title.textContent=`${link.source} → ${link.target}.${link.input}`;path.append(title);svg.append(path);}
    function show(id) {
        for(const node of svg.querySelectorAll('[data-node]'))node.classList.toggle('is-selected',node.dataset.node===id);
        inspector.replaceChildren();const heading=doc.createElement('strong');heading.textContent=`${id} · ${graph[id].class_type}`;inspector.append(heading);
        for(const [input,value] of Object.entries(graph[id].inputs)){
            const row=doc.createElement('div');row.className='ne-graph-input';const label=doc.createElement('span');label.textContent=`${input}: ${JSON.stringify(value).slice(0,180)}`;row.append(label);
            if(isPromptInput(input,value))for(const [source,text] of [['positive','Use for scene positive'],['negative','Use for scene negative']]){
                const button=doc.createElement('button');button.type='button';button.className='menu_button';button.textContent=text;button.addEventListener('click',()=>onAssign(source,id,input));row.append(button);
            }
            inspector.append(row);
        }
    }
    for(const [id,node] of entries){const p=positions.get(id),g=doc.createElementNS(ns,'g');g.dataset.node=id;g.setAttribute('tabindex','0');g.setAttribute('role','button');g.setAttribute('aria-label',`Inspect ${id} ${node.class_type}`);g.setAttribute('transform',`translate(${p.x},${p.y})`);
        const rect=doc.createElementNS(ns,'rect');rect.setAttribute('width','190');rect.setAttribute('height','58');rect.setAttribute('rx','5');g.append(rect);
        const text=doc.createElementNS(ns,'text');text.setAttribute('x','9');text.setAttribute('y','24');text.textContent=id;g.append(text);
        const name=doc.createElementNS(ns,'text');name.setAttribute('x','9');name.setAttribute('y','44');name.textContent=node.class_type.slice(0,23);g.append(name);
        const title=doc.createElementNS(ns,'title');title.textContent=node.class_type;g.append(title);
        g.addEventListener('click',()=>show(id));g.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();show(id);}});svg.append(g);
    }
    show(entries[0][0]);container.append(details);
}
