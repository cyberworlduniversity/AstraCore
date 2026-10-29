import torch
from model.config import ModelConfig
from model.model import AstraCoreLM
from model.tokenizer import AstraTokenizer


def test_tokenizer_roundtrip_and_special_tokens():
    tok = AstraTokenizer.build(["AstraCore Python cybersecurity.", "Hello, world!"], vocab_size=128)
    ids = tok.encode("AstraCore Python!", add_bos=True, add_eos=True)
    assert ids[0] == tok.bos_id
    assert ids[-1] == tok.eos_id
    assert tok.decode(ids)


def test_model_forward_dimensions_and_loss():
    tok = AstraTokenizer.build(["AstraCore learns next tokens."], vocab_size=128)
    cfg = ModelConfig(vocab_size=tok.vocab_size, context_length=16, embedding_dimension=32,
                      number_of_layers=2, attention_heads=4, feed_forward_dimension=64)
    model = AstraCoreLM(cfg)
    x = torch.tensor([tok.encode("AstraCore learns next", add_bos=True, add_eos=False)[:8]])
    y = torch.roll(x, shifts=-1, dims=1)
    logits, loss = model(x, y)
    assert logits.shape == (1, x.shape[1], tok.vocab_size)
    assert loss is not None and torch.isfinite(loss)


def test_generation_is_bounded():
    from model.generate import generate
    tok = AstraTokenizer.build(["AstraCore is a local neural language model."], vocab_size=128)
    cfg = ModelConfig(vocab_size=tok.vocab_size, context_length=32, embedding_dimension=32,
                      number_of_layers=2, attention_heads=4, feed_forward_dimension=64)
    model = AstraCoreLM(cfg).eval()
    torch.manual_seed(42)
    text = generate(model, tok, "AstraCore", max_new_tokens=8, temperature=0.8, top_k=8)
    assert isinstance(text, str)
    assert len(tok.encode(text, add_bos=False, add_eos=False)) <= 64
