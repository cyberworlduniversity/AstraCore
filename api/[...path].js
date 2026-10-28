import { access } from 'node:fs/promises';
import { CharacterTokenizer } from '../src/ai/tokenizer.js';
import { NeuralLanguageModel } from '../src/ai/model.js';
import { loadCheckpoint } from '../src/ai/checkpoint.js';
import { generate } from '../src/ai/inference.js';
import { currentUser,isAdmin,signup,login,oauthStart,validateOAuthState,oauthCallback,listUsers,sessionCookie,clearSessionCookie,ADMIN_EMAIL } from '../server/auth.js';

const MAX_BODY=16*1024;
const MAX_MESSAGE=4000;
const DEFAULT_CHECKPOINT='data/checkpoints/astracore-demo.json';
const MODEL_KEYS={'astracore-neural-a':process.env.ASTRA_MODEL_A_KEY||'','astracore-neural-b':process.env.ASTRA_MODEL_B_KEY||''};
const MODEL_CONFIG={'astracore-neural-a':{name:'AstraCore Neural A',role:'General intelligence',checkpoint:process.env.ASTRA_MODEL_A_CHECKPOINT||DEFAULT_CHECKPOINT},'astracore-neural-b':{name:'AstraCore Neural B',role:'Code + reasoning profile',checkpoint:process.env.ASTRA_MODEL_B_CHECKPOINT||DEFAULT_CHECKPOINT}};
const engines={};
let enginesLoaded=false;
async function ensureEngines(){if(enginesLoaded)return;enginesLoaded=true;await Promise.all(Object.entries(MODEL_CONFIG).map(async([id,config])=>{try{await access(config.checkpoint);engines[id]=await loadCheckpoint(config.checkpoint,{Model:NeuralLanguageModel,Tokenizer:CharacterTokenizer})}catch{engines[id]=null}}))}
function json(res,status,body,headers={}){res.statusCode=status;for(const [k,v] of Object.entries({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'strict-origin-when-cross-origin',...headers}))res.setHeader(k,v);res.end(JSON.stringify(body))}
function redirect(res,url,cookie=''){res.statusCode=302;res.setHeader('location',url);res.setHeader('cache-control','no-store');if(cookie)res.setHeader('set-cookie',cookie);res.end()}
async function readBody(req){return new Promise((resolve,reject)=>{let size=0,data='';req.on('data',chunk=>{size+=chunk.length;if(size>MAX_BODY){reject(Object.assign(new Error('Request too large'),{status:413}));req.destroy();return}data+=chunk});req.on('end',()=>resolve(data));req.on('error',reject)})}
function selectedModel(id){return MODEL_CONFIG[id]?id:'astracore-neural-a'}
function authorized(req,id){const configured=MODEL_KEYS[id];if(!configured)return true;const header=req.headers['x-astracore-key'];const bearer=typeof req.headers.authorization==='string'&&req.headers.authorization.startsWith('Bearer ')?req.headers.authorization.slice(7):'';return header===configured||bearer===configured}
function publicCapabilities(){return{architecture:'AstraCore local-first neural workspace',features:['chat','agents','coding','creative adapters','automation']}}
function adminModelDetails(){return Object.entries(MODEL_CONFIG).map(([id,m])=>({id,name:m.name,role:m.role,checkpoint:m.checkpoint,status:engines[id]?'Ready':'Training required',keyConfigured:Boolean(MODEL_KEYS[id])}))}
async function requireAdmin(req,res){const user=await currentUser(req);if(!isAdmin(user)){json(res,403,{error:'Admin access required'});return null}return user}
async function requireUser(req,res){const user=await currentUser(req);if(!user){json(res,401,{error:'Login required'});return null}return user}

export default async function handler(req,res){try{
 await ensureEngines();
 const url=new URL(req.url,`https://${req.headers.host||'astracore-ai.vercel.app'}`);
 if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,ready:Boolean(engines['astracore-neural-a']),model:'AstraCore neural core',architecture:'local-first-neural'});
 if(req.method==='GET'&&url.pathname==='/api/auth/me'){const user=await currentUser(req);return json(res,200,{authenticated:Boolean(user),user:user?{id:user.id,email:user.email,name:user.name,provider:user.provider,isAdmin:isAdmin(user)}:null})}
 if(req.method==='POST'&&url.pathname==='/api/auth/signup'){const body=JSON.parse(await readBody(req));const result=await signup(body.email,body.password,body.name);if(!result.token)return json(res,202,{user:result.user||null,message:'Account created. Check your email to confirm the account, then sign in.'});return json(res,201,{user:result.user},{'set-cookie':sessionCookie(result.token)})}
 if(req.method==='POST'&&url.pathname==='/api/auth/login'){const body=JSON.parse(await readBody(req));const result=await login(body.email,body.password);if(!result.token)return json(res,401,{error:'Authentication did not return a session. Confirm the account email and try again.'});return json(res,200,{user:result.user},{'set-cookie':sessionCookie(result.token)})}
 if(req.method==='POST'&&url.pathname==='/api/auth/logout')return json(res,200,{ok:true},{'set-cookie':clearSessionCookie()});
 if(req.method==='GET'&&url.pathname==='/api/auth/google'){try{return redirect(res,oauthStart('google'))}catch(error){return json(res,Number(error.status)||500,{error:error.message})}}
 if(req.method==='GET'&&url.pathname==='/api/auth/github'){try{return redirect(res,oauthStart('github'))}catch(error){return json(res,Number(error.status)||500,{error:error.message})}}
 if(req.method==='GET'&&url.pathname==='/api/auth/google/callback')return json(res,501,{error:'Google OAuth callback is not enabled yet. Use email/password login while OAuth PKCE is being configured.'});
 if(req.method==='GET'&&url.pathname==='/api/auth/github/callback')return json(res,501,{error:'GitHub OAuth callback is not enabled yet. Use email/password login while OAuth PKCE is being configured.'});
 if(req.method==='GET'&&url.pathname==='/api/capabilities'){if(!await requireUser(req,res))return;return json(res,200,publicCapabilities())}
 if(req.method==='GET'&&url.pathname==='/api/admin/models'){if(!await requireAdmin(req,res))return;return json(res,200,{models:adminModelDetails(),adminEmail:ADMIN_EMAIL})}
 if(req.method==='GET'&&url.pathname==='/api/admin/users'){if(!await requireAdmin(req,res))return;return json(res,200,{users:await listUsers(req)})}
 if(req.method==='GET'&&url.pathname==='/api/admin/overview'){if(!await requireAdmin(req,res))return;const users=await listUsers(req);return json(res,200,{adminEmail:ADMIN_EMAIL,userCount:users.length,models:adminModelDetails(),onlineModels:adminModelDetails().filter(m=>m.status==='Ready').length})}
 if(req.method!=='POST'||url.pathname!=='/api/chat')return json(res,404,{error:'Not found'});
 const user=await requireUser(req,res);if(!user)return;
 const raw=await readBody(req);let body;try{body=JSON.parse(raw)}catch{return json(res,400,{error:'Invalid JSON'})}
 const modelId=selectedModel(typeof body.model==='string'?body.model:'astracore-neural-a');
 if(!authorized(req,modelId))return json(res,401,{error:'Invalid AstraCore model key'});
 const engine=engines[modelId];if(!engine)return json(res,503,{error:`${MODEL_CONFIG[modelId].name} is not trained or loaded yet.`});
 const message=typeof body.message==='string'?body.message.trim():'';if(!message)return json(res,400,{error:'message is required'});if(message.length>MAX_MESSAGE)return json(res,413,{error:'message is too long'});
 const result=generate(engine.model,engine.tokenizer,message,{maxNewTokens:Math.min(Number(body.maxNewTokens)||80,160),temperature:Math.min(Math.max(Number(body.temperature)||.8,.1),2),topK:Math.min(Math.max(Number(body.topK)||8,1),32)});
 return json(res,200,{response:result.text,conversationId:typeof body.conversationId==='string'?body.conversationId.slice(0,128):null,model:'AstraCore neural core',usage:{inputTokens:engine.tokenizer.encode(message).length,outputTokens:result.tokenIds.length}})
}catch(error){const status=Number(error.status)||500;return json(res,status,{error:status===500?'Internal server error':error.message})}}
