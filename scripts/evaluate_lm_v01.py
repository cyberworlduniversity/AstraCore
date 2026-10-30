import argparse, hashlib, json, math, time
from pathlib import Path
import torch
from torch.utils.data import DataLoader, Dataset
from model.config import ModelConfig
from model.model import AstraCoreLM
from model.tokenizer import AstraTokenizer
class Blocks(Dataset):
    def __init__(self,ids,n):
        w=n+1; self.rows=[torch.tensor(ids[i:i+w],dtype=torch.long) for i in range(0,max(0,len(ids)-w+1),n) if len(ids[i:i+w])==w]
    def __len__(self): return len(self.rows)
    def __getitem__(self,i): r=self.rows[i]; return r[:-1],r[1:]
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def score(model,ds,batch):
    model.eval(); total=0.; n=0; tokens=0
    with torch.no_grad():
        for x,y in DataLoader(ds,batch_size=batch,shuffle=False):
            _,loss=model(x,y); total+=float(loss); n+=1; tokens+=y.numel()
    if not n: raise RuntimeError('no complete token blocks')
    loss=total/n; return loss,math.exp(loss) if loss<700 else float('inf'),tokens
def main():
    p=argparse.ArgumentParser(); p.add_argument('--dataset',required=True); p.add_argument('--checkpoint',required=True); p.add_argument('--batch-size',type=int,default=8); a=p.parse_args()
    root=Path(a.dataset); ck=Path(a.checkpoint); cfg=ModelConfig.from_dict(json.loads((ck/'model-config.json').read_text()))
    tok=AstraTokenizer.load(ck/'tokenizer.json'); actual_tok=sha(ck/'tokenizer.json')
    if actual_tok!=cfg.tokenizer_sha256: raise RuntimeError('TOKENIZER_SHA_MISMATCH')
    payload=torch.load(ck/'checkpoint.pt',map_location='cpu',weights_only=False)
    if payload['tokenizer_sha256']!=actual_tok: raise RuntimeError('CHECKPOINT_TOKENIZER_SHA_MISMATCH')
    if payload['config_sha256']!=sha(ck/'model-config.json'): raise RuntimeError('CONFIG_SHA_MISMATCH')
    model=AstraCoreLM(cfg); model.load_state_dict(payload['model']); model.eval()
    rows=[json.loads(x) for x in (root/'records.jsonl').read_text().splitlines() if x.strip()]
    texts={s:'\n\n'.join(r['text'] for r in rows if r['split']==s) for s in ('validation','test')}
    results={}
    for s in ('validation','test'):
        ds=Blocks(tok.encode(texts[s]),cfg.context_length); t=time.perf_counter(); loss,ppl,tokens=score(model,ds,a.batch_size); results[s]={'loss':loss,'perplexity':ppl,'tokens':tokens,'blocks':len(ds),'elapsed_ms':(time.perf_counter()-t)*1000}
    print(json.dumps({'checkpoint_sha256':sha(ck/'checkpoint.pt'),'tokenizer_sha256':actual_tok,'validation':results['validation'],'test':results['test'],'ppl_formula':'exp(loss) for token-level cross entropy'},indent=2))
if __name__=='__main__': main()
