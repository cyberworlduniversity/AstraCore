# AstraCore v0.2 training milestone

This milestone adds the first gradient-based training path for the decoder Transformer.

## Included

- `DecoderOnlyTransformer.forwardFeatures()` exposes hidden states and logits.
- `AdamW` optimizer with first/second moments and decoupled weight decay.
- `TransformerTrainer` computes causal next-token cross-entropy and updates the LM head with analytic gradients.
- Training smoke tests verify finite loss and parameter updates.
- `npm run train:transformer` runs a small local training demonstration.

## Current boundary

The Transformer attention, feed-forward, normalization, token embeddings, and positional embeddings are currently the forward backbone. This milestone trains the output language-model head; it does **not** yet claim full end-to-end backpropagation through every Transformer parameter.

## Next milestone

Implement a complete backward pass for embeddings, layer normalization, attention projections, feed-forward layers, and positional embeddings, then add checkpointed multi-epoch dataset training and perplexity evaluation.
