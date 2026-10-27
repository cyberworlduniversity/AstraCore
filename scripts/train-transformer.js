import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { CharacterTokenizer } from '../src/ai/tokenizer.js';
import { DecoderOnlyTransformer } from '../src/ai/transformer.js';
import { TransformerTrainer } from '../src/ai/training.js';

const corpusPath = process.argv[2] ?? 'data/demo-corpus.txt';
const epochs = Number(process.env.ASTRA_EPOCHS ?? 5);
const contextLength = Number(process.env.ASTRA_CONTEXT ?? 32);
const text = await readFile(corpusPath, 'utf8');
if (text.length < contextLength + 2) throw new Error('Corpus is too small for the selected context length.');

const tokenizer = new CharacterTokenizer();
const ids = tokenizer.encode(text, { addBos: true, addEos: true });
const split = Math.max(contextLength + 1, Math.floor(ids.length * 0.9));
const trainIds = ids.slice(0, split);
const validIds = ids.slice(Math.max(0, split - contextLength), Math.min(ids.length, split + contextLength * 2));

function makeSamples(tokens) {
  const samples = [];
  for (let i = 0; i + contextLength < tokens.length; i += contextLength) samples.push({ input: tokens.slice(i, i + contextLength), target: tokens.slice(i + 1, i + contextLength + 1) });
  return samples;
}

const trainSamples = makeSamples(trainIds);
const validationSamples = makeSamples(validIds);
const model = new DecoderOnlyTransformer({ vocabSize: tokenizer.vocabSize, contextLength, dModel: 64, heads: 4, ffDim: 128, layers: 2, seed: 42 });
const trainer = new TransformerTrainer(model, { learningRate: Number(process.env.ASTRA_LR ?? 0.0005), weightDecay: 0.01, maxGradNorm: 1 });
console.log(`train_samples=${trainSamples.length} validation_samples=${validationSamples.length} tokens=${ids.length}`);
const history = trainer.train(trainSamples, { epochs, validation: validationSamples, onStep: ({ epoch, step }) => { if (step % 10 === 0) console.log(`epoch=${epoch} step=${step}`); } });
for (const row of history) console.log(`epoch=${row.epoch} train_loss=${row.trainLoss.toFixed(4)} val_loss=${row.validation.loss.toFixed(4)} perplexity=${row.validation.perplexity.toFixed(2)}`);

await mkdir('data/checkpoints', { recursive: true });
await writeFile('data/checkpoints/astracore-transformer-v0.4.json', JSON.stringify({ version: 4, metadata: { type: 'transformer-training', epochs, corpusPath, corpusTokens: ids.length, trainSamples: trainSamples.length, validationSamples: validationSamples.length, finalStep: trainer.step, createdAt: new Date().toISOString() }, tokenizer: tokenizer.toJSON(), model: model.toJSON() }), 'utf8');
console.log('Saved data/checkpoints/astracore-transformer-v0.4.json');
