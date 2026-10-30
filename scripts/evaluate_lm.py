import argparse
import json
import math
from pathlib import Path

import torch

from model.config import ModelConfig
from model.model import AstraCoreLM
from model.tokenizer import AstraTokenizer


def main():
    p=argparse.ArgumentParser(); p.add_argument('--checkpoint',required=True); p.add_argument('--text',required=True); args=p.parse_args()
    root=Path(args.checkpoint)
    config=ModelConfig.from_dict(json.loads((root/'config.json').read_text(encoding='utf-8')))
    tokenizer=AstraTokenizer.load(root/'tokenizer.json')
    state=json.loads((root/'training_state.json').read_text(encoding='utf-8'))
    model=AstraCoreLM(config); payload=torch.load(root/'model.pt',map_location='cpu',weights_only=False); model.load_state_dict(payload['model']); model.eval()
    ids=tokenizer.encode(Path(args.text).read_text(encoding='utf-8',errors='ignore'))
    width=config.context_length+1; losses=[]
    with torch.no_grad():
        for i in range(0,max(0,len(ids)-width+1),config.context_length):
            row=ids[i:i+width]
            if len(row)<width: continue
            x=torch.tensor(row[:-1]).unsqueeze(0); y=torch.tensor(row[1:]).unsqueeze(0); _,loss=model(x,y); losses.append(float(loss))
    loss=sum(losses)/max(1,len(losses)); result={'checkpoint':str(root),'validation_loss':loss,'perplexity':math.exp(min(20,loss)),'stored_training_state':state}
    print(json.dumps(result,indent=2))

if __name__=='__main__': main()
