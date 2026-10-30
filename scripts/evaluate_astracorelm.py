import argparse, json
from pathlib import Path
import torch
from model.config import ModelConfig
from model.model import AstraCoreLM
from model.tokenizer import AstraTokenizer

def main():
    p=argparse.ArgumentParser(); p.add_argument('--checkpoint',required=True); p.add_argument('--corpus',required=True); a=p.parse_args()
    d=Path(a.checkpoint); cfg=ModelConfig.from_dict(json.loads((d/'config.json').read_text())); tok=AstraTokenizer.load(d/'tokenizer.json'); state=torch.load(d/'checkpoint.pt',map_location='cpu',weights_only=False); model=AstraCoreLM(cfg); model.load_state_dict(state['model']); model.eval()
    ids=tok.encode(Path(a.corpus).read_text(encoding='utf-8')); context=cfg.context_length; vals=[]
    with torch.no_grad():
        for pos in range(0,max(1,len(ids)-context),context):
            seq=ids[pos:pos+context+1]
            if len(seq)<3: continue
            x=torch.tensor([seq[:-1]]); y=torch.tensor([seq[1:]]); _,loss=model(x,y); vals.append(float(loss))
    loss=sum(vals)/max(1,len(vals)); print(json.dumps({'status':'evaluated','loss':loss,'perplexity':float(torch.exp(torch.tensor(loss))),'checkpoint':str(d),'corpus_sha256':state.get('corpus_sha256')},indent=2))

if __name__=='__main__': main()
