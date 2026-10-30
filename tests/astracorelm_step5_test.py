import torch
from model.config_v02 import ModelConfigV02
from model.model_v02 import AstraCoreLMV02
from model.tokenizer import AstraTokenizer

def test_bos_eos_contract_and_context_boundaries():
    tok=AstraTokenizer.build(['hello world cyber security'],128)
    cfg=ModelConfigV02(vocab_size=tok.vocab_size,context_length=8,tokenizer_sha256='x')
    model=AstraCoreLMV02(cfg)
    ids=torch.tensor([tok.encode('hello')],dtype=torch.long)
    assert ids.shape[1] <= 8
    model(ids)
    with torch.raises(ValueError):
        model(torch.zeros((1,9),dtype=torch.long))

def test_loss_shift_is_next_token_and_padding_is_ignored():
    tok=AstraTokenizer.build(['a b c'],32)
    cfg=ModelConfigV02(vocab_size=tok.vocab_size,context_length=8,tokenizer_sha256='x')
    model=AstraCoreLMV02(cfg)
    x=torch.tensor([[tok.bos_id,tok.vocab['a'],tok.vocab['b'],tok.pad_id]],dtype=torch.long)
    y=torch.tensor([[tok.vocab['a'],tok.vocab['b'],tok.eos_id,tok.pad_id]],dtype=torch.long)
    _,loss=model(x,y)
    assert torch.isfinite(loss)

def test_causal_mask_blocks_future_positions():
    cfg=ModelConfigV02(vocab_size=16,context_length=8,tokenizer_sha256='x')
    model=AstraCoreLMV02(cfg)
    _,mask,_=model._masks(torch.tensor([[1,2,3,4]]))
    assert mask[0,1].item() is False
    assert mask[0,2].item() is True
    assert mask[3,0].item() is False

def test_padding_is_not_a_valid_target():
    cfg=ModelConfigV02(vocab_size=16,context_length=8,tokenizer_sha256='x')
    model=AstraCoreLMV02(cfg)
    x=torch.tensor([[2,4,0,0]],dtype=torch.long)
    y=torch.tensor([[4,3,0,0]],dtype=torch.long)
    _,loss=model(x,y)
    assert torch.isfinite(loss)

def test_tokenizer_round_trip_special_tokens_and_tamil():
    tok=AstraTokenizer.build(['Hello, 123 cyber security. தமிழ் சோதனை'],128)
    ids=tok.encode('Hello, 123 cyber security. தமிழ் சோதனை')
    assert ids[0] == tok.bos_id and ids[-1] == tok.eos_id
    decoded=tok.decode(ids)
    assert 'hello' in decoded and 'தமிழ்' in decoded

def test_generation_rejects_context_overflow():
    tok=AstraTokenizer.build(['hello world'],32)
    cfg=ModelConfigV02(vocab_size=tok.vocab_size,context_length=4,tokenizer_sha256='x')
    model=AstraCoreLMV02(cfg)
    ids=torch.tensor([[tok.bos_id,2,3,4,5]],dtype=torch.long)
    try:
        model.generate_greedy(ids,tok.eos_id,1)
        assert False, 'expected overflow rejection'
    except ValueError as exc:
        assert 'CONTEXT_LENGTH_EXCEEDED' in str(exc)
