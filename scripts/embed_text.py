import json, os, sys
from model.embedding_checkpoint import EmbeddingCheckpoint
p=json.load(sys.stdin); checkpoint=p.get('checkpoint'); texts=p.get('texts') or []
if not checkpoint or not os.path.isdir(checkpoint): raise FileNotFoundError('trained AstraCoreEmbed checkpoint required')
e=EmbeddingCheckpoint.load(checkpoint); vectors=e.encode([str(x) for x in texts]).cpu().tolist()
if any(len(v)!=384 for v in vectors): raise ValueError('embedding dimension must be 384')
print(json.dumps({'ok':True,'dimensions':384,'embeddings':vectors},separators=(',',':')))
