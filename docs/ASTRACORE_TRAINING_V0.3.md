# AstraCore v0.3 — full Transformer backpropagation

This milestone upgrades the local Transformer from LM-head-only training to end-to-end gradient propagation through the decoder stack.

## Included

- Causal multi-head self-attention backward pass for Q/K/V and output projection.
- Feed-forward backward pass for both linear layers and ReLU.
- LayerNorm backward pass including scale and bias gradients.
- Token and positional embedding gradients.
- AdamW updates across all trainable Transformer parameters.
- Gradient-norm clipping for stable small-model training.
- Tests that verify finite gradients and parameter updates beyond the LM head.
- A repeated-sequence learning test that requires training loss to decrease.

## Training boundary

AstraCore is still a small experimental local model. Full backpropagation means the implemented model parameters can receive analytic gradients; it does not mean the model has been pretrained to general-purpose language-model quality.

## Next milestone

Add dataset loaders, checkpoint save/resume for Transformer weights plus optimizer state, multi-epoch training, validation loss, perplexity reporting, and a reproducible tiny corpus training command.
