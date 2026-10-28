import { DecoderOnlyTransformer } from "../src/ai/transformer.js";
import { TransformerTrainer } from "../src/ai/training.js";

const model = new DecoderOnlyTransformer({
  vocabSize: 64,
  contextLength: 16,
  dModel: 32,
  heads: 4,
  ffDim: 64,
  layers: 1,
  seed: 7
});

const trainer = new TransformerTrainer(model, { learningRate: 0.01, weightDecay: 0.001 });
const input = [1, 2, 3, 4, 5, 6, 7, 8];
const target = [2, 3, 4, 5, 6, 7, 8, 9];

for (let step = 1; step <= 10; step++) {
  const result = trainer.trainStep(input, target);
  console.log(JSON.stringify(result));
}
