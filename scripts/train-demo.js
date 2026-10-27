import { mkdir, writeFile } from 'node:fs/promises';
import { CharacterTokenizer } from '../src/ai/tokenizer.js';
import { NeuralLanguageModel } from '../src/ai/model.js';
import { saveCheckpoint } from '../src/ai/checkpoint.js';

const corpus = `AstraCore is a local first neural language model.\nAstraCore learns from training text by predicting the next token.\nThe model is small so it can be inspected, tested, and improved.\nCybersecurity education should be practical, ethical, and safe.\nComputer science is built through experiments, measurements, and iteration.\n`;

const tokenizer = new CharacterTokenizer();
const model = new NeuralLanguageModel({ vocabSize: tokenizer.vocabSize, embeddingDim: 24, learningRate: 0.04, seed: 7 });
const ids = tokenizer.encode(corpus, { addBos: true, addEos: true });
const epochs = 30;
let loss = 0;
for (let epoch = 0; epoch < epochs; epoch++) {
  loss = 0;
  for (let i = 0; i < ids.length - 1; i++) loss += model.trainStep(ids[i], ids[i + 1]);
  if ((epoch + 1) % 5 === 0) console.log(`epoch=${epoch + 1} loss=${(loss / (ids.length - 1)).toFixed(4)}`);
}
await mkdir('data/checkpoints', { recursive: true });
await writeFile('data/demo-corpus.txt', corpus, 'utf8');
await saveCheckpoint('data/checkpoints/astracore-demo.json', {
  model,
  tokenizer,
  metadata: { type: 'demo', epochs, corpusTokens: ids.length, createdAt: new Date().toISOString() }
});
console.log('Saved data/checkpoints/astracore-demo.json');
