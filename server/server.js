import http from 'node:http';
import { access, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CharacterTokenizer } from '../src/ai/tokenizer.js';
import { NeuralLanguageModel } from '../src/ai/model.js';
import { DecoderOnlyTransformer } from '../src/ai/transformer.js';
import { loadCheckpoint } from '../src/ai/checkpoint.js';
import { generate } from '../src/ai/inference.js';
import { generateWithTransformer } from '../src/ai/transformer-inference.js';

const HOST = process.env.ASTRA_HOST || '127.0.0.1';
const PORT = Number(process.env.ASTRA_PORT || 8787);
const MAX_BODY = 16 * 1024;
const MAX_MESSAGE = 4000;
const CHECKPOINT = process.env.ASTRA_CHECKPOINT || 'data/checkpoints/astracore-demo.json';
const TRANSFORMER_CHECKPOINT = process.env.ASTRA_TRANSFORMER_CHECKPOINT || 'data/checkpoints/astracore-transformer.json';
const WEB_ROOT = fileURLToPath(new URL('../web/', import.meta.url));
let engine = null;

async function loadEngine() {
  try {
    await access(TRANSFORMER_CHECKPOINT);
    const payload = JSON.parse(await readFile(TRANSFORMER_CHECKPOINT, 'utf8'));
    const state = payload.state || payload.model?.state || payload;
    const tokenizer = CharacterTokenizer.fromJSON ? CharacterTokenizer.fromJSON(payload.tokenizer) : new CharacterTokenizer();
    engine = { type: 'transformer', model: DecoderOnlyTransformer.fromState(state), tokenizer };
    return;
  } catch {}
  try {
    await access(CHECKPOINT);
    engine = { type: 'baseline', ...(await loadCheckpoint(CHECKPOINT, { Model: NeuralLanguageModel, Tokenizer: CharacterTokenizer })) };
  } catch { engine = null; }
}

function headers(type) {
  return {
    'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
    'access-control-allow-origin': process.env.ASTRA_CORS_ORIGIN || '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type'
  };
}
function json(res, status, body) { res.writeHead(status, headers('application/json; charset=utf-8')); res.end(JSON.stringify(body)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; let data = '';
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); return; } data += chunk; });
    req.on('end', () => resolve(data)); req.on('error', reject);
  });
}
async function serveWeb(req, res) {
  const pathname = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  if (!pathname.startsWith('/web/') && pathname !== '/index.html') return false;
  const relative = pathname === '/index.html' ? 'index.html' : pathname.slice('/web/'.length);
  const safe = normalize(relative).replace(/^([.][.][\\/])+/, '');
  const file = join(WEB_ROOT, safe);
  try { const body = await readFile(file); const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }; res.writeHead(200, headers(types[extname(file)] || 'application/octet-stream')); res.end(body); return true; } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, headers('text/plain')); return res.end(); }
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/web/'))) if (await serveWeb(req, res)) return;
    if (req.method === 'GET' && req.url === '/api/health') {
      return json(res, 200, { ok: true, model: engine ? (engine.type === 'transformer' ? 'astracore-transformer-v0.7' : 'astracore-neural-v0.1-demo') : null, ready: Boolean(engine), transformer: engine?.type === 'transformer', ui: '/' });
    }
    if (req.method !== 'POST' || req.url !== '/api/chat') return json(res, 404, { error: 'Not found' });
    if (!engine) return json(res, 503, { error: 'AstraCore model is not trained yet.' });
    const raw = await readBody(req); let body; try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return json(res, 400, { error: 'message is required' });
    if (message.length > MAX_MESSAGE) return json(res, 413, { error: 'message is too long' });
    const options = { maxNewTokens: Math.min(Number(body.maxNewTokens) || 80, 160), temperature: Math.min(Math.max(Number(body.temperature) || 0.8, 0.1), 2), topK: Math.min(Math.max(Number(body.topK) || 8, 1), 32) };
    const prompt = typeof body.context === 'string' && body.context.length < 8000 ? `${body.context}\nUser: ${message}\nAssistant:` : `User: ${message}\nAssistant:`;
    const result = engine.type === 'transformer' ? generateWithTransformer(engine.model, engine.tokenizer, prompt, options) : generate(engine.model, engine.tokenizer, message, options);
    return json(res, 200, { response: result.text, conversationId: typeof body.conversationId === 'string' ? body.conversationId.slice(0, 128) : null, model: engine.type === 'transformer' ? 'astracore-transformer-v0.7' : 'astracore-neural-v0.1-demo', usage: { inputTokens: engine.tokenizer.encode(prompt).length, outputTokens: result.tokenIds.length } });
  } catch (error) { const status = Number(error.status) || 500; json(res, status, { error: status === 500 ? 'Internal server error' : error.message }); }
});

await loadEngine();
server.listen(PORT, HOST, () => console.log(`AstraCore listening on http://${HOST}:${PORT}`));
