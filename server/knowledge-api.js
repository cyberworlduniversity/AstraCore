import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ingestTextDocument, ingestExtractedDocument } from '../src/core/knowledge-ingest.js';
import { KnowledgeRouter } from '../src/core/knowledge.js';
import { createEmbeddingService } from './embedding-service.js';

const MAX_UPLOAD_BODY = 11_500_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const HERE = dirname(fileURLToPath(import.meta.url));
const EXTRACTOR = join(HERE, '..', 'scripts', 'document_extract.py');

function runExtractor(payload) {
  return new Promise((resolve, reject) => {
    const executable = process.platform === 'win32' ? 'python' : 'python3';
    const child = spawn(executable, [EXTRACTOR], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = ''; let settled = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); if (!settled) { settled = true; reject(Object.assign(new Error('Document extraction timed out.'), { status: 504 })); } }, 20_000);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); if (stdout.length > 2_000_000) child.kill('SIGKILL'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString().slice(0, 2000); });
    child.on('error', (error) => { clearTimeout(timer); if (!settled) { settled = true; reject(Object.assign(new Error(`Document extractor unavailable: ${error.message}`), { status: 503 })); } });
    child.on('close', (code) => {
      clearTimeout(timer); if (settled) return; settled = true;
      let result; try { result = JSON.parse(stdout); } catch { return reject(Object.assign(new Error('Document extractor returned invalid output.'), { status: 502 })); }
      if (code !== 0 || !result.ok) return reject(Object.assign(new Error(result.error || stderr || 'Document extraction failed.'), { status: 415 }));
      resolve(result);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export async function knowledgeRoute({ req, res, url, user, readBody, json, supabaseUserRequest }) {
  if (!url.pathname.startsWith('/api/knowledge')) return false;
  const request = (path, options = {}) => supabaseUserRequest(req, path, options);
  const embedder = createEmbeddingService();

  if (req.method === 'POST' && url.pathname === '/api/knowledge/upload') {
    const raw = await readBody(req, MAX_UPLOAD_BODY);
    let body;
    try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const name = typeof body.name === 'string' ? body.name : '';
    if (!name) return json(res, 400, { error: 'name is required' });
    const tags = Array.isArray(body.tags) ? body.tags : [];

    if (typeof body.content === 'string') {
      const result = await ingestTextDocument(request, { userId: user.id, name, content: body.content, type: body.type, tags, embedder });
      return json(res, result.duplicate ? 200 : 201, { ok: true, ...result });
    }

    if (typeof body.data !== 'string') return json(res, 400, { error: 'Provide extracted text as content or a base64 file as data.' });
    let byteLength;
    try { byteLength = Buffer.from(body.data, 'base64').length; } catch { byteLength = MAX_FILE_BYTES + 1; }
    if (byteLength > MAX_FILE_BYTES) return json(res, 413, { error: `File exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB limit.` });
    const extracted = await runExtractor({ name, data: body.data });
    const content = extracted.segments.map((s) => s.text).join('\n\n').trim();
    const result = await ingestExtractedDocument(request, { userId: user.id, name, content, type: body.type, tags, embedder, segments: extracted.segments, extraction: { method: `python:${String(name).split('.').pop().toLowerCase()}`, ocr: false } });
    return json(res, result.duplicate ? 200 : 201, { ok: true, ...result });
  }

  if (req.method === 'POST' && url.pathname === '/api/knowledge/search') {
    const raw = await readBody(req, 32 * 1024);
    let body;
    try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) return json(res, 400, { error: 'query is required' });
    const router = new KnowledgeRouter({ request });
    const queryEmbedding = await embedder([query]);
    const results = await router.search(query, { queryEmbedding: queryEmbedding?.[0] || null, limit: Math.min(Math.max(Number(body.limit) || 8, 1), 20) });
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

export { MAX_UPLOAD_BODY, MAX_FILE_BYTES };
