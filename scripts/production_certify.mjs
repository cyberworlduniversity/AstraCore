import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const required = {
  16: ['model/embedding_model.py','model/embedding_tokenizer.py','scripts/train_embeddings.py','scripts/evaluate_embeddings.py'],
  17: ['model/model.py','model/tokenizer.py','scripts/train_lm.py','scripts/evaluate_lm.py'],
  18: ['src/core/rag.js','src/core/knowledge.js','src/core/source.js','src/core/production-pipeline.js'],
  19: ['src/core/memory-system.js','server/production-routes.js'],
  20: ['src/core/tools.js','src/core/tool-agent-system.js'],
  21: ['src/core/multimodal.js','scripts/document_extract.py'],
  22: ['src/core/web-research.js'],
  23: ['src/core/coding.js','src/core/coding-intelligence.js'],
  24: ['src/core/agent-engine.js','src/core/orchestrator.js'],
  25: ['src/core/safety-layer.js'],
  26: ['src/core/evaluation.js'],
  27: ['src/core/production-gate.js','src/core/production-orchestrator.js'],
  28: ['server/production-routes.js','server/server.js'],
  29: ['scripts/validate_embedding_dataset.py'],
  30: ['scripts/train_lm.py','scripts/train_embeddings.py'],
  31: ['src/core/production-pipeline.js'],
  32: ['src/core/production-gate.js'],
  33: ['web/index.html'],
  34: ['src/core/safety-layer.js','server/auth.js'],
};
const evidence = {};
for (const [step, files] of Object.entries(required)) {
  const missing = files.filter(f => !existsSync(join(root, f)));
  evidence[step] = { status: missing.length ? 'BLOCKED' : 'STRUCTURE_PRESENT', missing };
}
let testStatus='PASS';
try { execFileSync('npm',['test'],{stdio:'ignore',cwd:root,timeout:180000}); } catch { testStatus='FAIL'; }
let pythonStatus='PASS';
try { execFileSync('python3',['-m','pytest','-q','tests'],{stdio:'ignore',cwd:root,timeout:180000}); } catch { pythonStatus='FAIL_OR_UNAVAILABLE'; }
const blockers=[];
if (testStatus !== 'PASS') blockers.push('Node test suite failed');
if (pythonStatus !== 'PASS') blockers.push('Python test suite failed or pytest is unavailable');
const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const report={generated_at:new Date().toISOString(),project:pkg.name,head:process.env.GITHUB_SHA||null,tests:{node:testStatus,python:pythonStatus},steps:evidence,release_status:'BLOCKED',blockers:[...blockers,'Model/evaluation, external web search, production database evidence, deployment, security and rollback must be verified with live evidence before PASS.'],policy:'This report never promotes a capability from structure to production readiness without execution evidence.'};
writeFileSync(join(root,'docs/PRODUCTION_CERTIFICATION_LATEST.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
