import fs from 'node:fs';
import { intentRequest, validateIntent } from '../../src/visual/intent.js';
const [url,model,output]=process.argv.slice(2),results=[];
for (const expression of ['brows lowered, eyes narrowed, lips pressed in anger','one eye closed, broad smile','']) {
 const scene={location:{id:'bedroom'},characters:[{id:'wren',pose:'standing',emotion:expression,expressed:[]}]};
 const request=intentRequest(scene,'illustrious'),start=Date.now();
 const response=await fetch(url+'/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,messages:request.messages,max_tokens:request.maxTokens,temperature:0.2,stream:false,reasoning_effort:'none',chat_template_kwargs:{enable_thinking:false}}),signal:AbortSignal.timeout(45000)});
 const body=await response.json();const raw=body.choices?.[0]?.message?.content;
 const row={expression,raw,ms:Date.now()-start};
 try{row.intent=validateIntent(JSON.parse(raw),scene);row.valid=true;}catch(e){row.valid=false;row.error=e.message;}
 results.push(row);fs.writeFileSync(output,JSON.stringify(results,null,2));console.log(JSON.stringify(row));
}
