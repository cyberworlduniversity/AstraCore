import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function saveCheckpoint(path, { model, tokenizer, metadata = {} }) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ version: 1, metadata, tokenizer: tokenizer.toJSON(), model: model.toJSON() }), 'utf8');
}

export async function loadCheckpoint(path, { Model, Tokenizer, requireProductionReady = false }) {
  const raw = await readFile(path, 'utf8');
  const data = JSON.parse(raw);
  if (data.version !== 1) throw new Error(`Unsupported checkpoint version: ${data.version}`);
  if (requireProductionReady && data.metadata?.production_ready !== true) throw new Error('Checkpoint is not marked production_ready.');
  return {
    metadata: data.metadata ?? {},
    tokenizer: Tokenizer.fromJSON(data.tokenizer),
    model: Model.fromJSON(data.model)
  };
}
