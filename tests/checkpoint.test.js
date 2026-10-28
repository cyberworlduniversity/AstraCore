import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CharacterTokenizer } from '../src/ai/tokenizer.js';
import { DecoderOnlyTransformer } from '../src/ai/transformer.js';
import { TransformerTrainer } from '../src/ai/training.js';
import { createTrainingManifest, saveTrainingCheckpoint, loadTrainingCheckpoint } from '../src/ai/training-checkpoint.js';

test('training checkpoint restores model, optimizer and tokenizer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'astracore-'));
  const path = join(dir, 'checkpoint.json');
  try {
    const tokenizer = new CharacterTokenizer();
    const model = new DecoderOnlyTransformer({ vocabSize: tokenizer.vocabSize, contextLength: 8, dModel: 8, heads: 2, ffDim: 16, layers: 1, seed: 7 });
    const trainer = new TransformerTrainer(model, { learningRate: 0.01, weightDecay: 0 });
    trainer.trainStep([1, 2, 3], [2, 3, 4]);
    const manifest = createTrainingManifest({ tokenizer, model, datasetId: 'test', sequenceLength: 3, split: { train: 1, validation: 0 }, seed: 7 });
    await saveTrainingCheckpoint(path, { model, trainer, tokenizer, manifest, history: [{ epoch: 1 }] });
    const restored = await loadTrainingCheckpoint(path, { DecoderOnlyTransformer, TransformerTrainer, Tokenizer: CharacterTokenizer });
    assert.equal(restored.trainer.steps, 1);
    assert.equal(restored.model.toJSON().state.version, 4);
    assert.deepEqual(restored.tokenizer.toJSON(), tokenizer.toJSON());
    assert.equal(restored.manifest.datasetId, 'test');
    assert.equal(restored.history.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
