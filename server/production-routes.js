const MAX_MEMORY = 8000;
const MAX_TOOL_LIMIT = 50;
const MAX_EVAL_LIMIT = 50;

function bodyJson(body) {
  try { return JSON.parse(body || '{}'); } catch { return null; }
}
function clampText(value, max) { return String(value ?? '').trim().slice(0, max); }

export async function handleProductionRoute({ req, res, url, user, readBody, json, supabaseUserRequest }) {
  const path = url.pathname;
  if (!path.startsWith('/api/memory') && !path.startsWith('/api/tools') && !path.startsWith('/api/models') && !path.startsWith('/api/evaluation') && !path.startsWith('/api/agents')) return false;

  if (path === '/api/memory' && req.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), MAX_MEMORY);
    const rows = await supabaseUserRequest(req, `/rest/v1/astracore_memory_records?select=memory_id,content,source,confidence,permission,expires_at,metadata,created_at,updated_at&user_id=eq.${encodeURIComponent(user.id)}&order=updated_at.desc&limit=${limit}`);
    return json(res, 200, { memories: rows });
  }

  if (path === '/api/memory' && req.method === 'POST') {
    const body = bodyJson(await readBody(req, 128 * 1024));
    if (!body) return json(res, 400, { error: 'Invalid JSON' });
    const content = clampText(body.content, MAX_MEMORY);
    if (!content) return json(res, 400, { error: 'content is required' });
    if (body.consent !== true) return json(res, 400, { error: 'Explicit memory consent is required' });
    const permission = body.permission === 'private' ? 'private' : 'user';
    const rows = await supabaseUserRequest(req, '/rest/v1/astracore_memory_records', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: user.id, content, source: body.source || 'explicit', confidence: Math.min(Math.max(Number(body.confidence) || 1, 0), 1), permission, expires_at: body.expires_at || null, metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {} })
    });
    return json(res, 201, { memory: rows[0] || null });
  }

  if (path.startsWith('/api/memory/') && req.method === 'DELETE') {
    const id = path.split('/')[3];
    if (!id) return json(res, 400, { error: 'memory id is required' });
    const rows = await supabaseUserRequest(req, `/rest/v1/astracore_memory_records?memory_id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}&select=memory_id&limit=1`);
    if (!rows[0]) return json(res, 404, { error: 'Memory not found' });
    await supabaseUserRequest(req, `/rest/v1/astracore_memory_records?memory_id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: 'DELETE' });
    return json(res, 200, { ok: true, memory_id: id });
  }

  if (path === '/api/tools' && req.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), MAX_TOOL_LIMIT);
    const rows = await supabaseUserRequest(req, `/rest/v1/astracore_tool_registry?select=name,description,input_schema,output_schema,permissions,risk_level,timeout_ms,authentication_requirements,status,created_at,updated_at&order=name.asc&limit=${limit}`);
    return json(res, 200, { tools: rows });
  }

  if (path === '/api/models' && req.method === 'GET') {
    const rows = await supabaseUserRequest(req, '/rest/v1/astracore_model_versions?select=id,model_id,display_name,architecture,status,parameter_count,vocab_size,context_length,embedding_dimension,layers,attention_heads,feed_forward_dimension,checkpoint_path,validation_loss,test_loss,perplexity,device,training_seed,training_metadata,created_at,updated_at&order=created_at.desc&limit=50');
    return json(res, 200, { models: rows });
  }

  if (path === '/api/evaluation' && req.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), MAX_EVAL_LIMIT);
    const rows = await supabaseUserRequest(req, `/rest/v1/astracore_evaluation_runs?select=*&order=created_at.desc&limit=${limit}`);
    return json(res, 200, { evaluations: rows });
  }

  if (path === '/api/agents' && req.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 50);
    const rows = await supabaseUserRequest(req, `/rest/v1/astracore_agent_runs?select=*&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=${limit}`);
    return json(res, 200, { agents: rows });
  }

  if (path === '/api/agents' && req.method === 'POST') {
    const body = bodyJson(await readBody(req, 64 * 1024));
    if (!body) return json(res, 400, { error: 'Invalid JSON' });
    const task = clampText(body.task, 4000);
    if (!task) return json(res, 400, { error: 'task is required' });
    const requestedSteps = Array.isArray(body.steps) ? body.steps.slice(0, 8).map((step) => clampText(step, 500)).filter(Boolean) : [];
    const rows = await supabaseUserRequest(req, '/rest/v1/astracore_agent_runs', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: user.id, status: 'planned', task, metadata: { steps: requestedSteps, created_by: 'api' } })
    });
    return json(res, 202, { agent_run: rows[0] || null, execution: 'planned_only', message: 'Agent execution is gated until the selected tools are authorized and implemented.' });
  }

  return json(res, 404, { error: 'Production route not found' });
}
