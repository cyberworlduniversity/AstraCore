import argparse, hashlib, json, random
from pathlib import Path
from scripts.generate_lm_dataset import CONCEPTS, TEMPLATES


def digest_records(rows):
    h=hashlib.sha256()
    for r in rows: h.update((json.dumps(r,ensure_ascii=False,sort_keys=True)+'\n').encode())
    return h.hexdigest()


def main():
    p=argparse.ArgumentParser(); p.add_argument('--output',default='datasets/astracore-lm-v0.1'); p.add_argument('--seed',type=int,default=42); a=p.parse_args()
    root=Path(a.output); root.mkdir(parents=True,exist_ok=True)
    concepts=list(enumerate(CONCEPTS)); rng=random.Random(a.seed); rng.shuffle(concepts)
    # Split by source concept, never by chunk/template. 80/10/10 concepts => 960/120/120 records.
    groups={'train':set(i for i,_ in concepts[:80]),'validation':set(i for i,_ in concepts[80:90]),'test':set(i for i,_ in concepts[90:])}
    records=[]
    for ci,(name,fact) in enumerate(CONCEPTS):
        split=next(k for k,v in groups.items() if ci in v)
        for vi,t in enumerate(TEMPLATES):
            text=t.format(name=name,fact=fact)
            records.append({'id':f'c{ci:03d}-v{vi:02d}','text':text,'source':'original-astracore-engineering-curriculum','license':'CC0-1.0','document_id':f'concept-{ci:03d}','concept':name,'split':split,'content_sha256':hashlib.sha256(text.encode()).hexdigest()})
    records.sort(key=lambda r:r['id'])
    ids={k:[r['id'] for r in records if r['split']==k] for k in groups}
    assert not (set(ids['train'])&set(ids['validation']) or set(ids['train'])&set(ids['test']) or set(ids['validation'])&set(ids['test']))
    docs={k:{r['document_id'] for r in records if r['split']==k} for k in groups}
    assert not (docs['train']&docs['validation'] or docs['train']&docs['test'] or docs['validation']&docs['test'])
    with (root/'records.jsonl').open('w',encoding='utf-8') as f:
        for r in records: f.write(json.dumps(r,ensure_ascii=False,sort_keys=True)+'\n')
    for split in groups:
        rows=[r['text'] for r in records if r['split']==split]
        (root/f'{split}.txt').write_text('\n\n'.join(rows)+'\n',encoding='utf-8')
    metadata={'dataset_id':'astracore-lm-v0.1','dataset_version':'0.1.0','source':'original-astracore-engineering-curriculum','license':'CC0-1.0','generation_seed':a.seed,'record_count':len(records),'document_count':len(CONCEPTS),'train_count':len(ids['train']),'validation_count':len(ids['validation']),'test_count':len(ids['test']),'train_sha256':digest_records([r for r in records if r['split']=='train']),'validation_sha256':digest_records([r for r in records if r['split']=='validation']),'test_sha256':digest_records([r for r in records if r['split']=='test']),'dataset_sha256':digest_records(records),'split_method':'concept-level deterministic 80/10/10; all templates from one concept stay in one split','provenance':'Original CC0-1.0 AstraCore engineering curriculum; no third-party corpus.'}
    (root/'metadata.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(metadata,indent=2))
if __name__=='__main__': main()
