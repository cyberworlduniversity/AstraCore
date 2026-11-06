import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../server/server.js', import.meta.url), 'utf8');

test('admin control, audit, and catalog route group is guarded before dispatch', () => {
  assert.ok(source.includes("if(url.pathname.startsWith('/api/admin/control')||url.pathname==='/api/admin/audit'||url.pathname==='/api/admin/catalog'){const user=await requireAdmin(req,res);if(!user)return;const handled=await adminRoute"));
});

test('admin model, user, and overview endpoints each require admin authorization', () => {
  for (const endpoint of ['/api/admin/models', '/api/admin/users', '/api/admin/overview']) {
    assert.ok(source.includes(`if(req.method==='GET'&&url.pathname==='${endpoint}'){if(!await requireAdmin(req,res))return;`), `missing requireAdmin guard for ${endpoint}`);
  }
});

test('knowledge, production, and cloud route groups require an authenticated user', () => {
  assert.ok(source.includes("if(url.pathname.startsWith('/api/knowledge')){const user=await requireUser(req,res);if(!user)return;"));
  assert.ok(source.includes("if(url.pathname.startsWith('/api/memory')||url.pathname.startsWith('/api/tools')||url.pathname.startsWith('/api/models')||url.pathname.startsWith('/api/evaluation')||url.pathname.startsWith('/api/agents')){const user=await requireUser(req,res);if(!user)return;"));
  assert.ok(source.includes("if(url.pathname.startsWith('/api/projects')||url.pathname.startsWith('/api/files')){const user=await requireUser(req,res);if(!user)return;"));
});
