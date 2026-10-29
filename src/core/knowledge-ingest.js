import { createHash } from 'node:crypto';
import { chunkText, documentTypeFromName } from './knowledge.js';

const MAX_DOCUMENT_CHARS = 2_000_000;
const ALLOWED_TEXT_TYPES = new Set(['txt','md','markdown','json','csv','html','htm']);
const ALLOWED_DOCUMENT_TYPES = new Set(['txt','md','markdown','json','csv','html','htm','pdf','doc','docx','ppt','pptx','xls','xlsx']);

function cleanName(name) {
  return String(name || 'document').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim().slice(0, 180) || 'document';
}

function detectLanguage(text) {
  const value = String(text || '');
  if (/[஀-௿]/.test(value)) return 'ta';
  if (/[ऀ-ॿ]/.test(value)) return 'hi';
  if (/[ఀ-౿]/.test(value)) return 'te';
  if (/[ഀ-ൿ]/.test(value)) return 'ml';
  if (/[ಀ-೿]/.test(value)) return 'kn';
  return 'en';
}

export function validateDocumentInput({ name, content, type = '' }) {
  const safeName = cleanName(name);
  const ext = documentTypeFromName(safeName);
  if (!ALLOWED_DOCUMENT_TYPES.has(ext)) return { ok: false, reason: `Unsupported document type: .${ext || 'unknown'}` };
  if (typeof content !== 'string') return { ok: false, reason: 'Extracted text content is required.' };
  if (!content.trim()) return { ok: false, reason: 'Document contains no extractable text.' };
  if (content.length > MAX_DOCUMENT_CHARS) return { ok: false, reason: `Document text exceeds the ${MAX_DOCUMENT_CHARS.toLocaleString()} character limit.` };
  return { ok: true, name: safeName, ext, type: type || `text/${ext}` };
}

async function persistExtractedDocument(request, { userId, name, content, type, tags = [], segments = [], extraction = {}, embedder = null } = {}) {
  const validation = validateDocumentInput({ name, content, type });
  if (!validation.ok) throw Object.assign(new Error(validation.reason), { status: 415 });
  const text = String(content).replace(/\r\n/g, '\n').trim();
  const hash = createHash('sha256').update(text, 'utf8').digest('hex');
  const language = detectLanguage(text);
  const safeTags = Array.isArray(tags) ? tags.map((tag) => String(tag).trim().slice(0, 40)).filter(Boolean).slice(0, 20) : [];
  const existing = await request(`/rest/v1/astracore_knowledge_documents?user_id=eq.${encodeURIComponent(userId)}&content_hash=eq.${encodeURIComponent(hash)}&select=id,title&limit=1`);
  if (existing[0]) return { duplicate: true, document: existing[0], chunks: 0 };

  const sourceRows = await request('/rest/v1/astracore_knowledge_sources', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, name: validation.name, source_type: 'local_file', status: 'active', tags: safeTags, permissions: { owner_user_id: userId, visibility: 'private' } }),
  });
  const source = sourceRows[0];
  if (!source?.id) throw Object.assign(new Error('Knowledge source could not be created.'), { status: 500 });

  try {
    const documentRows = await request('/rest/v1/astracore_knowledge_documents', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: userId, source_id: source.id, title: validation.name, source: 'user_upload', owner: userId, language, document_type: validation.ext, permissions: { owner_user_id: userId, visibility: 'private' }, tags: safeTags, content_hash: hash, status: 'processing', metadata: { original_type: validation.type, extracted: true, extraction_method: extraction.method || 'text', ocr: Boolean(extraction.ocr), segments: segments.length } }),
    });
    const document = documentRows[0];
    if (!document?.id) throw Object.assign(new Error('Knowledge document could not be created.'), { status: 500 });

    const normalizedSegments = segments.length ? segments : [{ text }];
    const rows = [];
    let chunkIndex = 0;
    for (const segment of normalizedSegments) {
      const segmentText = String(segment.text || '').trim();
      if (!segmentText) continue;
      for (const chunk of chunkText(segmentText, { size: 1200, overlap: 180 })) {
        rows.push({ document_id: document.id, user_id: userId, chunk_index: chunkIndex++, content: chunk, language, page_number: Number.isInteger(segment.page) ? segment.page : null, metadata: { source: validation.name, content_hash: hash, locator: segment.locator || null, extraction_method: extraction.method || 'text', ocr: Boolean(extraction.ocr) } });
      }
    }
    if (rows.length) {
      if (typeof embedder === 'function') {
        const vectors = await embedder(rows.map((row) => row.content));
        if (Array.isArray(vectors) && vectors.length === rows.length) rows.forEach((row, i) => { if (Array.isArray(vectors[i]) && vectors[i].length === 384) row.embedding = vectors[i]; });
      }
      await request('/rest/v1/astracore_knowledge_chunks', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
    }
    await request(`/rest/v1/astracore_knowledge_documents?id=eq.${encodeURIComponent(document.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'indexed', updated_at: new Date().toISOString(), page_count: Math.max(0, ...normalizedSegments.map((s) => Number(s.page) || 0)) || null, metadata: { original_type: validation.type, extracted: true, extraction_method: extraction.method || 'text', ocr: Boolean(extraction.ocr), segment_count: normalizedSegments.length, chunk_count: rows.length, content_chars: text.length } }) });
    await request(`/rest/v1/astracore_knowledge_sources?id=eq.${encodeURIComponent(source.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_synced_at: new Date().toISOString() }) });
    return { duplicate: false, document: { id: document.id, title: document.title, document_type: document.document_type, language, content_hash: hash, status: 'indexed' }, chunks: rows.length, extraction: { method: extraction.method || 'text', ocr: Boolean(extraction.ocr), segments: normalizedSegments.length } };
  } catch (error) {
    await request(`/rest/v1/astracore_knowledge_sources?id=eq.${encodeURIComponent(source.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'error', error_message: String(error.message || 'Ingestion failed').slice(0, 500) }) }).catch(() => {});
    throw error;
  }
}

export async function ingestTextDocument(request, options = {}) {
  return persistExtractedDocument(request, { ...options, extraction: { method: 'text', ocr: false } });
}

export async function ingestExtractedDocument(request, options = {}) {
  return persistExtractedDocument(request, options);
}

export { ALLOWED_DOCUMENT_TYPES, ALLOWED_TEXT_TYPES, MAX_DOCUMENT_CHARS };
