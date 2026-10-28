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
const DEFAULT_CHECKPOINT='data/checkpoints/astracore-demo.json';
const MODEL_KEYS={
  'astracore-neural-a':process.env.ASTRA_MODEL_A_KEY||'',
  'astracore-neural-b':process.env.ASTRA_MODEL_B_KEY||''
};
const MODEL_CONFIG={
  'astracore-neural-a':{name:'AstraCore Neural A',role:'General intelligence',checkpoint:process.env.ASTRA_MODEL_A_CHECKPOINT||DEFAULT_CHECKPOINT},
  'astracore-neural-b':{name:'AstraCore Neural B',role:'Code + reasoning profile',checkpoint:process.env.ASTRA_MODEL_B_CHECKPOINT||DEFAULT_CHECKPOINT}
};
const engines={};

async function loadEngine(id){
  const config=MODEL_CONFIG[id];
  try{await access(config.checkpoint);engines[id]=await loadCheckpoint(config.checkpoint,{Model:NeuralLanguageModel,Tokenizer:CharacterTokenizer})}catch{engines[id]=null}
}
function json(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'strict-origin-when-cross-origin'});res.end(JSON.stringify(body))}
function readBody(req){return new Promise((resolve,reject)=>{let size=0,data='';req.on('data',chunk=>{size+=chunk.length;if(size>MAX_BODY){reject(Object.assign(new Error('Request too large'),{status:413}));req.destroy();return}data+=chunk});req.on('end',()=>resolve(data));req.on('error',reject)})}
function selectedModel(id){return MODEL_CONFIG[id]?id:'astracore-neural-a'}
function authorized(req,id){const configured=MODEL_KEYS[id];if(!configured)return true;const header=req.headers['x-astracore-key'];const bearer=typeof req.headers.authorization==='string'&&req.headers.authorization.startsWith('Bearer ')?req.headers.authorization.slice(7):'';return header===configured||bearer===configured}
function capabilities(){return{architecture:'AstraCore task router → own neural language model → approved local tools/models',models:[
...Object.entries(MODEL_CONFIG).map(([id,m])=>({id,name:m.name,kind:'language',role:m.role,status:engines[id]?'Ready':'Training required',auth:MODEL_KEYS[id]?'Internal AstraCore key required':'Local access enabled',description:'Self-owned AstraCore neural model slot. It uses an AstraCore checkpoint and never calls a commercial AI provider.'})),
{name:'Dual Model Compare',kind:'workspace',status:'Ready',description:'Run the same prompt against AstraCore Neural A and B and inspect the two local responses side by side.'},
{name:'Code Assistant',kind:'language-tool',status:engines['astracore-neural-b']?'Ready through Neural B':'Waiting for Neural B',description:'Coding, debugging, refactoring, explanations and project planning through the AstraCore neural core.'},
{name:'Agent Orchestrator',kind:'agent',status:'Local framework',description:'Plans multi-step work and can connect to approved local tools with explicit execution controls.'},
{name:'Image Generator Adapter',kind:'image',status:'Optional local adapter',description:'UI and task contract are ready; connect a local image model before claiming generation.'},
{name:'Video Generator Adapter',kind:'video',status:'Optional local adapter',description:'UI and task contract are ready; connect a local video model before claiming generation.'},
{name:'Audio Generator Adapter',kind:'audio',status:'Optional local adapter',description:'UI and task contract are ready; connect a local audio model before claiming generation.'}
]}}

const server=http.createServer(async(req,res)=>{try{
if(req.method==='GET'&&req.url==='/api/health')return json(res,200,{ok:true,model:engines['astracore-neural-a']?'astracore-neural-a':null,ready:Boolean(engines['astracore-neural-a']),architecture:'local-first-neural',capabilities:capabilities().models.length});
if(req.method==='GET'&&req.url==='/api/capabilities')return json(res,200,capabilities());
if(req.method!=='POST'||req.url!=='/api/chat')return json(res,404,{error:'Not found'});
const raw=await readBody(req);let body;try{body=JSON.parse(raw)}catch{return json(res,400,{error:'Invalid JSON'})}
const modelId=selectedModel(typeof body.model==='string'?body.model:'astracore-neural-a');
if(!authorized(req,modelId))return json(res,401,{error:'Invalid AstraCore model key'});
const engine=engines[modelId];
if(!engine)return json(res,503,{error:`${MODEL_CONFIG[modelId].name} is not trained or loaded yet. Train or configure its AstraCore checkpoint.`});
const message=typeof body.message==='string'?body.message.trim():'';if(!message)return json(res,400,{error:'message is required'});if(message.length>MAX_MESSAGE)return json(res,413,{error:'message is too long'});
const result=generate(engine.model,engine.tokenizer,message,{maxNewTokens:Math.min(Number(body.maxNewTokens)||80,160),temperature:Math.min(Math.max(Number(body.temperature)||.8,.1),2),topK:Math.min(Math.max(Number(body.topK)||8,1),32)});
return json(res,200,{response:result.text,conversationId:typeof body.conversationId==='string'?body.conversationId.slice(0,128):null,model:modelId,usage:{inputTokens:engine.tokenizer.encode(message).length,outputTokens:result.tokenIds.length}})
}catch(error){const status=Number(error.status)||500;json(res,status,{error:status===500?'Internal server error':error.message})}});

await Promise.all(Object.keys(MODEL_CONFIG).map(loadEngine));
server.listen(PORT,HOST,()=>console.log(`AstraCore listening on http://${HOST}:${PORT}`));
