import hashlib, json, statistics
from pathlib import Path

BASE = {
 'test_ppl': 431457.82366694347,
 'test_loss': 12.97492504119873,
 'validation_ppl': 294120.3813569566,
 'validation_loss': 12.591744422912598,
 'checkpoint_sha256': '0e1461c110eae7b055b041cb535f2182dec71834cbaf14f68e0e79be460eee3f',
 'tokenizer_sha256': '0beaf889d4d7bf49d90a970f50dd56b14eeb54453851501722b0fded2aedd8a2',
}

def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def main():
    root=Path('datasets/astracore-lm-v0.2'); art=Path('artifacts/astracore-lm-v0.2')
    meta=json.loads((root/'metadata.json').read_text()); state=json.loads((art/'training_state.json').read_text()); behavior=json.loads((art/'behavioral_evaluation.json').read_text())
    rows=[json.loads(x) for x in (root/'records.jsonl').read_text().splitlines() if x.strip()]
    lengths=[]; bos=eos=unk=pad=empty=0
    from model.tokenizer import AstraTokenizer
    tok=AstraTokenizer.load(art/'tokenizer.json')
    for r in rows:
        ids=tok.encode(r['text'])
        lengths.append(len(ids)); bos += int(bool(ids and ids[0]==tok.bos_id)); eos += int(bool(ids and ids[-1]==tok.eos_id)); unk += ids.count(tok.unk_id)
        empty += int(not r['text'].strip())
    stats={'records':len(rows),'min_tokens':min(lengths),'max_tokens':max(lengths),'mean_tokens':statistics.mean(lengths),'median_tokens':statistics.median(lengths),'bos_frequency':bos/len(rows),'eos_frequency':eos/len(rows),'unk_count':unk,'padding_frequency':'0 in serialized records; padding is batch-local and masked','empty_records':empty,'duplicate_ids':len(rows)-len({r['id'] for r in rows}),'duplicate_content_hashes':len(rows)-len({r['content_sha256'] for r in rows})}
    cats=behavior['behavioral_summary']; passed=sum(v=='PASS' for v in cats.values()); total=len(cats)
    if state['test_perplexity'] < BASE['test_ppl'] and passed >= 8 and cats.get('context_grounding')=='PASS' and cats.get('instruction_following')=='PASS' and cats.get('structured_output')=='PASS' and cats.get('unknown_information')=='PASS': decision='EXPERIMENTAL_CANDIDATE_READY'
    elif state['test_perplexity'] < BASE['test_ppl'] or passed >= 3: decision='SUBSTANTIAL_IMPROVEMENT' if passed >= 6 else 'PARTIAL_IMPROVEMENT'
    else: decision='NO_IMPROVEMENT'
    diagnosis={
      'step':'5','status':'completed','baseline':BASE,
      'findings':[
        {'failure':'cross-record fixed-block training','evidence':'Step 3 train/eval code concatenated all records then cut fixed 129-token windows.','classification':'CONFIRMED','cause':'record boundaries were not preserved during LM training/evaluation.','fix':'v0.2 trains and evaluates each record independently with BOS/EOS and batch-local padding.'},
        {'failure':'padding was not modeled','evidence':'Step 3 Blocks contained only fixed full windows; no padding mask existed in the model.','classification':'CONFIRMED','cause':'the v0.1 pipeline had no variable-length record representation.','fix':'v0.2 uses a key-padding mask and ignores PAD targets in loss.'},
        {'failure':'BOS/EOS context overflow','evidence':'tokenizer adds BOS and EOS; context length was 128.','classification':'CONFIRMED','cause':'raw encoded length could exceed positional embedding capacity.','fix':'v0.2 caps encoded sequences at 128 and rejects runtime inputs above the model context.'},
        {'failure':'causal loss alignment','evidence':'v0.1 uses x=window[:-1], y=window[1:] and cross entropy over matching logits.','classification':'CONFIRMED_AS_CORRECT','cause':'no loss-shift defect found.','fix':'retained with targeted regression tests.'},
        {'failure':'causal attention mask','evidence':'v0.1 constructs upper-triangular boolean future-token mask.','classification':'CONFIRMED_AS_CORRECT','cause':'future positions are masked.','fix':'retained and regression-tested.'},
        {'failure':'model capacity / training objective fit','evidence':'Step 4 showed severe degeneration and the v0.1 corpus was mostly declarative template continuation.','classification':'LIKELY','cause':'small model plus weak instruction/behavioral coverage may limit useful generation.','fix':'v0.2 increases width and adds instruction, structured-output, grounding and unknown-information patterns without changing test concepts across splits.'},
        {'failure':'tokenizer','evidence':'v0.1 special-token definitions are stable and v0.2 round-trip tests cover English, Tamil, punctuation and numbers.','classification':'NOT_CONFIRMED_AS_ROOT_CAUSE','cause':'no tokenizer defect was demonstrated.','fix':'retain astratokenizer-v0.1 rather than changing hashes without evidence.'},
      ],
      'dataset_audit':stats,
      'decision':decision,
      'production_approved':False,
    }
    Path('docs').mkdir(exist_ok=True)
    Path('docs/astracorelm-step5-diagnosis.json').write_text(json.dumps(diagnosis,indent=2,ensure_ascii=False)+'\n')
    md=['# AstraCoreLM Step 5 Diagnosis','','Production approval remains closed.','', '## Confirmed findings']
    for f in diagnosis['findings']: md.append(f"- **{f['classification']} — {f['failure']}**: {f['cause']} Fix: {f['fix']}")
    md += ['', '## Dataset audit', json.dumps(stats,indent=2), '', '## Decision', decision]
    Path('docs/astracorelm-step5-diagnosis.md').write_text('\n'.join(md)+'\n')
    experiments={'step':'5','baseline_experiment':{'id':'step3-immutable','dataset_version':'0.1.0','test_ppl':BASE['test_ppl'],'checkpoint_sha256':BASE['checkpoint_sha256']},'experiments':[{'id':'step5-v02-main','dataset_version':meta['dataset_version'],'dataset_sha256':meta['dataset_sha256'],'tokenizer_version':state['model_version'].replace('astracorelm','astratokenizer') if False else 'astratokenizer-v0.1','tokenizer_sha256':state['tokenizer_sha256'],'architecture_version':state['architecture_version'],'architecture_sha256':state['config_sha256'],'seed':state['seed'],'hyperparameters':{'epochs':state['epochs'],'batch_size':state['batch_size'],'learning_rate':state['learning_rate'],'weight_decay':state['weight_decay']},'training_result':{'best_epoch':state['best_epoch'],'validation_loss':state['best_validation_loss'],'validation_ppl':state['best_validation_perplexity']},'test_result':{'loss':state['test_loss'],'ppl':state['test_perplexity']},'behavioral_result':cats,'checkpoint_sha256':state['checkpoint_sha256'],'decision':decision}]}
    Path('docs/astracorelm-step5-experiments.json').write_text(json.dumps(experiments,indent=2)+'\n')
    report={'step':'5','candidate':'astracorelm-v0.2','dataset':meta,'training':state,'behavioral':behavior,'production_approved':False,'decision':decision}
    Path('docs/astracorelm-step5-training-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    comparison={'baseline':BASE,'candidate':{'validation_loss':state['best_validation_loss'],'validation_ppl':state['best_validation_perplexity'],'test_loss':state['test_loss'],'test_ppl':state['test_perplexity'],'checkpoint_sha256':state['checkpoint_sha256'],'tokenizer_sha256':state['tokenizer_sha256'],'architecture':state['architecture_version'],'behavioral':cats},'decision':decision,'production_approved':False}
    Path('docs/astracorelm-step5-comparison.json').write_text(json.dumps(comparison,indent=2)+'\n')
    lines=['# AstraCoreLM Step 5 Comparison','','| Metric | Step 3 | Step 5 | Result |','|---|---:|---:|---|']
    for label,b,c in [('Validation loss',BASE['validation_loss'],state['best_validation_loss']),('Validation PPL',BASE['validation_ppl'],state['best_validation_perplexity']),('Test loss',BASE['test_loss'],state['test_loss']),('Test PPL',BASE['test_ppl'],state['test_perplexity'])]: lines.append(f'| {label} | {b} | {c} | {"IMPROVED" if c < b else "REGRESSED" if c > b else "UNCHANGED"} |')
    lines += ['', '## Behavioral categories']
    for k,v in cats.items(): lines.append(f'- {k}: **{v}**')
    lines += ['', f'## Step 5 classification', f'**{decision}**', '', 'Production approval: **CLOSED**']
    Path('docs/astracorelm-step5-comparison.md').write_text('\n'.join(lines)+'\n')

if __name__=='__main__': main()
