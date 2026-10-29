export const SOURCE_TYPES = Object.freeze({
  LOCAL_FILE: 'local_file', WEB: 'web', DATABASE: 'database', API: 'api',
  SHAREPOINT: 'sharepoint', BLOB: 'blob', ONELAKE: 'onelake', MCP: 'mcp', USER: 'user_knowledge'
});

export function sourceRecord(row, score = 0) {
  return {
    source_id: row.document_id || row.chunk_id || row.id,
    title: row.title || row.source || 'Unknown source',
    url: row.url || null,
    document_id: row.document_id || null,
    chunk_id: row.chunk_id || null,
    chunk_id_reference: row.chunk_index ?? null,
    relevance_score: Number(score ?? row.combined_score ?? row.keyword_score ?? 0),
    retrieved_at: new Date().toISOString(),
  };
}

export function sourceList(rows = []) {
  return rows.map((row) => sourceRecord(row, row.combined_score)).filter((x) => x.source_id);
}

export function groundRetrievedContent(rows = []) {
  if (!rows.length) return '';
  return rows.map((row, index) => {
    const title = row.title || 'Untitled';
    const content = String(row.content || '').slice(0, 8000);
    return `[[RETRIEVED_DATA ${index + 1}]]\nSource: ${title}\nContent:\n${content}\n[[END_RETRIEVED_DATA ${index + 1}]]`;
  }).join('\n\n');
}
