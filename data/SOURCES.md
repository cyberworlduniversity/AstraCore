# ASTRA CORE AI corpus preparation

Raw third-party corpora are not redistributed in this repository. Download UTF-8, one-record-per-line text files and place them under `data/raw/`.

## Initial sources

- Tamil: [AI4Bharat IndicCorp v2](https://huggingface.co/datasets/ai4bharat/IndicCorpV2), config `indiccorp_v2`, split `tam_Taml`. The dataset card states CC0-1.0. Its current Hub structure lists about 12.1M Tamil rows.
- English: [Wikimedia English dump](https://dumps.wikimedia.org/enwiki/). Wikimedia text is generally CC BY-SA 4.0. Preserve attribution and ShareAlike obligations and verify the exact dump terms before use.

The source manifest records the origin, language and license. The preparation script rejects licenses outside its explicit allowlist. Non-commercial-only sources are excluded.

## Prepare a reproducible sample

After obtaining the source text files:

```bash
python data/prepare_corpus.py --max-lines-per-source 100000 --eval-percent 10
```

Outputs: `data/prepared/train.txt`, `data/prepared/eval.txt`, and `data/prepared/manifest.json`. The manifest records source URLs, licenses, input SHA-256 hashes, counts, preprocessing, and output hashes. Lines are NFC-normalized, whitespace-collapsed, globally deduplicated, and deterministically split by content hash.

The 100,000-line cap is an initial sample, not a full-scale corpus. Increase it only after profiling memory and runtime. Keep raw and prepared text out of Git; share the manifest and benchmark report instead.

Citation: Doddapaneni et al. (2023), ACL 2023, “Towards Leaving No Indic Language Behind: Building Monolingual Corpora, Benchmark and Models for Indic Languages”, https://aclanthology.org/2023.acl-long.693.
