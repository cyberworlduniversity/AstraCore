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
  if (typeof content !== 'string') return { ok: false, reason: 'This ingestion stage requires extracted text. Binary PDF/Office/OCR processing is NOT IMPLEMENTED yet.' };
  if (!content.trim()) return { ok: false, reason: 'Document contains no extractable text.' };
  if (content.length > MAX_DOCUMENT_CHARS) return { ok: false, reason: `Document text exceeds the ${MAX_DOCUMENT_CHARS.toLocaleString()} character limit.` };
  if (!ALLOWED_TEXT_TYPES.has(ext)) return { ok: false, reason: `Text extraction for .${ext} is NOT IMPLEMENTED yet. Upload a TXT, MD, CSV, JSON or HTML file for this release.` };
  return { ok: true, name: safeName, ext, type: type || `text/${ext}` };
}

export async function ingestTextDocument(request, { userId, name, content, type, tags = [] } = {}) {
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
      body: JSON.stringify({ user_id: userId, source_id: source.id, title: validation.name, source: 'user_upload', owner: userId, language, document_type: validation.ext, permissions: { owner_user_id: userId, visibility: 'private' }, tags: safeTags, content_hash: hash, status: 'processing', metadata: { original_type: validation.type, extracted: true, ocr: false } }),
    });
    const document = documentRows[0];
    if (!document?.id) throw Object.assign(new Error('Knowledge document could not be created.'), { status: 500 });

    const chunks = chunkText(text, { size: 1200, overlap: 180 });
    const rows = chunks.map((chunk, index) => ({ document_id: document.id, user_id: userId, chunk_index: index, content: chunk, language, metadata: { source: validation.name, content_hash: hash } }));
    if (rows.length) await request('/rest/v1/astracore_knowledge_chunks', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
    await request(`/rest/v1/astracore_knowledge_documents?id=eq.${encodeURIComponent(document.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'indexed', updated_at: new Date().toISOString(), metadata: { original_type: validation.type, extracted: true, ocr: false, chunk_count: chunks.length, content_chars: text.length } }) });
    await request(`/rest/v1/astracore_knowledge_sources?id=eq.${encodeURIComponent(source.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_synced_at: new Date().toISOString() }) });
    return { duplicate: false, document: { id: document.id, title: document.title, document_type: document.document_type, language, content_hash: hash, status: 'indexed' }, chunks: chunks.length };
  } catch (error) {
    await request(`/rest/v1/astracore_knowledge_sources?id=eq.${encodeURIComponent(source.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'error', error_message: String(error.message || 'Ingestion failed').slice(0, 500) }) }).catch(() => {});
    throw error;
  }
}
