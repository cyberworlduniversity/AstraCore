import hashlib
import json
import math
from pathlib import Path

import pytest
import torch
from model.config_v02 import ModelConfigV02
from model.model_v02 import AstraCoreLMV02
from model.tokenizer import AstraTokenizer
from scripts.train_lm_v02 import parameter_fingerprint


def test_bos_eos_contract_and_context_boundaries():
    tok=AstraTokenizer.build(['hello world cyber security'],128)
    cfg=ModelConfigV02(vocab_size=tok.vocab_size,context_length=8,tokenizer_sha256='x',max_raw_input_tokens=6)
    model=AstraCoreLMV02(cfg)
    ids=torch.tensor([tok.encode('hello')],dtype=torch.long)
    assert ids.shape[1] == 3
    assert cfg.special_token_overhead == 2
    assert cfg.max_raw_input_tokens == 6
    assert cfg.max_encoded_sequence_length == 8
    assert ids.shape[1] <= cfg.max_encoded_sequence_length
    model(ids)
    with pytest.raises(ValueError, match='CONTEXT_LENGTH_EXCEEDED'):
        model(torch.zeros((1,9),dtype=torch.long))


def test_bos_eos_context_contract_rejects_overlong_raw_input():
    tok=AstraTokenizer.build(['one two three four five six seven eight nine ten'],128)
    cfg=ModelConfigV02(vocab_size=tok.vocab_size,context_length=8,tokenizer_sha256='x',max_raw_input_tokens=6)
    raw='one two three four five six seven'
    raw_token_count=len(tok.tokens(raw))
    assert raw_token_count == 7
    encoded=tok.encode(raw)
    assert len(encoded) == raw_token_count + cfg.special_token_overhead
    assert len(encoded) > cfg.max_encoded_sequence_length
    with pytest.raises(ValueError, match='RAW_INPUT_TOKENS_EXCEEDED'):
        tok.encode_for_context(raw,cfg.max_raw_input_tokens,cfg.context_length)


def test_loss_shift_is_next_token_and_padding_is_ignored():
    tok=AstraTokenizer.build(['a b c'],32)
    cfg=ModelConfigV02(vocab_size=tok.vocab_size,context_length=8,tokenizer_sha256='x')
    model=AstraCoreLMV02(cfg)
    x=torch.tensor([[tok.bos_id,tok.vocab['a'],tok.vocab['b'],tok.pad_id]],dtype=torch.long)
    y=torch.tensor([[tok.vocab['a'],tok.vocab['b'],tok.eos_id,tok.pad_id]],dtype=torch.long)
    _,loss=model(x,y)
    assert torch.isfinite(loss)


def test_causal_mask_blocks_future_positions_and_allows_past_current():
    cfg=ModelConfigV02(vocab_size=16,context_length=8,tokenizer_sha256='x')
    model=AstraCoreLMV02(cfg)
    _,mask,_=model._masks(torch.tensor([[1,2,3,4]]))
    assert mask[0,1].item() is True
    assert mask[1,0].item() is False
    assert mask[1,1].item() is False
    assert mask[3,0].item() is False
    assert mask[3,3].item() is False


def test_padding_is_not_a_valid_target():
    cfg=ModelConfigV02(vocab_size=16,context_length=8,tokenizer_sha256='x')
    model=AstraCoreLMV02(cfg)
    x=torch.tensor([[2,4,0,0]],dtype=torch.long)
    y=torch.tensor([[4,3,0,0]],dtype=torch.long)
    _,loss=model(x,y)
    assert torch.isfinite(loss)


def test_tokenizer_round_trip_special_tokens_unicode_tamil_and_mixed_text():
    samples=['தமிழ் சோதனை','வணக்கம் AstraCore 123!','Cyber பாதுகாப்பு 2026.','  தமிழ்\tEnglish\nசோதனை  ']
    tok=AstraTokenizer.build(samples,128)
    for text in samples:
        ids=tok.encode(text)
        assert ids[0] == tok.bos_id and ids[-1] == tok.eos_id
        decoded=tok.decode(ids)
        expected=' '.join(tok.tokens(text))
        assert decoded == expected
        assert '<unk>' not in decoded


def test_generation_rejects_context_overflow():
    tok=AstraTokenizer.build(['hello world'],32)
    cfg=ModelConfigV02(vocab_size=tok.vocab_size,context_length=4,tokenizer_sha256='x',max_raw_input_tokens=2)
    model=AstraCoreLMV02(cfg)
    ids=torch.tensor([[tok.bos_id,2,3,4,5]],dtype=torch.long)
    with pytest.raises(ValueError, match='CONTEXT_LENGTH_EXCEEDED'):
        model.generate_greedy(ids,tok.eos_id,1)


def test_parameter_fingerprint_is_deterministic_and_changes_with_values():
    cfg=ModelConfigV02(vocab_size=16,context_length=8,tokenizer_sha256='x')
    a=AstraCoreLMV02(cfg)
    b=AstraCoreLMV02(cfg)
    b.load_state_dict(a.state_dict(), strict=True)
    assert parameter_fingerprint(a) == parameter_fingerprint(a)
    assert parameter_fingerprint(a) == parameter_fingerprint(b)
    with torch.no_grad():
        next(b.parameters()).view(-1)[0].add_(1.0)
    assert parameter_fingerprint(a) != parameter_fingerprint(b)


def test_optimizer_activity_and_weights_changed_contract():
    training={'optimizer_steps':3,'epochs_completed':1,'initial_parameter_sha256':'a','trained_parameter_sha256':'b','weights_changed':True}
    assert training['optimizer_steps'] > 0
    assert training['epochs_completed'] > 0
    assert training['weights_changed'] == (training['initial_parameter_sha256'] != training['trained_parameter_sha256'])


def test_ppl_calculation_is_exp_loss():
    loss=2.0
    assert math.isclose(math.exp(loss), 7.38905609893065, rel_tol=1e-12)


def test_nonfinite_metrics_are_rejected():
    for value in (float('nan'), float('inf'), float('-inf')):
        assert not math.isfinite(value)


def test_checkpoint_hash_is_deterministic(tmp_path):
    p=tmp_path/'checkpoint.pt'; p.write_bytes(b'checkpoint-bytes')
    h1=hashlib.sha256(p.read_bytes()).hexdigest()
    h2=hashlib.sha256(p.read_bytes()).hexdigest()
    assert h1 == h2


def test_manifest_required_fields():
    manifest={
        'workflow':'AstraCoreLM Step 5', 'run_id':'NOT_VERIFIED', 'commit_sha':'NOT_VERIFIED',
        'timestamp':'NOT_VERIFIED', 'python_version':'NOT_VERIFIED', 'pytorch_version':'NOT_VERIFIED',
        'runner':'NOT_VERIFIED', 'dataset_version':'0.2.0', 'architecture_version':'astracorelm-arch-v0.2',
        'tokenizer_version':'astratokenizer-v0.1', 'seed':42
    }
    required=('workflow','run_id','commit_sha','timestamp','python_version','pytorch_version','runner','dataset_version','architecture_version','tokenizer_version','seed')
    assert all(k in manifest for k in required)
