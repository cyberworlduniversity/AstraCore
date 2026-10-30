# AstraCore v1.0 implementation status

This document is the authoritative gate for Steps 16-27. A component is only marked production-ready when its runtime implementation and evaluation evidence exist.

## Implemented in repository

- Step 16 dataset validation, provenance, training pipeline, checkpoint loader, retrieval evaluation, 384-D contract and Supabase dataset/evaluation registry.
- Step 17 native AstraCoreLM transformer, tokenizer/vocabulary, corpus builder, resumable checkpoint training, generation and quality evaluation.
- Step 18 v1 pipeline contract: router -> knowledge/memory/tools -> grounded context -> model -> sources -> answer.
- Step 19 memory schema/foundation and user-isolated memory APIs already present; v1 context builder accepts approved memory records.
- Step 20 tool registry, risk metadata and v1 agent execution engine with authorization, timeout and result verification.
- Step 21 multimodal file contracts and existing document extraction foundation; image/audio/video/OCR adapters remain explicit capability boundaries until implemented.
- Step 22 web research pipeline contract with search/fetch/verify/rank/cite boundaries.
- Step 23 coding intelligence contract and secure review checklist.
- Step 24 planner/agent roles and bounded multi-step execution.
- Step 25 safety layer: instruction hierarchy, retrieved-data isolation, injection classification, secret redaction, high-risk authorization and result verification.
- Step 26 evaluation metric registry and promotion gate logic.
- Step 27 final architecture manifest and exports.

## Promotion blockers

AstraCore must not claim production completion until the following real evidence exists:

1. An approved, traceable semantic-pair dataset is supplied.
2. AstraCoreEmbed is trained on that dataset and produces a real 384-D checkpoint.
3. Held-out retrieval evaluation passes the configured gate.
4. The validated embedding checkpoint is registered/promoted in Supabase.
5. An approved LM corpus is supplied and its provenance/license is recorded.
6. AstraCoreLM is trained, evaluated and checkpointed/resumable.
7. Model-quality, groundedness, hallucination, tool, memory, multilingual and cybersecurity evaluations pass.
8. Only then is the production model version promoted.

No random or untrained checkpoint is represented as production-ready.
