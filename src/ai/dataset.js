export function makeSequences(tokenIds, contextLength) {
  const samples = [];
  for (let i = 0; i + contextLength < tokenIds.length; i += contextLength) {
    samples.push({ input: tokenIds.slice(i, i + contextLength), target: tokenIds.slice(i + 1, i + contextLength + 1) });
  }
  return samples;
}

export function createBatches(samples, batchSize) {
  const batches = [];
  for (let i = 0; i < samples.length; i += batchSize) batches.push(samples.slice(i, i + batchSize));
  return batches;
}
