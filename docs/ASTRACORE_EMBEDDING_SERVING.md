# AstraCoreEmbed serving contract

## Why this exists

The local server can run the owned AstraCoreEmbed Python checkpoint directly. A Vercel Node.js function must not assume that a Python interpreter, PyTorch installation, and model checkpoint directory are present in its bundle. For serverless deployments, use a separately hosted **AstraCore-owned** embedding service.

This does not add a commercial AI provider.

## HTTP contract

- Method: `POST`
- Path: `/v1/embeddings`
- Authentication: `Authorization: Bearer <server-only token>`
- Request JSON: `{"texts":["text 1","text 2"]}`
- Response JSON: `{"ok":true,"dimensions":384,"embeddings":[[...384 floats...]]}`

The AstraCore client:
- Requires HTTPS for remote hosts (HTTP is accepted only on loopback).
- Requires a token of at least 32 characters.
- Rejects URLs with credentials, paths, queries, or fragments.
- Uses a request timeout.
- Limits batches to 64 texts and each text to 8,000 characters.
- Requires one finite 384-dimensional vector per input text.
- Returns no vectors on network, status, or response-validation failures.

## Configuration

Set these variables only in the server/worker environment:

- `ASTRACORE_EMBEDDING_URL`
- `ASTRACORE_EMBEDDING_TOKEN`

For local development, leave the URL empty and configure `ASTRACORE_EMBED_CHECKPOINT` to a trained local checkpoint directory. The local Python adapter returns no embeddings when its checkpoint or runtime is unavailable; hybrid retrieval can then use its lexical fallback.

## Release status

The client and tests are in the development branch. The private embedding service itself is **not deployed or configured** in Vercel. AstraCoreEmbed remains experimental until a trained checkpoint is registered, the private service is deployed, and recall/latency/security evaluations pass.
