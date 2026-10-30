import argparse, hashlib, json, math, platform, random, time
from pathlib import Path
import torch
from torch.utils.data import DataLoader, Dataset
from model.config import ModelConfig
from model.model import AstraCoreLM
from model.tokenizer import AstraTokenizer

class Blocks(Dataset):
    def __init__(self, ids, n):
        w=n+1; self.rows=[torch.tensor(ids[i:i+w],dtype=torch.long) for i in range(0,max(0,len(ids)-w+1),n) if len(ids[i:i+w])==w]
        if not self.rows: raise ValueError('split too small for one complete token block')
    def __len__(self): return len(self.rows)
    def __getitem__(self,i):
        r=self.rows[i]; return r[:-1],r[1:]

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def eval_model(model, ds, batch):
    model.eval(); total=0.0; count=0; tokens=0
    with torch.no_grad():
        for x,y in DataLoader(ds,batch_size=batch,shuffle=False):
            _,loss=model(x,y); total += float(loss); count += 1; tokens += y.numel()
    if not count: raise ValueError('empty evaluation')
    loss=total/count
    return loss, (math.exp(loss) if loss<700 else float('inf')), tokens

def main():
    p=argparse.ArgumentParser(); p.add_argument('--dataset',required=True); p.add_argument('--output',required=True); p.add_argument('--seed',type=int,default=42); p.add_argument('--vocab-size',type=int,default=4096); p.add_argument('--context-length',type=int,default=128); p.add_argument('--embedding-dimension',type=int,default=128); p.add_argument('--layers',type=int,default=4); p.add_argument('--heads',type=int,default=4); p.add_argument('--ffn',type=int,default=512); p.add_argument('--dropout',type=float,default=0.1); p.add_argument('--epochs',type=int,default=5); p.add_argument('--batch-size',type=int,default=8); p.add_argument('--lr',type=float,default=3e-4); a=p.parse_args()
    random.seed(a.seed); torch.manual_seed(a.seed); torch.set_num_threads(max(1,min(4,(torch.get_num_threads() or 1))))
    root=Path(a.dataset); out=Path(a.output); out.mkdir(parents=True,exist_ok=True)
    records=[json.loads(x) for x in (root/'records.jsonl').read_text(encoding='utf-8').splitlines() if x.strip()]
    splits={s:[r for r in records if r['split']==s] for s in ('train','validation','test')}
    if any(not splits[s] for s in splits): raise ValueError('all three splits must be non-empty')
    if set(r['document_id'] for r in splits['train']) & set(r['document_id'] for r in splits['validation']): raise ValueError('document leakage train/validation')
    if set(r['document_id'] for r in splits['train']) & set(r['document_id'] for r in splits['test']): raise ValueError('document leakage train/test')
    if set(r['document_id'] for r in splits['validation']) & set(r['document_id'] for r in splits['test']): raise ValueError('document leakage validation/test')
    texts={s:'\n\n'.join(r['text'] for r in splits[s]) for s in splits}
    tok=AstraTokenizer.build([texts['train']],a.vocab_size); tok_path=out/'tokenizer.json'; tok.save(tok_path)
    tokenizer_sha=sha(tok_path)
    cfg=ModelConfig(vocab_size=tok.vocab_size,context_length=a.context_length,embedding_dimension=a.embedding_dimension,number_of_layers=a.layers,attention_heads=a.heads,feed_forward_dimension=a.ffn,dropout=a.dropout,tokenizer_sha256=tokenizer_sha)
    config_path=out/'model-config.json'; config_path.write_text(json.dumps(cfg.to_dict(),indent=2)+'\n',encoding='utf-8')
    config_sha=sha(config_path)
    ids={s:tok.encode(texts[s]) for s in splits}; ds={s:Blocks(ids[s],a.context_length) for s in splits}
    model=AstraCoreLM(cfg); optimizer=torch.optim.AdamW(model.parameters(),lr=a.lr); loader=DataLoader(ds['train'],batch_size=a.batch_size,shuffle=True)
    best=float('inf'); best_epoch=0; history=[]; start=time.perf_counter()
    for epoch in range(1,a.epochs+1):
        model.train(); train_total=0.0; batches=0
        for x,y in loader:
            optimizer.zero_grad(set_to_none=True); _,loss=model(x,y); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(),1.0); optimizer.step(); train_total+=float(loss); batches+=1
        train_loss=train_total/max(1,batches); val_loss,val_ppl,val_tokens=eval_model(model,ds['validation'],a.batch_size); history.append({'epoch':epoch,'train_loss':train_loss,'validation_loss':val_loss,'validation_perplexity':val_ppl,'validation_tokens':val_tokens})
        print(json.dumps(history[-1]))
        if val_loss<best:
            best=val_loss; best_epoch=epoch
            torch.save({'model':model.state_dict(),'config':cfg.to_dict(),'model_version':'astracorelm-v0.1','dataset_version':'0.1.0','dataset_sha256':sha(root/'records.jsonl'),'tokenizer_sha256':tokenizer_sha,'config_sha256':config_sha,'optimizer':optimizer.state_dict(),'epoch':epoch,'seed':a.seed},out/'checkpoint.pt')
    checkpoint_sha=sha(out/'checkpoint.pt')
    # Reload the selected best checkpoint before final test evaluation.
    payload=torch.load(out/'checkpoint.pt',map_location='cpu',weights_only=False); reloaded=AstraCoreLM(ModelConfig.from_dict(payload['config'])); reloaded.load_state_dict(payload['model']); reloaded.eval()
    test_loss,test_ppl,test_tokens=eval_model(reloaded,ds['test'],a.batch_size)
    sample='Aurora is a fictional AstraCore project. Its release identifier is AURORA-7421.'
    sample_ids=torch.tensor([tok.encode(sample)],dtype=torch.long); t0=time.perf_counter(); _=reloaded.next_token(sample_ids); latency=(time.perf_counter()-t0)*1000
    runtime={'reload_verified':True,'generation_single_step_ms':latency,'parameter_count':sum(p.numel() for p in reloaded.parameters()),'device':str(next(reloaded.parameters()).device)}
    training={'model_version':'astracorelm-v0.1','architecture_version':cfg.architecture_version,'python_version':platform.python_version(),'torch_version':torch.__version__,'seed':a.seed,'epochs':a.epochs,'batch_size':a.batch_size,'learning_rate':a.lr,'context_length':a.context_length,'vocab_size':tok.vocab_size,'best_epoch':best_epoch,'history':history,'best_validation_loss':best,'best_validation_perplexity':math.exp(best) if best<700 else float('inf'),'test_loss':test_loss,'test_perplexity':test_ppl,'test_tokens':test_tokens,'dataset_sha256':sha(root/'records.jsonl'),'tokenizer_sha256':tokenizer_sha,'config_sha256':config_sha,'checkpoint_sha256':checkpoint_sha,'checkpoint_path':str(out/'checkpoint.pt'),'runtime':runtime,'status':'EXPERIMENTAL_CHECKPOINT_READY'}
    (out/'training_state.json').write_text(json.dumps(training,indent=2)+'\n',encoding='utf-8')
    (out/'test_evaluation.json').write_text(json.dumps({'validation_loss':best,'validation_perplexity':math.exp(best) if best<700 else float('inf'),'test_loss':test_loss,'test_perplexity':test_ppl,'test_tokens':test_tokens,'checkpoint_sha256':checkpoint_sha},indent=2)+'\n',encoding='utf-8')
    print(json.dumps(training,indent=2))
if __name__=='__main__': main()
