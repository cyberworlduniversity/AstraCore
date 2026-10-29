import { ingestTextDocument } from '../src/core/knowledge-ingest.js';
import { KnowledgeRouter } from '../src/core/knowledge.js';

const MAX_UPLOAD_BODY = 2_200_000;

export async function knowledgeRoute({ req, res, url, user, readBody, json, supabaseUserRequest }) {
  if (!url.pathname.startsWith('/api/knowledge')) return false;
  const request = (path, options = {}) => supabaseUserRequest(req, path, options);

  if (req.method === 'POST' && url.pathname === '/api/knowledge/upload') {
    const raw = await readBody(req, MAX_UPLOAD_BODY);
    let body;
    try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const name = typeof body.name === 'string' ? body.name : '';
    const content = typeof body.content === 'string' ? body.content : null;
    if (!name || content === null) return json(res, 400, { error: 'name and extracted text content are required' });
    const result = await ingestTextDocument(request, { userId: user.id, name, content, type: body.type, tags: body.tags });
    return json(res, result.duplicate ? 200 : 201, { ok: true, ...result });
  }

  if (req.method === 'POST' && url.pathname === '/api/knowledge/search') {
    const raw = await readBody(req, 32 * 1024);
    let body;
    try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) return json(res, 400, { error: 'query is required' });
    const router = new KnowledgeRouter({ request });
    const results = await router.search(query, { limit: Math.min(Math.max(Number(body.limit) || 8, 1), 20) });
    return json(res, 200, { query, results, count: results.length });
  }

  if (req.method === 'GET' && url.pathname === '/api/knowledge') {
    const rows = await request('/rest/v1/astracore_knowledge_documents?select=id,title,source,document_type,language,status,tags,content_hash,metadata,created_at,updated_at&order=updated_at.desc&limit=100');
    return json(res, 200, { documents: rows });
  }

  if (req.method === 'DELETE' && /^\/api\/knowledge\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split('/')[3]);
    const rows = await request(`/rest/v1/astracore_knowledge_documents?id=eq.${encodeURIComponent(id)}&select=id,source_id&limit=1`);
    if (!rows[0]) return json(res, 404, { error: 'Knowledge document not found' });
    await request(`/rest/v1/astracore_knowledge_chunks?document_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    await request(`/rest/v1/astracore_knowledge_documents?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (rows[0].source_id) await request(`/rest/v1/astracore_knowledge_sources?id=eq.${encodeURIComponent(rows[0].source_id)}`, { method: 'DELETE' }).catch(() => {});
    return json(res, 200, { ok: true, id });
  }

  return json(res, 404, { error: 'Knowledge route not found' });
}

export { MAX_UPLOAD_BODY };
