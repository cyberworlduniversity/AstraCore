import argparse, json, hashlib, random
from pathlib import Path
import torch
from model.config import ModelConfig
from model.model import AstraCoreLM
from model.tokenizer import AstraTokenizer

def sha256(path):
    h=hashlib.sha256(); h.update(Path(path).read_bytes()); return h.hexdigest()

def main():
    p=argparse.ArgumentParser(); p.add_argument('--corpus',required=True); p.add_argument('--output',default='data/checkpoints/astracorelm-v0.1'); p.add_argument('--epochs',type=int,default=3); p.add_argument('--context',type=int,default=256); p.add_argument('--vocab-size',type=int,default=8192); p.add_argument('--seed',type=int,default=42); p.add_argument('--resume',default=None); a=p.parse_args()
    random.seed(a.seed); torch.manual_seed(a.seed)
    corpus=Path(a.corpus).read_text(encoding='utf-8');
    if not corpus.strip(): raise SystemExit('Corpus is empty; training aborted.')
    tok=AstraTokenizer.build([corpus],vocab_size=a.vocab_size)
    cfg=ModelConfig(vocab_size=tok.vocab_size,context_length=a.context)
    model=AstraCoreLM(cfg); opt=torch.optim.AdamW(model.parameters(),lr=3e-4)
    start=0
    if a.resume:
        state=torch.load(a.resume,map_location='cpu',weights_only=False); model.load_state_dict(state['model']); opt.load_state_dict(state['optimizer']); start=int(state['epoch'])
    ids=tok.encode(corpus,add_bos=True,add_eos=True); losses=[]
    for epoch in range(start,a.epochs):
        total=0.0; count=0
        for pos in range(0,max(1,len(ids)-a.context),a.context):
            seq=ids[pos:pos+a.context+1]
            if len(seq)<3: continue
            x=torch.tensor([seq[:-1]],dtype=torch.long); y=torch.tensor([seq[1:]],dtype=torch.long)
            opt.zero_grad(set_to_none=True); _,loss=model(x,y); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(),1.0); opt.step(); total+=float(loss); count+=1
        mean=total/max(1,count); losses.append(mean); print(json.dumps({'epoch':epoch+1,'loss':mean}))
        out=Path(a.output); out.mkdir(parents=True,exist_ok=True)
        torch.save({'model':model.state_dict(),'optimizer':opt.state_dict(),'epoch':epoch+1,'config':cfg.to_dict(),'corpus_sha256':sha256(a.corpus),'status':'trained'},out/'checkpoint.pt')
        tok.save(out/'tokenizer.json'); (out/'config.json').write_text(json.dumps(cfg.to_dict(),indent=2),encoding='utf-8'); (out/'training_state.json').write_text(json.dumps({'status':'trained','epoch':epoch+1,'loss_history':losses,'corpus_sha256':sha256(a.corpus),'seed':a.seed},indent=2),encoding='utf-8')

if __name__=='__main__': main()
