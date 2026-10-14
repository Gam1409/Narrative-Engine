'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const page=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Narrative Engine settings · local preview</title>
<link rel="stylesheet" href="/style.css"><style>:root{color-scheme:dark;--SmartThemeBodyColor:#e5e7eb;--SmartThemeBorderColor:#495261;--SmartThemeBlurTintColor:#222833;--SmartThemeQuoteColor:#8db6ec}body{margin:0;background:#151920;color:#e5e7eb;font:15px/1.45 system-ui}main{max-width:720px;margin:24px auto;padding:0 16px}input,select,textarea,button{font:inherit;color:inherit}input:not([type=checkbox]),select,textarea{box-sizing:border-box;background:#171d26;border:1px solid #566174;border-radius:5px;padding:8px;width:100%}button{background:#303b4a;border:1px solid #566174;border-radius:5px;padding:8px 12px;cursor:pointer}button:disabled{opacity:.5}summary{cursor:pointer}small{color:#b7c2d2}[hidden]{display:none!important}</style>
<main><p>Local preview · no SillyTavern, LLM or GPU connections</p><div id="mount"></div></main>
<script type="module">import{initUi}from'/src/ui/index.js';
document.querySelector('#mount').innerHTML=await(await fetch('/settings.html')).text();
const saved=JSON.parse(localStorage.getItem('ne-preview-settings')||'{}');
window.preview=initUi({settings:saved,onSettingsChange:s=>localStorage.setItem('ne-preview-settings',JSON.stringify(s)),actions:{visualCapabilities:async()=>{throw Error('Offline preview: ComfyUI is not contacted.');}}});
const section=[...document.querySelectorAll('details')].find(e=>e.querySelector(':scope > summary')?.textContent.includes('Visual Director'));if(section){section.open=true;section.scrollIntoView();}
</script></html>`;
http.createServer((req,res)=>{const url=new URL(req.url,'http://local');if(url.pathname==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(page);}const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+path.sep)||!['.js','.css','.html','.json'].includes(path.extname(file))){res.writeHead(404);return res.end();}try{const body=fs.readFileSync(file);res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'})[path.extname(file)]+'; charset=utf-8');res.end(body);}catch{res.writeHead(404);res.end();}}).listen(8848,'127.0.0.1',()=>console.log('Local settings preview: http://127.0.0.1:8848'));
