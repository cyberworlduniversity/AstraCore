# ASTRA CORE AI corpus sources and licensing

Raw third-party corpora are not committed to this repository. Raw and prepared files are ignored by Git.

## Selected starter sources

- Tamil: [mozhi-ai/tamil-corpus](https://huggingface.co/datasets/mozhi-ai/tamil-corpus). The dataset card describes a 547k-row corpus with mixed row-level licenses. The downloader retains only rows explicitly labeled `CC-0` or `public-domain`, and applies minimum quality and language scores. It rejects CC-BY-SA rows rather than mixing license terms. The repository card itself is CC BY-SA 4.0; preserve attribution and review current row-level terms before redistribution.
- English: [Salesforce/WikiText](https://huggingface.co/datasets/Salesforce/wikitext), configuration `wikitext-2-raw-v1`, training split. Its dataset card identifies CC BY-SA 4.0 and also lists GFDL in metadata. Preserve attribution and ShareAlike obligations; review original source terms before redistribution.

The larger [AI4Bharat IndicCorp v2](https://huggingface.co/datasets/ai4bharat/IndicCorpV2) Tamil split contains about 12.1 million rows; its README states CC0 for datasets created as part of the work. Its raw Tamil file is about 11.8 GB, so it is documented as a future large-scale source rather than copied into Git.

## Download a capped sample

```bash
python -m pip install datasets
python data/download_hf_corpora.py --tamil-max-rows 50000 --english-max-rows 30000 --quality-min 0.8
python data/prepare_corpus.py --max-lines-per-source 50000 --eval-percent 10
```

The downloader streams the datasets, writes UTF-8 files under `data/raw/`, and records row counts, filters, and SHA-256 hashes in `download_manifest.json`. The preparation script creates deterministic train/evaluation files and a provenance manifest.

These caps create a starter benchmark sample, not a complete copy of either dataset. Increase limits only after profiling memory and runtime. Record source revision, retrieval date, filters, and machine details in any research report.

Citation: Doddapaneni et al. (2023), “Towards Leaving No Indic Language Behind: Building Monolingual Corpora, Benchmark and Models for Indic Languages,” ACL 2023: https://aclanthology.org/2023.acl-long.693.
