import http from 'node:http';
import { access } from 'node:fs/promises';
import { CharacterTokenizer } from '../src/ai/tokenizer.js';
import { NeuralLanguageModel } from '../src/ai/model.js';
import { loadCheckpoint } from '../src/ai/checkpoint.js';
import { generate } from '../src/ai/inference.js';

const HOST=process.env.ASTRA_HOST||'127.0.0.1';
const PORT=Number(process.env.ASTRA_PORT||8787);
const MAX_BODY=16*1024;
const MAX_MESSAGE=4000;
const CHECKPOINT=process.env.ASTRA_CHECKPOINT||'data/checkpoints/astracore-demo.json';
let engine=null;

async function loadEngine(){try{await access(CHECKPOINT);engine=await loadCheckpoint(CHECKPOINT,{Model:NeuralLanguageModel,Tokenizer:CharacterTokenizer})}catch{engine=null}}
function json(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'strict-origin-when-cross-origin'});res.end(JSON.stringify(body))}
function readBody(req){return new Promise((resolve,reject)=>{let size=0,data='';req.on('data',chunk=>{size+=chunk.length;if(size>MAX_BODY){reject(Object.assign(new Error('Request too large'),{status:413}));req.destroy();return}data+=chunk});req.on('end',()=>resolve(data));req.on('error',reject)})}
function capabilities(){return{architecture:'AstraCore task router → own neural language model → approved local tools/models',models:[
{name:'AstraCore Neural Language Core',kind:'language',status:engine?'Ready':'Training required',description:'Self-owned trainable neural language model for chat, reasoning prompts, coding assistance and agent planning.'},
{name:'Code Assistant',kind:'language-tool',status:engine?'Ready through core':'Waiting for core',description:'Coding, debugging, refactoring, explanations and project planning powered by the AstraCore neural core.'},
{name:'Agent Orchestrator',kind:'agent',status:'Local framework',description:'Plans multi-step work and can connect to approved local tools with explicit execution controls.'},
{name:'Image Generator Adapter',kind:'image',status:'Optional local adapter',description:'UI and task contract are ready; connect a local image model before claiming generation.'},
{name:'Video Generator Adapter',kind:'video',status:'Optional local adapter',description:'UI and task contract are ready; connect a local video model before claiming generation.'},
{name:'Audio Generator Adapter',kind:'audio',status:'Optional local adapter',description:'UI and task contract are ready; connect a local audio model before claiming generation.'}
]}}

const server=http.createServer(async(req,res)=>{try{
if(req.method==='GET'&&req.url==='/api/health')return json(res,200,{ok:true,model:engine?'astracore-neural-v0.1-demo':null,ready:Boolean(engine),architecture:'local-first-neural',capabilities:capabilities().models.length});
if(req.method==='GET'&&req.url==='/api/capabilities')return json(res,200,capabilities());
if(req.method!=='POST'||req.url!=='/api/chat')return json(res,404,{error:'Not found'});
if(!engine)return json(res,503,{error:'AstraCore model is not trained yet. Run npm run train:demo.'});
const raw=await readBody(req);let body;try{body=JSON.parse(raw)}catch{return json(res,400,{error:'Invalid JSON'})}
const message=typeof body.message==='string'?body.message.trim():'';if(!message)return json(res,400,{error:'message is required'});if(message.length>MAX_MESSAGE)return json(res,413,{error:'message is too long'});
const result=generate(engine.model,engine.tokenizer,message,{maxNewTokens:Math.min(Number(body.maxNewTokens)||80,160),temperature:Math.min(Math.max(Number(body.temperature)||.8,.1),2),topK:Math.min(Math.max(Number(body.topK)||8,1),32)});
return json(res,200,{response:result.text,conversationId:typeof body.conversationId==='string'?body.conversationId.slice(0,128):null,model:'astracore-neural-v0.1-demo',usage:{inputTokens:engine.tokenizer.encode(message).length,outputTokens:result.tokenIds.length}})
}catch(error){const status=Number(error.status)||500;json(res,status,{error:status===500?'Internal server error':error.message})}});
await loadEngine();server.listen(PORT,HOST,()=>console.log(`AstraCore listening on http://${HOST}:${PORT}`));
