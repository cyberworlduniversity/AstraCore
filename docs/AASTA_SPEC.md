# AASTA — Algorithm Specification (Research v0.1)

**Project/model:** ASTRA CORE AI  
**Algorithm:** ASTRA Adaptive Semantic Tokenization Algorithm (AASTA)  
**Status:** First executable research implementation; not yet benchmark-validated as superior to BPE or Unigram.

## 1. Purpose

AASTA converts Unicode text into integer token IDs and reconstructs the exact original UTF-8 text. It is designed to learn reusable spans from Tamil, English, mixed-script, and other Unicode corpora without a pretrained vocabulary. Unknown text remains representable through a 256-value raw-byte fallback.

AASTA is a tokenizer, not a complete language model and not a semantic reasoning system. Semantic understanding must be learned by the model trained on token sequences.

## 2. Design

AASTA uses two distinct stages:

1. **Context-diverse vocabulary learning.** Enumerate Unicode-code-point-aligned spans up to a configurable UTF-8 byte length. Count each span and record the number of distinct left and right neighboring code points observed in the corpus.
2. **Optimal reversible segmentation.** At inference, use dynamic programming over the UTF-8 byte sequence. Learned tokens may begin and end only at Unicode code-point boundaries. Every byte remains available as a fallback token, guaranteeing that unseen strings can still be encoded.

This is not pair-merging BPE. The vocabulary is selected directly from candidate spans using a corpus score, then inference selects a segmentation by dynamic programming.

## 3. Vocabulary score

For candidate span t:

- f(t): corpus occurrence count
- L(t): UTF-8 byte length
- D(t): number of distinct left contexts plus distinct right contexts
- alpha: configurable context weight (default 0.25)

The selection score is:

**S(t) = ln(1 + f(t)) × (L(t) − 1) × [1 + alpha × ln(1 + D(t))]**

Candidates below min_frequency are discarded. Remaining candidates are sorted by descending S(t), with raw UTF-8 bytes as a deterministic tie-breaker. The top vocab_size − 256 candidates are retained.

Interpretation: frequent spans that save more bytes and appear across varied contexts are favored. This is a statistical selection heuristic; it does not prove that a span has semantic meaning.

## 4. Inference segmentation

Let B be the UTF-8 byte sequence. At each byte offset i, dynamic programming compares:
- one raw-byte fallback token, with zero byte-saving utility; and
- every learned token beginning at i and ending at a valid Unicode code-point boundary.

For a learned token t, utility is:

**U(t) = L(t) − 1 + min(0.20, 0.02 ln(1 + f(t)) + 0.01 ln(1 + D(t)))**

The recurrence maximizes total utility from each position to the end of the byte sequence. A deterministic traversal and tie policy make encoding reproducible. The small bounded bonus breaks close choices but cannot outweigh the byte savings of a longer token.

## 5. Correctness invariants

- IDs 0–255 represent literal byte values.
- IDs 256 onward represent learned UTF-8-valid spans.
- Encoding an arbitrary Python string and decoding its IDs must reproduce the exact original string.
- Unknown text must encode using the byte fallback.
- Learned spans must be valid UTF-8 and are selected on code-point boundaries.
- Invalid IDs, malformed model files, and invalid UTF-8 token streams must fail clearly.

## 6. Complexity

Let N be the number of Unicode code points in the training corpus, M the configured maximum candidate span length in bytes, V the learned vocabulary size, and T the input byte length.

- Training candidate enumeration is approximately O(N × M), with memory proportional to distinct candidate spans and their context sets.
- Vocabulary ranking is O(C log C), where C is the number of distinct eligible candidates.
- Encoding uses trie traversal and dynamic programming; practical work depends on the maximum token length and matches at each position. Memory is O(T).
- Decoding is O(total decoded bytes).

Large-corpus streaming, bounded candidate tables, grapheme-cluster-aware boundaries, and optimized native/mobile implementations are future engineering work.

## 7. Current limitations

- Context diversity is a statistical proxy, not semantic understanding.
- Unicode code points are not the same as user-perceived grapheme clusters; some combining sequences may be split between adjacent tokens, although exact round-trip is preserved.
- The initial implementation is Python and intended for correctness experiments, not mobile-speed claims.
- It has not yet been compared on held-out Tamil/English corpora against byte-BPE and Unigram baselines.
- No claim is made that AASTA is globally novel, patentable, or better than commercial tokenizers until prior-art review and reproducible benchmarks are completed.

## 8. Validation plan

1. Run unit tests for Tamil, English, mixed scripts, emoji, unknown text, save/load, and invalid IDs.
2. Measure token count, bytes per token, encode/decode throughput, vocabulary size, and peak memory.
3. Compare against byte-level BPE and Unigram on the same held-out corpus and vocabulary budget.
4. Report results separately for Tamil, English, and mixed-language samples.
5. Only change scoring weights or segmentation rules when a benchmark demonstrates a measurable improvement.

## 9. Reproducibility

The model file stores algorithm/version metadata, token bytes in hexadecimal, frequency, context diversity, and context weight. Candidate sorting uses a stable bytewise tie-breaker. Training corpus provenance, license, language balance, and a cryptographic corpus hash should be recorded for every published experiment.
