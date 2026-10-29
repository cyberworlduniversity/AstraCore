export function assertMemoryInput(body = {}) {
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) throw Object.assign(new Error('memory content is required'), { status: 400 });
  if (content.length > 4000) throw Object.assign(new Error('memory content is too long'), { status: 413 });
  const confidence = body.confidence == null ? 1 : Number(body.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw Object.assign(new Error('confidence must be between 0 and 1'), { status: 400 });
  }
  return {
    content,
    source: typeof body.source === 'string' ? body.source.slice(0, 120) : 'user',
    confidence,
    permission: body.permission === 'shared' ? 'shared' : 'private',
    expires_at: body.expiresAt || null,
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
  };
}
