const MAX_MEMORY = 8000;
const MAX_TOOL_LIMIT = 50;
const MAX_EVAL_LIMIT = 50;

function bodyJson(body) {
  try { return JSON.parse(body || '{}'); } catch { return null; }
}
function clampText(value, max) { return String(value ?? '').trim().slice(0, max); }
function isoNow() { return new Date().toISOString(); }
function activeMemoryFilter(userId) {
  const now = encodeURIComponent(isoNow());
  return `/rest/v1/astracore_memory_records?user_id=eq.${encodeURIComponent(userId)}&consent_revoked_at=is.null&or=(expires_at.is.null,expires_at.gt.${now})`;
}

export async function handleProductionRoute({ req, res, url, user, readBody, json, supabaseUserRequest, modelClient = null, knowledgeSearch = null }) {
  const path = url.pathname;
  if (!path.startsWith('/api/memory') && !path.startsWith('/api/tools') && !path.startsWith('/api/models') && !path.startsWith('/api/evaluation') && !path.startsWith('/api/agents')) return false;

  if (path === '/api/memory' && req.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), MAX_MEMORY);
    const rows = await supabaseUserRequest(req, `${activeMemoryFilter(user.id)}&select=memory_id,content,source,confidence,permission,expires_at,metadata,consent_granted_at,created_at,updated_at&order=updated_at.desc&limit=${limit}`);
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
      body: JSON.stringify({ user_id: user.id, content, source: body.source || 'explicit', confidence: Math.min(Math.max(Number(body.confidence) || 1, 0), 1), permission, expires_at: body.expires_at || null, consent_granted_at: isoNow(), consent_revoked_at: null, metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {} })
    });
    return json(res, 201, { memory: rows[0] || null });
  }

  if (path === '/api/memory/consent/revoke' && req.method === 'POST') {
    await supabaseUserRequest(req, `/rest/v1/astracore_memory_records?user_id=eq.${encodeURIComponent(user.id)}&consent_revoked_at=is.null`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ consent_revoked_at: isoNow() })
    });
    return json(res, 200, { ok: true, memory_persistence: 'revoked' });
  }

  if (path.startsWith('/api/memory/') && req.method === 'PATCH') {
    const id = path.split('/')[3];
    if (!id) return json(res, 400, { error: 'memory id is required' });
    const body = bodyJson(await readBody(req, 64 * 1024));
    if (!body) return json(res, 400, { error: 'Invalid JSON' });
    if (body.consent !== true) return json(res, 400, { error: 'Explicit memory consent is required for updates' });
    const existing = await supabaseUserRequest(req, `${activeMemoryFilter(user.id)}&memory_id=eq.${encodeURIComponent(id)}&select=memory_id&limit=1`);
    if (!existing[0]) return json(res, 404, { error: 'Memory not found' });
    const patch = {};
    if (body.content !== undefined) {
      const content = clampText(body.content, MAX_MEMORY);
      if (!content) return json(res, 400, { error: 'content cannot be empty' });
      patch.content = content;
    }
    if (body.confidence !== undefined) patch.confidence = Math.min(Math.max(Number(body.confidence) || 0, 0), 1);
    if (body.expires_at !== undefined) patch.expires_at = body.expires_at || null;
    if (body.metadata !== undefined) patch.metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
    patch.consent_granted_at = isoNow();
    const rows = await supabaseUserRequest(req, `/rest/v1/astracore_memory_records?memory_id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    return json(res, 200, { memory: rows[0] || null });
  }

  if (path.startsWith('/api/memory/') && req.method === 'DELETE') {
    const id = path.split('/')[3];
    if (!id) return json(res, 400, { error: 'memory id is required' });
    const rows = await supabaseUserRequest(req, `${activeMemoryFilter(user.id)}&memory_id=eq.${encodeURIComponent(id)}&select=memory_id&limit=1`);
    if (!rows[0]) return json(res, 404, { error: 'Memory not found' });
    await supabaseUserRequest(req, `/rest/v1/astracore_memory_records?memory_id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: 'DELETE' });
    return json(res, 200, { ok: true, memory_id: id });
  }

  if (path === '/api/tools' && req.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), MAX_TOOL_LIMIT);
    const rows = await supabaseUserRequest(req, `/rest/v1/astracore_tool_registry?select=name,description,input_schema,output_schema,permissions,risk_level,timeout_ms,authentication_requirements,status&order=name.asc&limit=${limit}`);
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
    if (body.execute === true) {
      if (!modelClient || typeof modelClient.generate !== 'function') {
        return json(res, 503, { error: 'AGENT_RUNTIME_NOT_READY', message: 'Agent execution requires an approved AstraCoreLM runtime.' });
      }
      const { runAgentTask } = await import('../src/agent/orchestrator.js');
      let execution;
      try {
        execution = await runAgentTask({
          task: body.task,
          agentType: body.agent_type,
          modelClient,
          knowledgeSearch,
        });
      } catch (error) {
        return json(res, Number(error.status) || 503, { error: 'AGENT_EXECUTION_FAILED', message: error.message });
      }
      const rows = await supabaseUserRequest(req, '/rest/v1/astracore_agent_runs', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          user_id: user.id,
          agent_type: execution.plan.agent_type,
          status: 'completed',
          plan: execution.plan,
          result: {
            execution: 'completed',
            answer: execution.answer,
            tools_executed: execution.tools_executed,
            tool_results: execution.tool_results,
            execution_policy: execution.execution_policy,
          },
        })
      });
      return json(res, 201, {
        agent_run: rows[0] || null,
        execution: 'completed',
        answer: execution.answer,
        plan: execution.plan,
        tools_executed: execution.tools_executed,
        tool_results: execution.tool_results,
        execution_policy: execution.execution_policy,
        warning: execution.warning,
      });
    }
    const { createAgentPlan } = await import('../src/agent/runtime.js');
    let plan;
    try {
      plan = createAgentPlan({ task: body.task, steps: body.steps, agentType: body.agent_type });
    } catch (error) {
      return json(res, Number(error.status) || 400, { error: error.message });
    }
    const rows = await supabaseUserRequest(req, '/rest/v1/astracore_agent_runs', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: user.id, agent_type: plan.agent_type, status: 'planned', plan, result: { execution: 'planned_only', tools_authorized: false } })
    });
    return json(res, 202, { agent_run: rows[0] || null, execution: 'planned_only', tools_authorized: false, message: 'Plan saved. Tool execution remains disabled until adapters, sandboxing and approval checks are implemented.' });
  }

  return json(res, 404, { error: 'Production route not found' });
}
