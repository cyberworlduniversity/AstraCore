import torch

def generate(model, tokenizer, prompt, max_new_tokens=64, temperature=0.8, top_k=32):
    ids = tokenizer.encode(prompt, add_bos=True, add_eos=False)
    device = next(model.parameters()).device
    for _ in range(max_new_tokens):
        x = torch.tensor([ids[-model.context_length:]], dtype=torch.long, device=device)
        with torch.no_grad(): logits, _ = model(x)
        logits = logits[0, -1] / max(float(temperature), 1e-4)
        values, indices = torch.topk(logits, min(int(top_k), logits.numel()))
        probs = torch.softmax(values, dim=-1)
        ids.append(int(indices[torch.multinomial(probs, 1)].item()))
        if ids[-1] == tokenizer.eos_id: break
    return tokenizer.decode(ids)
