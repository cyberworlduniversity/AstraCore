export const MULTIMODAL_CAPABILITIES = Object.freeze({
  image: { accepted: ['png','jpg','jpeg','webp'], status: 'pipeline-ready' },
  pdf: { accepted: ['pdf'], status: 'extractor-ready' },
  docx: { accepted: ['docx'], status: 'extractor-ready' },
  pptx: { accepted: ['pptx'], status: 'extractor-ready' },
  xlsx: { accepted: ['xlsx'], status: 'extractor-ready' },
  audio: { accepted: ['mp3','wav','m4a','ogg'], status: 'adapter-required' },
  video: { accepted: ['mp4','mov','webm'], status: 'adapter-required' },
  ocr: { accepted: ['image','pdf'], status: 'adapter-required' },
});

export function classifyMedia(filename = '') {
  const ext = String(filename).toLowerCase().split('.').pop();
  for (const [kind, definition] of Object.entries(MULTIMODAL_CAPABILITIES)) if (definition.accepted.includes(ext)) return { kind, extension: ext, status: definition.status };
  return { kind: 'unknown', extension: ext, status: 'unsupported' };
}

export function buildDocumentPipeline(metadata = {}) {
  return ['validate','security_scan','detect_type','extract','ocr_if_required','normalize','chunk','embed','index'].map((stage) => ({ stage, status: stage === 'extract' && metadata.extractable === false ? 'blocked' : 'planned' }));
}
