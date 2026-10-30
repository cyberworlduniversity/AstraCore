import argparse, hashlib, json, random
from pathlib import Path
try:
    from .generate_lm_dataset import CONCEPTS
except ImportError:
    from generate_lm_dataset import CONCEPTS

BASE_TEMPLATES = [
    'Question: What is {name}?\nAnswer: {fact}',
    'Instruction: Define {name} in one sentence.\nResponse: {fact}',
    'Instruction: Explain {name} for an AstraCore engineer.\nResponse: {fact}',
    'Question: Why does {name} matter?\nAnswer: {fact}',
    'Instruction: Give a safe engineering rule for {name}.\nResponse: {fact}',
    'Instruction: State one production verification principle for {name}.\nResponse: {fact} Verification must be evidence based.',
    'AstraCore note about {name}: {fact}',
    'Developer checklist: {name}. Evidence: {fact}',
    'Question: What common risk is addressed by {name}?\nAnswer: {fact}',
    'Instruction: Summarize {name} briefly.\nResponse: {fact}',
    'Instruction: Return exactly three bullet points about {name}.\nResponse:\n- Definition: {fact}\n- Safety: Apply least privilege and validate inputs.\n- Verification: Measure the concrete behavior with tests.',
    'Instruction: Return JSON with fields name, version, and status for {name}.\nResponse: {{"name":"{name}","version":"astracorelm-v0.2","status":"experimental"}}',
    'Instruction: If the supplied context does not contain the answer, say you do not know. Context: {fact}\nQuestion: What is {name}?\nResponse: {fact}',
    'Context: {fact}\nQuestion: What is {name}?\nAnswer: {fact}',
    'Context: {fact}\nQuestion: What is an unsupported secret for {name}?\nAnswer: I do not know from the supplied context.',
    'Instruction: Explain {name} without inventing facts.\nResponse: {fact}',
]

def digest_rows(rows):
    h = hashlib.sha256()
    for row in rows:
        h.update((json.dumps(row, ensure_ascii=False, sort_keys=True) + '\n').encode())
    return h.hexdigest()

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--output', default='datasets/astracore-lm-v0.2')
    p.add_argument('--seed', type=int, default=42)
    a = p.parse_args()
    root = Path(a.output)
    root.mkdir(parents=True, exist_ok=True)
    concepts = list(enumerate(CONCEPTS))
    rng = random.Random(a.seed)
    rng.shuffle(concepts)
    groups = {
        'train': {i for i, _ in concepts[:80]},
        'validation': {i for i, _ in concepts[80:90]},
        'test': {i for i, _ in concepts[90:]},
    }
    records = []
    for concept_id, (name, fact) in enumerate(CONCEPTS):
        split = next(s for s, ids in groups.items() if concept_id in ids)
        for variant_id, template in enumerate(BASE_TEMPLATES):
            text = template.format(name=name, fact=fact)
            records.append({
                'id': f'v2-c{concept_id:03d}-t{variant_id:02d}',
                'text': text,
                'source': 'original-astracore-engineering-curriculum',
                'license': 'CC0-1.0',
                'document_id': f'concept-{concept_id:03d}',
                'concept': name,
                'split': split,
                'content_sha256': hashlib.sha256(text.encode()).hexdigest(),
            })
    records.sort(key=lambda r: r['id'])
    root.joinpath('records.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False, sort_keys=True) + '\n' for r in records), encoding='utf-8')
    for split in groups:
        rows = [r['text'] for r in records if r['split'] == split]
        root.joinpath(f'{split}.txt').write_text('\n\n'.join(rows) + '\n', encoding='utf-8')
    split_hashes = {s: digest_rows([r for r in records if r['split'] == s]) for s in groups}
    docs = {s: {r['document_id'] for r in records if r['split'] == s} for s in groups}
    assert not (docs['train'] & docs['validation'] or docs['train'] & docs['test'] or docs['validation'] & docs['test'])
    assert len({r['id'] for r in records}) == len(records)
    assert len({r['content_sha256'] for r in records}) == len(records)
    metadata = {
        'dataset_id': 'astracore-lm-v0.2',
        'dataset_version': '0.2.0',
        'source': 'original-astracore-engineering-curriculum',
        'license': 'CC0-1.0',
        'generation_seed': a.seed,
        'concept_count': len(CONCEPTS),
        'record_count': len(records),
        'train_count': sum(r['split'] == 'train' for r in records),
        'validation_count': sum(r['split'] == 'validation' for r in records),
        'test_count': sum(r['split'] == 'test' for r in records),
        'train_sha256': split_hashes['train'],
        'validation_sha256': split_hashes['validation'],
        'test_sha256': split_hashes['test'],
        'dataset_sha256': hashlib.sha256(root.joinpath('records.jsonl').read_bytes()).hexdigest(),
        'split_method': 'concept-level deterministic 80/10/13; all templates from one concept remain in one split',
        'change_summary': 'Added instruction, grounding, structured-output, and unknown-information training patterns while retaining original concepts.',
        'provenance': 'Original CC0-1.0 AstraCore engineering curriculum; no third-party or private corpus.',
    }
    root.joinpath('metadata.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(metadata, indent=2))

if __name__ == '__main__':
    main()
