export class KnowledgeRouter {
  constructor({ request }) { this.request = request; }
  async search(query, { limit = 8 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 20);
    return this.request('/rest/v1/rpc/search_astracore_knowledge', { method:'POST', headers:{Prefer:'return=representation'}, body:JSON.stringify({search_query:String(query).slice(0,2000),query_embedding:null,result_limit:safeLimit}) });
  }
}
export function chunkText(text,{size=1200,overlap=180}={}) {
  const input=String(text||'').replace(/\r\n/g,'\n').trim(); if(!input) return [];
  const chunks=[]; let start=0;
  while(start<input.length){const end=Math.min(start+size,input.length);chunks.push(input.slice(start,end));if(end>=input.length)break;start=Math.max(end-overlap,start+1);} return chunks;
}
export function documentTypeFromName(name=''){const match=String(name).toLowerCase().match(/\.([a-z0-9]+)$/);return match?.[1]||'text';}
export function isSupportedTextType(type){return new Set(['txt','md','markdown','json','csv','html','htm']).has(String(type).toLowerCase());}
