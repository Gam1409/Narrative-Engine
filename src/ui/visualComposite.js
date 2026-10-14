import {planCompositeLayout} from '../visual/layout.js';
const validUrl = url => /^\/api\/plugins\/narrative-engine\/visual\/asset\/[A-Za-z0-9%_.-]+\/[A-Za-z0-9-]+$/.test(url || '');
export async function renderComposite(sources,camera,doc=document) {
    const images=await Promise.all(sources.map(layer=>new Promise((resolve,reject)=>{
        if(!validUrl(layer.url)) return reject(Error('Invalid layer asset URL'));
        const image=doc.createElement('img');
        const timer=setTimeout(()=>{image.src='';reject(Error('Layer image loading timed out'));},15000);
        image.onload=()=>{clearTimeout(timer);resolve(image);};
        image.onerror=()=>{clearTimeout(timer);reject(Error(`Could not load layer: ${layer.slot}`));};
        image.src=layer.url;
    })));
    const background=images[0];
    const layout=planCompositeLayout({width:background.naturalWidth,height:background.naturalHeight,camera,
        characters:sources.slice(1).map((layer,index)=>({id:layer.characterId,width:images[index+1].naturalWidth,height:images[index+1].naturalHeight}))});
    const canvas=doc.createElement('canvas');canvas.width=layout.width;canvas.height=layout.height;
    canvas.className='ne-composite-canvas';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Layer composition preview; lighting and perspective are not refined');
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas is unavailable');
    ctx.drawImage(background,0,0,layout.width,layout.height);
    layout.slots.forEach((slot,index)=>ctx.drawImage(images[index+1],slot.x,slot.y,slot.width,slot.height));
    return {canvas,layout};
}
