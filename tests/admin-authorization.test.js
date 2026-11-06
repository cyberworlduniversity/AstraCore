import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../server/server.js', import.meta.url), 'utf8');

test('admin control, audit, and catalog route group is guarded before dispatch', () => {
  assert.match(source, /url\.pathname\.startsWith\('\/api\/admin\/control'\)\|\|url\.pathname==='\/api\/admin\/audit'\|\|url\.pathname==='\/api\/admin\/catalog'\)\{const user=await requireAdmin\(req,res\);if\(!user\)return;const handled=await adminRoute/);
});

test('admin model, user, and overview endpoints each require admin authorization', () => {
  for (const endpoint of ['/api/admin/models', '/api/admin/users', '/api/admin/overview']) {
    const escaped = endpoint.replaceAll('/', '\\/').replaceAll('-', '\\-');
    const pattern = new RegExp(`url\\.pathname==='\${escaped}'\\)\\{if\\(!await requireAdmin\\(req,res\\)\\)return;`);
    assert.match(source, pattern, `missing requireAdmin guard for ${endpoint}`);
  }
});

test('user-facing data route groups require an authenticated user before dispatch', () => {
  assert.match(source, /url\.pathname\.startsWith\('\/api\/knowledge'\)\)\{const user=await requireUser\(req,res\);if\(!user\)return;/);
  assert.match(source, /url\.pathname\.startsWith\('\/api\/projects'\)\|\|url\.pathname\.startsWith\('\/api\/files'\)\)\{const user=await requireUser\(req,res\);if\(!user\)return;/);
  assert.match(source, /url\.pathname\.startsWith\('\/api\/memory'\)\|\|url\.pathname\.startsWith\('\/api\/tools'\)\|\|url\.pathname\.startsWith\('\/api\/models'\)/);
});
