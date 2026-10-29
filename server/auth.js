import { createHmac } from 'node:crypto';
const SUPABASE_URL=(process.env.ASTRACORE_SUPABASE_URL||process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SUPABASE_KEY=process.env.ASTRACORE_SUPABASE_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||'';
const SESSION_SECRET=process.env.ASTRA_SESSION_SECRET||'';
const ADMIN_EMAIL=(process.env.ASTRA_ADMIN_EMAIL||'ehemanathan143@gmail.com').toLowerCase();
const PUBLIC_URL=(process.env.ASTRA_PUBLIC_URL||'http://127.0.0.1:8787').replace(/\/$/,'');
const isProduction=process.env.VERCEL==='1'||process.env.NODE_ENV==='production';
function normalizeEmail(e){return String(e||'').trim().toLowerCase()}
function encode(v){return Buffer.from(JSON.stringify(v)).toString('base64url')}
function decode(v){try{return JSON.parse(Buffer.from(v,'base64url').toString('utf8'))}catch{return null}}
function secret(){if(SESSION_SECRET)return SESSION_SECRET;if(isProduction)throw Object.assign(new Error('AstraCore session security is not configured. Set ASTRA_SESSION_SECRET in the deployment environment.'),{status:503});return 'local-development-only-astracore-session-secret'}
function sign(v){return createHmac('sha256',secret()).update(v).digest('hex')}
function makeSigned(v){const p=encode(v);return `${p}.${sign(p)}`}
function readSigned(v){const[p,s]=String(v||'').split('.');if(!p||!s||s!==sign(p))return null;const value=decode(p);return value&&Number(value.expiresAt||0)>Date.now()?value:null}
function parseCookie(req,name){for(const part of(req.headers.cookie||'').split(';')){const[k,...v]=part.trim().split('=');if(k===name)return decodeURIComponent(v.join('='))}return ''}
function makeSession(accessToken,refreshToken,user,expiresIn=3600){return makeSigned({accessToken,refreshToken,user,expiresAt:Date.now()+Math.max(60,Number(expiresIn)-30)*1000})}
function cookieFlags(){return `Path=/; HttpOnly; ${isProduction?'Secure; ':''}SameSite=Lax; Max-Age=604800`}
export function sessionCookie(token){return `astracore_session=${encodeURIComponent(token)}; ${cookieFlags()}`}
export function clearSessionCookie(){return `astracore_session=; ${cookieFlags()}; Max-Age=0`}
export function isAdmin(user){return Boolean(user&&normalizeEmail(user.email)===ADMIN_EMAIL)}
async function sb(path,options={}){if(!SUPABASE_URL||!SUPABASE_KEY)throw Object.assign(new Error('AstraCore Supabase authentication is not configured on this deployment. Set ASTRACORE_SUPABASE_URL and ASTRACORE_SUPABASE_KEY.'),{status:503});const headers={apikey:SUPABASE_KEY,'content-type':'application/json',...(options.headers||{})};const r=await fetch(`${SUPABASE_URL}${path}`,{...options,headers});const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={message:text}}if(!r.ok)throw Object.assign(new Error(data.msg||data.message||data.error_description||data.error||'Supabase request failed'),{status:r.status});return data}
function publicUser(data){return{id:data.id,email:normalizeEmail(data.email),name:String(data.user_metadata?.name||data.user_metadata?.full_name||data.email?.split('@')[0]||'').slice(0,80),provider:data.app_metadata?.provider||'password',isAdmin:isAdmin(data)}}
async function userFromToken(accessToken){return publicUser(await sb('/auth/v1/user',{headers:{Authorization:`Bearer ${accessToken}`}}))}
async function refreshSession(session){if(!session?.refreshToken)return null;try{const data=await sb('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refreshToken})});if(!data.access_token||!data.user)return null;const user=publicUser(data.user);return{user,token:makeSession(data.access_token,data.refresh_token||session.refreshToken,user,data.expires_in),accessToken:data.access_token}}catch{return null}}
export async function currentUser(req){const signed=readSigned(parseCookie(req,'astracore_session'));if(!signed)return null;try{return await userFromToken(signed.accessToken)}catch{const refreshed=await refreshSession(signed);if(!refreshed)return null;req.astracoreRefreshedSession=refreshed.token;req.astracoreAccessToken=refreshed.accessToken;return refreshed.user}}
function sessionFromRequest(req){const signed=readSigned(parseCookie(req,'astracore_session'));return signed||null}
export async function supabaseUserRequest(req,path,options={}){const session=sessionFromRequest(req);const accessToken=req.astracoreAccessToken||session?.accessToken;if(!accessToken)throw Object.assign(new Error('Login required'),{status:401});return sb(path,{...options,headers:{Authorization:`Bearer ${accessToken}`,...(options.headers||{})}})}
async function authResult(data){if(!data.user)return{user:null,token:null};const user=publicUser(data.user);return{user,token:data.access_token?makeSession(data.access_token,data.refresh_token,user,data.expires_in):null}}
export async function signup(email,password,name){email=normalizeEmail(email);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||String(password||'').length<8)throw Object.assign(new Error('Use a valid email and a password of at least 8 characters.'),{status:400});return authResult(await sb('/auth/v1/signup',{method:'POST',body:JSON.stringify({email,password,data:{name:String(name||email.split('@')[0]).slice(0,80)}})}))}
export async function login(email,password){email=normalizeEmail(email);if(!email||!password)throw Object.assign(new Error('Email and password are required.'),{status:400});return authResult(await sb('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})}))}
export function oauthStart(provider){if(!['google','github'].includes(provider))throw Object.assign(new Error('Unsupported login provider'),{status:400});if(!SUPABASE_URL)throw Object.assign(new Error('AstraCore Supabase authentication is not configured.'),{status:503});return`${SUPABASE_URL}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(`${PUBLIC_URL}/`)}`}
export async function listUsers(req){const s=sessionFromRequest(req);const accessToken=req.astracoreAccessToken||s?.accessToken;if(!s||!isAdmin(s.user)||!accessToken)return[];return sb('/rest/v1/astracore_users?select=id,auth_user_id,email,name,provider,is_admin,created_at,updated_at&order=created_at.desc',{headers:{Authorization:`Bearer ${accessToken}`}})}
export{ADMIN_EMAIL};
