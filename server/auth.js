import { createHmac } from 'node:crypto';

const SUPABASE_URL=(process.env.ASTRACORE_SUPABASE_URL||process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SUPABASE_KEY=process.env.ASTRACORE_SUPABASE_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||'';
const SESSION_SECRET=process.env.ASTRA_SESSION_SECRET||'change-this-astracore-session-secret';
const ADMIN_EMAIL=(process.env.ASTRA_ADMIN_EMAIL||'ehemanathan143@gmail.com').toLowerCase();
const PUBLIC_URL=(process.env.ASTRA_PUBLIC_URL||'http://127.0.0.1:8787').replace(/\/$/,'');

function normalizeEmail(e){return String(e||'').trim().toLowerCase()}
function encode(v){return Buffer.from(JSON.stringify(v)).toString('base64url')}
function decode(v){try{return JSON.parse(Buffer.from(v,'base64url').toString('utf8'))}catch{return null}}
function sign(v){return createHmac('sha256',SESSION_SECRET).update(v).digest('hex')}
function makeSigned(v){const p=encode(v);return `${p}.${sign(p)}`}
function readSigned(token){const [p,s]=String(token||'').split('.');if(!p||!s||s!==sign(p))return null;const v=decode(p);return v&&Number(v.expiresAt||0)>Date.now()?v:null}
function parseCookie(req,name){for(const part of (req.headers.cookie||'').split(';')){const [k,...v]=part.trim().split('=');if(k===name)return decodeURIComponent(v.join('='))}return ''}
function makeSession(accessToken,refreshToken,user,expiresIn=3600){return makeSigned({accessToken,refreshToken,user,expiresAt:Date.now()+Math.max(60,Number(expiresIn)-30)*1000})}
export function sessionCookie(token){return `astracore_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`}
export function clearSessionCookie(){return 'astracore_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}
export function isAdmin(user){return Boolean(user&&normalizeEmail(user.email)===ADMIN_EMAIL)}

async function sb(path,options={}){
 if(!SUPABASE_URL||!SUPABASE_KEY)throw Object.assign(new Error('AstraCore Supabase authentication is not configured.'),{status:503});
 const headers={apikey:SUPABASE_KEY,'content-type':'application/json',...(options.headers||{})};
 const r=await fetch(`${SUPABASE_URL}${path}`,{...options,headers});
 const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={message:text}};
 if(!r.ok)throw Object.assign(new Error(data.msg||data.message||data.error_description||data.error||'Supabase authentication request failed'),{status:r.status});
 return data;
}

function publicUser(data){return {id:data.id,email:normalizeEmail(data.email),name:String(data.user_metadata?.name||data.user_metadata?.full_name||data.email?.split('@')[0]||'').slice(0,80),provider:data.app_metadata?.provider||'password',isAdmin:isAdmin(data)}}
async function userFromToken(accessToken){return publicUser(await sb('/auth/v1/user',{headers:{Authorization:`Bearer ${accessToken}`}}))}
export async function currentUser(req){const s=readSigned(parseCookie(req,'astracore_session'));if(!s)return null;try{return await userFromToken(s.accessToken)}catch{return null}}
async function authResult(data){if(!data.user)return {user:null,token:null};const user=publicUser(data.user);return {user,token:data.access_token?makeSession(data.access_token,data.refresh_token,user,data.expires_in):null}}

export async function signup(email,password,name){email=normalizeEmail(email);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||String(password||'').length<8)throw Object.assign(new Error('Use a valid email and a password of at least 8 characters.'),{status:400});const data=await sb('/auth/v1/signup',{method:'POST',body:JSON.stringify({email,password,data:{name:String(name||email.split('@')[0]).slice(0,80)}})});return authResult(data)}
export async function login(email,password){email=normalizeEmail(email);if(!email||!password)throw Object.assign(new Error('Email and password are required.'),{status:400});return authResult(await sb('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})}))}
export function oauthStart(provider){if(!['google','github'].includes(provider))throw Object.assign(new Error('Unsupported login provider'),{status:400});if(!SUPABASE_URL)throw Object.assign(new Error('AstraCore Supabase authentication is not configured.'),{status:503});return `${SUPABASE_URL}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(`${PUBLIC_URL}/`)}`}
export function validateOAuthState(){return true}
export async function oauthCallback(){throw Object.assign(new Error('OAuth callback is handled by the Supabase browser session flow.'),{status:501})}
export async function listUsers(req){const s=readSigned(parseCookie(req,'astracore_session'));if(!s||!isAdmin(s.user))return [];return sb('/rest/v1/astracore_users?select=id,auth_user_id,email,name,provider,is_admin,created_at,updated_at&order=created_at.desc',{headers:{Authorization:`Bearer ${s.accessToken}`}})}
export { ADMIN_EMAIL };