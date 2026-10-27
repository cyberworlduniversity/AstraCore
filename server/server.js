import http from 'node:http';
import { access } from 'node:fs/promises';
import { CharacterTokenizer } from '../src/ai/tokenizer.js';
import { NeuralLanguageModel } from '../src/ai/model.js';
import { loadCheckpoint } from '../src/ai/checkpoint.js';
import { generate } from '../src/ai/inference.js';

const HOST = process.env.ASTRA_HOST || '127.0.0.1';
const PORT = Number(process.env.ASTRA_PORT || 8787);
const MAX_BODY = 16 * 1024;
const MAX_MESSAGE = 4000;
const CHECKPOINT = process.env.ASTRA_CHECKPOINT || 'data/checkpoints/astracore-demo.json';

let engine = null;

async function loadEngine() {
  try {
    await access(CHECKPOINT);
    engine = await loadCheckpoint(CHECKPOINT, { Model: NeuralLanguageModel, Tokenizer: CharacterTokenizer });
  } catch {
    engine = null;
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let data = '';
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      return json(res, 200, { ok: true, model: engine ? 'astracore-neural-v0.1-demo' : null, ready: Boolean(engine) });
    }
    if (req.method !== 'POST' || req.url !== '/api/chat') return json(res, 404, { error: 'Not found' });

    if (!engine) return json(res, 503, { error: 'AstraCore model is not trained yet. Run npm run train:demo.' });
    const raw = await readBody(req);
    let body;
    try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return json(res, 400, { error: 'message is required' });
    if (message.length > MAX_MESSAGE) return json(res, 413, { error: 'message is too long' });

    const result = generate(engine.model, engine.tokenizer, message, {
      maxNewTokens: Math.min(Number(body.maxNewTokens) || 80, 160),
      temperature: Math.min(Math.max(Number(body.temperature) || 0.8, 0.1), 2),
      topK: Math.min(Math.max(Number(body.topK) || 8, 1), 32)
    });
    return json(res, 200, {
      response: result.text,
      conversationId: typeof body.conversationId === 'string' ? body.conversationId.slice(0, 128) : null,
      model: 'astracore-neural-v0.1-demo',
      usage: { inputTokens: engine.tokenizer.encode(message).length, outputTokens: result.tokenIds.length }
    });
  } catch (error) {
    const status = Number(error.status) || 500;
    json(res, status, { error: status === 500 ? 'Internal server error' : error.message });
  }
});

await loadEngine();
server.listen(PORT, HOST, () => console.log(`AstraCore listening on http://${HOST}:${PORT}`));
