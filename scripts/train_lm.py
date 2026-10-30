import argparse
import json
import math
import random
from pathlib import Path

import torch
from torch.utils.data import DataLoader, Dataset

from model.config import ModelConfig
from model.model import AstraCoreLM
from model.tokenizer import AstraTokenizer


class TokenBlocks(Dataset):
    def __init__(self, ids, context_length):
        self.rows = []
        width = context_length + 1
        for start in range(0, max(0, len(ids) - width + 1), context_length):
            block = ids[start:start + width]
            if len(block) == width:
                self.rows.append(torch.tensor(block, dtype=torch.long))
        if not self.rows:
            raise ValueError('Corpus is too small for one training block')

    def __len__(self): return len(self.rows)
    def __getitem__(self, index):
        row = self.rows[index]
        return row[:-1], row[1:]


def read_corpus(path):
    texts = []
    for file in sorted(Path(path).rglob('*')):
        if file.is_file() and file.suffix.lower() in {'.txt', '.md', '.json', '.csv', '.html'}:
            text = file.read_text(encoding='utf-8', errors='ignore').strip()
            if text:
                texts.append(text)
    if not texts:
        raise ValueError('No approved corpus text found')
    return texts


def split_texts(texts, validation_ratio=0.1, seed=42):
    if not 0 < validation_ratio < 0.5:
        raise ValueError('validation_ratio must be between 0 and 0.5')
    rows = list(texts)
    random.Random(seed).shuffle(rows)
    if len(rows) < 2:
        return rows, []
    cut = max(1, min(len(rows) - 1, int(round(len(rows) * validation_ratio))))
    return rows[cut:], rows[:cut]


def save_checkpoint(output, model, tokenizer, config, optimizer, epoch, step, val_loss, corpus_manifest, dataset_metadata):
    Path(output).mkdir(parents=True, exist_ok=True)
    torch.save({'model': model.state_dict(), 'optimizer': optimizer.state_dict(), 'epoch': epoch, 'step': step, 'val_loss': val_loss}, Path(output) / 'model.pt')
    (Path(output) / 'config.json').write_text(json.dumps(config.to_dict(), indent=2), encoding='utf-8')
    tokenizer.save(Path(output) / 'tokenizer.json')
    (Path(output) / 'training_state.json').write_text(json.dumps({'status':'trained','epoch':epoch,'step':step,'validation_loss':val_loss,'perplexity':math.exp(val_loss) if val_loss < 700 else float('inf'),'dataset':dataset_metadata}, indent=2), encoding='utf-8')
    (Path(output) / 'corpus_manifest.json').write_text(json.dumps(corpus_manifest, indent=2), encoding='utf-8')


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--corpus',required=True)
    p.add_argument('--output',default='checkpoints/astracore-lm-v0.1')
    p.add_argument('--vocab-size',type=int,default=8192)
    p.add_argument('--context-length',type=int,default=256)
    p.add_argument('--embedding-dimension',type=int,default=128)
    p.add_argument('--layers',type=int,default=4)
    p.add_argument('--heads',type=int,default=4)
    p.add_argument('--epochs',type=int,default=3)
    p.add_argument('--batch-size',type=int,default=4)
    p.add_argument('--lr',type=float,default=3e-4)
    p.add_argument('--seed',type=int,default=42)
    p.add_argument('--validation-ratio',type=float,default=0.1)
    args=p.parse_args()
    random.seed(args.seed); torch.manual_seed(args.seed)

    texts=read_corpus(args.corpus)
    train_texts,val_texts=split_texts(texts,args.validation_ratio,args.seed)
    train_text='\n\n'.join(train_texts)
    val_text='\n\n'.join(val_texts)
    tokenizer=AstraTokenizer.build(train_texts,args.vocab_size)
    train_ids=tokenizer.encode(train_text)
    val_ids=tokenizer.encode(val_text) if val_text else []
    config=ModelConfig(vocab_size=tokenizer.vocab_size,context_length=args.context_length,embedding_dimension=args.embedding_dimension,number_of_layers=args.layers,attention_heads=args.heads)
    model=AstraCoreLM(config)
    optimizer=torch.optim.AdamW(model.parameters(),lr=args.lr)
    train_ds=TokenBlocks(train_ids,args.context_length)
    val_ds=TokenBlocks(val_ids,args.context_length) if len(val_ids) >= args.context_length + 1 else None
    loader=DataLoader(train_ds,batch_size=args.batch_size,shuffle=True)
    best=float('inf'); step=0
    out=Path(args.output); out.mkdir(parents=True,exist_ok=True)
    corpus_manifest=[]
    for file in sorted(Path(args.corpus).rglob('*')):
        if file.is_file() and file.suffix.lower() in {'.txt','.md','.json','.csv','.html'}:
            data=file.read_bytes(); corpus_manifest.append({'path':str(file),'bytes':len(data)})
    dataset_metadata={'train_documents':len(train_texts),'validation_documents':len(val_texts),'validation_ratio':args.validation_ratio,'seed':args.seed}
    for epoch in range(1,args.epochs+1):
        model.train()
        for x,y in loader:
            optimizer.zero_grad(set_to_none=True); _,loss=model(x,y); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(),1.0); optimizer.step(); step+=1
        model.eval(); losses=[]
        with torch.no_grad():
            ds=val_ds or train_ds
            for x,y in DataLoader(ds,batch_size=args.batch_size,shuffle=False):
                _,loss=model(x,y); losses.append(float(loss))
        val_loss=sum(losses)/len(losses)
        print(json.dumps({'epoch':epoch,'step':step,'validation_loss':val_loss,'perplexity':math.exp(val_loss) if val_loss < 700 else float('inf')}))
        if val_loss < best:
            best=val_loss
            save_checkpoint(args.output,model,tokenizer,config,optimizer,epoch,step,val_loss,corpus_manifest,dataset_metadata)
    if not (out/'model.pt').exists():
        raise RuntimeError('No checkpoint produced')

if __name__=='__main__': main()
