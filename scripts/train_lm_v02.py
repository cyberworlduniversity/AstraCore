import argparse, hashlib, json, math, platform, random, time
from pathlib import Path
import torch
from torch.utils.data import DataLoader, Dataset
from model.config_v02 import ModelConfigV02
from model.model_v02 import AstraCoreLMV02
from model.tokenizer import AstraTokenizer

PAD_ID = 0

class SequenceDataset(Dataset):
    def __init__(self, records, tokenizer, context_length):
        self.rows = []
        for r in records:
            ids = tokenizer.encode(r['text'], add_bos=True, add_eos=True)
            if len(ids) > context_length:
                ids = ids[:context_length - 1] + [tokenizer.eos_id]
            if len(ids) < 2:
                continue
            self.rows.append(torch.tensor(ids, dtype=torch.long))
    def __len__(self): return len(self.rows)
    def __getitem__(self, i):
        r = self.rows[i]
        return r[:-1], r[1:]

def collate(batch):
    max_len = max(x.numel() for x, _ in batch)
    xs, ys = [], []
    for x, y in batch:
        pad = max_len - x.numel()
        xs.append(torch.cat([x, torch.full((pad,), PAD_ID, dtype=torch.long)]))
        ys.append(torch.cat([y, torch.full((pad,), PAD_ID, dtype=torch.long)]))
    return torch.stack(xs), torch.stack(ys)

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def score(model, ds, batch):
    model.eval(); total_nll = 0.0; total_tokens = 0
    with torch.no_grad():
        for x, y in DataLoader(ds, batch_size=batch, shuffle=False, collate_fn=collate):
            logits, _ = model(x, y)
            nll = torch.nn.functional.cross_entropy(logits.reshape(-1, logits.size(-1)), y.reshape(-1), ignore_index=PAD_ID, reduction='sum')
            total_nll += float(nll); total_tokens += int(y.ne(PAD_ID).sum())
    if total_tokens == 0: raise ValueError('empty evaluation')
    loss = total_nll / total_tokens
    return loss, math.exp(loss) if loss < 700 else float('inf'), total_tokens

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--dataset', required=True); p.add_argument('--output', required=True)
    p.add_argument('--seed', type=int, default=42); p.add_argument('--vocab-size', type=int, default=2048)
    p.add_argument('--context-length', type=int, default=128); p.add_argument('--embedding-dimension', type=int, default=256)
    p.add_argument('--layers', type=int, default=4); p.add_argument('--heads', type=int, default=8); p.add_argument('--ffn', type=int, default=1024)
    p.add_argument('--dropout', type=float, default=0.1); p.add_argument('--epochs', type=int, default=8)
    p.add_argument('--batch-size', type=int, default=16); p.add_argument('--lr', type=float, default=3e-4); p.add_argument('--weight-decay', type=float, default=0.01)
    a = p.parse_args()
    random.seed(a.seed); torch.manual_seed(a.seed); torch.set_num_threads(max(1, min(4, torch.get_num_threads() or 1)))
    root, out = Path(a.dataset), Path(a.output); out.mkdir(parents=True, exist_ok=True)
    records = [json.loads(x) for x in (root/'records.jsonl').read_text(encoding='utf-8').splitlines() if x.strip()]
    splits = {s: [r for r in records if r['split'] == s] for s in ('train','validation','test')}
    docs = {s: {r['document_id'] for r in splits[s]} for s in splits}
    assert not (docs['train'] & docs['validation'] or docs['train'] & docs['test'] or docs['validation'] & docs['test'])
    tok = AstraTokenizer.build([r['text'] for r in splits['train']], a.vocab_size)
    tok_path = out/'tokenizer.json'; tok.save(tok_path); tok_sha = sha(tok_path)
    cfg = ModelConfigV02(vocab_size=tok.vocab_size, context_length=a.context_length, embedding_dimension=a.embedding_dimension, number_of_layers=a.layers, attention_heads=a.heads, feed_forward_dimension=a.ffn, dropout=a.dropout, tokenizer_sha256=tok_sha)
    cfg_path = out/'model-config.json'; cfg_path.write_text(json.dumps(cfg.to_dict(), indent=2)+'\n', encoding='utf-8'); cfg_sha = sha(cfg_path)
    datasets = {s: SequenceDataset(splits[s], tok, a.context_length) for s in splits}
    model = AstraCoreLMV02(cfg)
    optimizer = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=a.weight_decay)
    train_loader = DataLoader(datasets['train'], batch_size=a.batch_size, shuffle=True, generator=torch.Generator().manual_seed(a.seed), collate_fn=collate)
    total_steps = max(1, len(train_loader) * a.epochs); warmup = max(1, min(100, total_steps // 10))
    best = float('inf'); best_epoch = 0; history = []; step = 0; start = time.perf_counter()
    for epoch in range(1, a.epochs + 1):
        model.train(); train_nll = 0.0; train_tokens = 0
        for x, y in train_loader:
            step += 1; optimizer.zero_grad(set_to_none=True)
            progress = min(1.0, step / warmup) if step <= warmup else 1.0
            lr_scale = progress if step <= warmup else max(0.1, 0.5 * (1 + math.cos(math.pi * (step - warmup) / max(1, total_steps - warmup))))
            for group in optimizer.param_groups: group['lr'] = a.lr * lr_scale
            logits, _ = model(x, y)
            loss = torch.nn.functional.cross_entropy(logits.reshape(-1, logits.size(-1)), y.reshape(-1), ignore_index=PAD_ID)
            loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); optimizer.step()
            train_nll += float(loss) * int(y.ne(PAD_ID).sum()); train_tokens += int(y.ne(PAD_ID).sum())
        train_loss = train_nll / max(1, train_tokens)
        val_loss, val_ppl, val_tokens = score(model, datasets['validation'], a.batch_size)
        row = {'epoch': epoch, 'train_loss': train_loss, 'validation_loss': val_loss, 'validation_perplexity': val_ppl, 'validation_tokens': val_tokens}
        history.append(row); print(json.dumps(row))
        if val_loss < best:
            best, best_epoch = val_loss, epoch
            torch.save({'model': model.state_dict(), 'config': cfg.to_dict(), 'model_version': 'astracorelm-v0.2', 'dataset_version': '0.2.0', 'dataset_sha256': sha(root/'records.jsonl'), 'tokenizer_sha256': tok_sha, 'config_sha256': cfg_sha, 'epoch': epoch, 'seed': a.seed, 'optimizer': optimizer.state_dict()}, out/'checkpoint.pt')
    checkpoint_sha = sha(out/'checkpoint.pt')
    payload = torch.load(out/'checkpoint.pt', map_location='cpu', weights_only=False)
    reloaded = AstraCoreLMV02(ModelConfigV02.from_dict(payload['config'])); reloaded.load_state_dict(payload['model'], strict=True); reloaded.eval()
    test_loss, test_ppl, test_tokens = score(reloaded, datasets['test'], a.batch_size)
    elapsed = (time.perf_counter() - start) * 1000
    training = {
        'status': 'EXPERIMENTAL_CANDIDATE_READY', 'model_version': 'astracorelm-v0.2', 'architecture_version': cfg.architecture_version,
        'python_version': platform.python_version(), 'torch_version': torch.__version__, 'seed': a.seed, 'epochs': a.epochs,
        'batch_size': a.batch_size, 'learning_rate': a.lr, 'weight_decay': a.weight_decay, 'warmup_steps': warmup,
        'context_length': a.context_length, 'max_encoded_sequence_length': cfg.max_encoded_sequence_length, 'vocab_size': tok.vocab_size,
        'parameter_count': sum(p.numel() for p in reloaded.parameters()), 'best_epoch': best_epoch, 'history': history,
        'best_validation_loss': best, 'best_validation_perplexity': math.exp(best), 'test_loss': test_loss, 'test_perplexity': test_ppl,
        'validation_tokens': history[best_epoch-1]['validation_tokens'], 'test_tokens': test_tokens, 'dataset_sha256': sha(root/'records.jsonl'),
        'tokenizer_sha256': tok_sha, 'config_sha256': cfg_sha, 'checkpoint_sha256': checkpoint_sha, 'checkpoint_path': str(out/'checkpoint.pt'),
        'training_elapsed_ms': elapsed, 'reload_verified': True, 'production_approved': False,
    }
    (out/'training_state.json').write_text(json.dumps(training, indent=2)+'\n', encoding='utf-8')
    (out/'test_evaluation.json').write_text(json.dumps({'validation_loss':best,'validation_perplexity':math.exp(best),'test_loss':test_loss,'test_perplexity':test_ppl,'test_tokens':test_tokens,'checkpoint_sha256':checkpoint_sha}, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(training, indent=2))

if __name__ == '__main__': main()
