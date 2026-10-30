import argparse
import hashlib
import json
import math
import random
from pathlib import Path

import torch
from torch.utils.data import DataLoader, Dataset

from model.config import ModelConfig
from model.model import AstraCoreLM
from model.tokenizer import AstraTokenizer

TEXT_EXTENSIONS = {'.txt', '.md', '.json', '.csv', '.html'}

class TokenBlocks(Dataset):
    def __init__(self, ids, context_length):
        self.rows = []
        width = context_length + 1
        for start in range(0, max(0, len(ids) - width + 1), context_length):
            block = ids[start:start + width]
            if len(block) == width:
                self.rows.append(torch.tensor(block, dtype=torch.long))
        if not self.rows:
            raise ValueError('Corpus split is too small for one token block')
    def __len__(self): return len(self.rows)
    def __getitem__(self, index):
        row = self.rows[index]
        return row[:-1], row[1:]

def read_text_files(path):
    texts = []
    for file in sorted(Path(path).rglob('*')):
        if file.is_file() and file.suffix.lower() in TEXT_EXTENSIONS:
            text = file.read_text(encoding='utf-8', errors='ignore').strip()
            if text:
                texts.append(text)
    return texts

def read_dataset(path):
    root = Path(path)
    records_path = root / 'records.jsonl'
    if not records_path.exists():
        train = read_text_files(root)
        if not train:
            raise ValueError('No approved corpus text found')
        return {'train': train, 'validation': [], 'test': []}, {'format': 'legacy-text'}
    splits = {'train': [], 'validation': [], 'test': []}
    record_hash = hashlib.sha256()
    with records_path.open(encoding='utf-8') as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip(): continue
            record = json.loads(line)
            if not record.get('id') or not record.get('text'):
                raise ValueError(f'invalid dataset record at line {line_number}')
            split = record.get('split')
            if split not in splits:
                raise ValueError(f'invalid split {split!r} at line {line_number}')
            if record.get('license') not in {'CC0-1.0', 'MIT', 'Apache-2.0'}:
                raise ValueError(f'unsupported dataset license at line {line_number}')
            splits[split].append(str(record['text']).strip())
            record_hash.update(line.encode('utf-8'))
    if not all(splits.values()):
        raise ValueError('dataset must contain non-empty train, validation, and test splits')
    return splits, {
        'format': 'jsonl',
        'record_sha256': record_hash.hexdigest(),
        'train_documents': len(splits['train']),
        'validation_documents': len(splits['validation']),
        'test_documents': len(splits['test']),
    }

def evaluate(model, dataset, batch_size):
    model.eval()
    losses = []
    with torch.no_grad():
        for x, y in DataLoader(dataset, batch_size=batch_size, shuffle=False):
            _, loss = model(x, y)
            losses.append(float(loss))
    if not losses: raise ValueError('evaluation split produced no token blocks')
    loss = sum(losses) / len(losses)
    return loss, math.exp(loss) if loss < 700 else float('inf')

def save_checkpoint(output, model, tokenizer, config, optimizer, epoch, step, val_loss, dataset_metadata):
    output.mkdir(parents=True, exist_ok=True)
    torch.save({'model': model.state_dict(), 'optimizer': optimizer.state_dict(), 'epoch': epoch, 'step': step, 'val_loss': val_loss}, output / 'model.pt')
    (output / 'config.json').write_text(json.dumps(config.to_dict(), indent=2) + '\n', encoding='utf-8')
    tokenizer.save(output / 'tokenizer.json')
    (output / 'training_state.json').write_text(json.dumps({'status':'trained','epoch':epoch,'step':step,'validation_loss':val_loss,'perplexity':math.exp(val_loss) if val_loss < 700 else float('inf'),'dataset':dataset_metadata}, indent=2) + '\n', encoding='utf-8')

def main():
    p=argparse.ArgumentParser(); p.add_argument('--corpus',required=True); p.add_argument('--output',default='checkpoints/astracore-lm-v1.0'); p.add_argument('--vocab-size',type=int,default=4096); p.add_argument('--context-length',type=int,default=128); p.add_argument('--embedding-dimension',type=int,default=128); p.add_argument('--layers',type=int,default=4); p.add_argument('--heads',type=int,default=4); p.add_argument('--epochs',type=int,default=5); p.add_argument('--batch-size',type=int,default=8); p.add_argument('--lr',type=float,default=3e-4); p.add_argument('--seed',type=int,default=42); args=p.parse_args()
    random.seed(args.seed); torch.manual_seed(args.seed)
    splits,dataset_metadata=read_dataset(args.corpus)
    tokenizer=AstraTokenizer.build(splits['train'],args.vocab_size)
    train_ids=tokenizer.encode('\n\n'.join(splits['train'])); validation_ids=tokenizer.encode('\n\n'.join(splits['validation'])); test_ids=tokenizer.encode('\n\n'.join(splits['test']))
    config=ModelConfig(vocab_size=tokenizer.vocab_size,context_length=args.context_length,embedding_dimension=args.embedding_dimension,number_of_layers=args.layers,attention_heads=args.heads)
    model=AstraCoreLM(config); optimizer=torch.optim.AdamW(model.parameters(),lr=args.lr)
    train_ds=TokenBlocks(train_ids,args.context_length); validation_ds=TokenBlocks(validation_ids,args.context_length); test_ds=TokenBlocks(test_ids,args.context_length)
    loader=DataLoader(train_ds,batch_size=args.batch_size,shuffle=True); best=float('inf'); step=0; out=Path(args.output)
    for epoch in range(1,args.epochs+1):
        model.train()
        for x,y in loader:
            optimizer.zero_grad(set_to_none=True); _,loss=model(x,y); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(),1.0); optimizer.step(); step+=1
        val_loss,perplexity=evaluate(model,validation_ds,args.batch_size); print(json.dumps({'epoch':epoch,'step':step,'validation_loss':val_loss,'perplexity':perplexity}))
        if val_loss < best:
            best=val_loss; save_checkpoint(out,model,tokenizer,config,optimizer,epoch,step,val_loss,{**dataset_metadata,'train_tokens':len(train_ids),'validation_tokens':len(validation_ids),'test_tokens':len(test_ids),'seed':args.seed,'context_length':args.context_length,'vocab_size':tokenizer.vocab_size})
    test_loss,test_perplexity=evaluate(model,test_ds,args.batch_size)
    (out/'test_evaluation.json').write_text(json.dumps({'validation_loss':best,'validation_perplexity':math.exp(best) if best < 700 else float('inf'),'test_loss':test_loss,'test_perplexity':test_perplexity,'dataset':dataset_metadata},indent=2)+'\n',encoding='utf-8')
    if not (out/'model.pt').exists(): raise RuntimeError('No checkpoint produced')

if __name__=='__main__': main()
