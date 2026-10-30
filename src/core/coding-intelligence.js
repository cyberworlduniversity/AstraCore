import { redactSecrets, classifyUntrustedText } from './safety-layer.js';

const RULES = Object.freeze([
  { id: 'eval', pattern: /\beval\s*\(/g, severity: 'high', message: 'Avoid eval on untrusted input.' },
  { id: 'child-process', pattern: /\b(child_process|exec\s*\(|spawn\s*\()/g, severity: 'high', message: 'Process execution requires a sandbox and explicit authorization.' },
  { id: 'inner-html', pattern: /\binnerHTML\s*=/g, severity: 'medium', message: 'Prefer safe DOM APIs or trusted templating to reduce XSS risk.' },
  { id: 'sql-concat', pattern: /(?:SELECT|INSERT|UPDATE|DELETE)[^;\n]*\+\s*[A-Za-z_$][\w$]*/gi, severity: 'high', message: 'Possible SQL construction from concatenated input; use parameterized queries.' },
  { id: 'hardcoded-secret', pattern: /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}["']/gi, severity: 'high', message: 'Possible hardcoded credential; move secrets to protected runtime configuration.' },
]);

export function analyzeCode(source, { language = 'unknown', filename = 'source' } = {}) {
  const text = String(source || '');
  const findings = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(text))) {
      const before = text.slice(0, match.index);
      findings.push({ rule: rule.id, severity: rule.severity, message: rule.message, line: before.split('\n').length, column: match.index - before.lastIndexOf('\n'), filename });
      if (!rule.pattern.global) break;
    }
  }
  return { language, filename, lines: text ? text.split('\n').length : 0, findings, risk: findings.some(f => f.severity === 'high') ? 'high' : findings.length ? 'medium' : 'low' };
}

export function reviewRepository(files = []) {
  const results = files.filter(Boolean).map(file => analyzeCode(file.content, { language: file.language, filename: file.path }));
  return { files: results, highRisk: results.filter(r => r.risk === 'high').length, totalFindings: results.reduce((n, r) => n + r.findings.length, 0) };
}

export function understandCode(source) {
  const text = String(source || '');
  return { languageHints: [...new Set((text.match(/\b(?:JavaScript|TypeScript|Python|Java|C\+\+|HTML|CSS|SQL|PHP|Rust|Go)\b/gi) || []).map(x => x.toLowerCase()))], functions: (text.match(/\b(?:function|def|class)\s+[A-Za-z_$][\w$]*/g) || []), imports: (text.match(/(?:import|from|require\s*\()[^\n;]+/g) || []).slice(0, 100) };
}

export function generateCode(spec, modelAdapter) {
  if (typeof modelAdapter !== 'function') return { status: 'model_required', code: null, spec: String(spec || '').slice(0, 8000) };
  return { status: 'generated', code: redactSecrets(String(modelAdapter(String(spec || '')))) };
}

export function debugCode(source, error = '') {
  const analysis = analyzeCode(source);
  const text = String(error || '').slice(0, 4000);
  return { ...analysis, error: text, likelyCauses: analysis.findings.map(f => f.message).slice(0, 10) };
}

export function cybersecurityReview(source, context = {}) {
  const analysis = analyzeCode(source, context);
  const untrusted = classifyUntrustedText(source);
  return { ...analysis, injectionRisk: untrusted.injectionRisk, recommendations: analysis.findings.map(f => f.message) };
}

export async function runSandboxedCode({ execute, code, language = 'python', timeoutMs = 10000, approved = false } = {}) {
  if (!approved) throw Object.assign(new Error('Explicit approval required for code execution'), { code: 'CODE_EXECUTION_NOT_APPROVED' });
  if (typeof execute !== 'function') throw Object.assign(new Error('Sandbox executor is not configured'), { code: 'SANDBOX_NOT_CONFIGURED' });
  const timeout = Math.min(Math.max(Number(timeoutMs) || 10000, 1000), 60000);
  const safeCode = String(code || '').slice(0, 50000);
  return await Promise.race([execute({ code: safeCode, language }), new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Sandbox timeout'), { code: 'SANDBOX_TIMEOUT' })), timeout))]);
}
