import argparse, hashlib, json
from pathlib import Path

ALLOWED={'.txt','.md','.markdown','.json','.csv','.html','.htm','.py','.js','.ts','.css','.sql'}

def main():
    p=argparse.ArgumentParser(); p.add_argument('source_dir'); p.add_argument('--output',default='data/training/astracorelm-v0.1.txt'); p.add_argument('--manifest',default='data/training/astracorelm-v0.1.manifest.json'); a=p.parse_args()
    root=Path(a.source_dir); texts=[]; files=[]
    for path in sorted(root.rglob('*')):
        if path.is_file() and path.suffix.lower() in ALLOWED:
            text=path.read_text(encoding='utf-8',errors='ignore').strip()
            if text: texts.append(f'\n### SOURCE: {path.as_posix()}\n{text}'); files.append(str(path))
    if not texts: raise SystemExit('No approved text files found; corpus not created.')
    corpus='\n'.join(texts); digest=hashlib.sha256(corpus.encode()).hexdigest(); out=Path(a.output); out.parent.mkdir(parents=True,exist_ok=True); out.write_text(corpus,encoding='utf-8'); m=Path(a.manifest); m.parent.mkdir(parents=True,exist_ok=True); m.write_text(json.dumps({'source_dir':str(root),'files':files,'file_count':len(files),'corpus_sha256':digest,'status':'assembled_not_approved'},indent=2),encoding='utf-8'); print(json.dumps({'files':len(files),'sha256':digest,'status':'assembled_not_approved'},indent=2))

if __name__=='__main__': main()
