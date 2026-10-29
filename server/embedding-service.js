import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE=dirname(fileURLToPath(import.meta.url));
const SCRIPT=join(HERE,'..','scripts','embed_text.py');
const CHECKPOINT=process.env.ASTRACORE_EMBED_CHECKPOINT||join(HERE,'..','data','checkpoints','astracore-embed-v0.1');
export function createEmbeddingService(){return async function embed(texts){const input=Array.isArray(texts)?texts.map(String):[];if(!input.length)return [];return new Promise(resolve=>{const exe=process.platform==='win32'?'python':'python3';const child=spawn(exe,[SCRIPT],{stdio:['pipe','pipe','ignore'],windowsHide:true});let out='';let done=false;const timer=setTimeout(()=>{child.kill('SIGKILL');if(!done){done=true;resolve(null)}},30000);child.stdout.on('data',c=>{out+=c.toString()});child.on('error',()=>{clearTimeout(timer);if(!done){done=true;resolve(null)}});child.on('close',code=>{clearTimeout(timer);if(done)return;done=true;try{const r=JSON.parse(out);resolve(code===0&&r.ok?r.embeddings:null)}catch{resolve(null)}});child.stdin.end(JSON.stringify({checkpoint:CHECKPOINT,texts:input}))})}}
