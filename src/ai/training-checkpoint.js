import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function tokenizerFingerprint(tokenizer) {
  return digest(tokenizer.toJSON());
}

export function createTrainingManifest({ tokenizer, model, datasetId = 'local-corpus', sequenceLength, split = {}, seed = 42 }) {
  return {
    version: 1,
    datasetId,
    sequenceLength,
    split,
    seed,
    tokenizerFingerprint: tokenizerFingerprint(tokenizer),
    modelConfig: {
      vocabSize: model.vocabSize,
      contextLength: model.contextLength,
      dModel: model.dModel,
      heads: model.heads,
      ffDim: model.ffDim,
      layers: model.layers,
    },
  };
}

export async function saveTrainingCheckpoint(path, { model, trainer, tokenizer, manifest, history = [] }) {
  await mkdir(dirname(path), { recursive: true });
  const payload = {
    format: 'astracore-training-checkpoint',
    version: 1,
    createdAt: new Date().toISOString(),
    manifest: { ...manifest, tokenizerFingerprint: tokenizerFingerprint(tokenizer) },
    tokenizer: tokenizer.toJSON(),
    model: model.toJSON(),
    trainer: trainer.toJSON(),
    history,
  };
  await writeFile(path, JSON.stringify(payload), 'utf8');
  return payload;
}

export async function loadTrainingCheckpoint(path, { DecoderOnlyTransformer, TransformerTrainer, Tokenizer }) {
  const payload = JSON.parse(await readFile(path, 'utf8'));
  if (payload.format !== 'astracore-training-checkpoint' || payload.version !== 1) {
    throw new Error(`Unsupported training checkpoint: ${payload.version ?? 'unknown'}`);
  }
  const tokenizer = Tokenizer.fromJSON(payload.tokenizer);
  const actualFingerprint = tokenizerFingerprint(tokenizer);
  if (actualFingerprint !== payload.manifest.tokenizerFingerprint) throw new Error('Checkpoint tokenizer fingerprint mismatch');
  const model = DecoderOnlyTransformer.fromState(payload.model.state);
  const trainer = TransformerTrainer.fromJSON(model, payload.trainer);
  return { model, tokenizer, trainer, manifest: payload.manifest, history: payload.history ?? [], createdAt: payload.createdAt };
}
