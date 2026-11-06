const MAX_SEARCH = 30;

function clamp(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

export async function systemRoute({ req, res, url, user, json, supabaseUserRequest, capabilityCount, modelDetails }) {
  const path = url.pathname;

  if (path === '/api/system/status' && req.method === 'GET') {
    const [models, tools, evaluations] = await Promise.all([
      supabaseUserRequest(req, '/rest/v1/astracore_model_versions?select=id,model_id,display_name,status,perplexity,created_at&order=created_at.desc&limit=20'),
      supabaseUserRequest(req, '/rest/v1/astracore_tool_registry?select=name,status&order=name.asc&limit=50'),
      supabaseUserRequest(req, '/rest/v1/astracore_evaluation_runs?select=id,status,overall_score,created_at&order=created_at.desc&limit=10')
    ]);
    return json(res, 200, {
      workspace: 'AstraCore', authenticated: true,
      user: { id: user.id, email: user.email, isAdmin: Boolean(user.isAdmin) },
      capabilities: capabilityCount,
      productionGate: {
        requireProductionReady: true,
        modelReady: modelDetails.some((model) => model.status === 'Ready'),
        models: modelDetails.map(({ id, name, role, status }) => ({ id, name, role, status }))
      },
      backend: { database: 'Supabase', api: 'AstraCore /api', deployment: 'Vercel' },
      models, tools, evaluations
    });
  }

  if (path === '/api/search' && req.method === 'GET') {
    const query = clamp(url.searchParams.get('q'), 200);
    if (!query) return json(res, 400, { error: 'q is required' });
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 10, 1), MAX_SEARCH);
    const escaped = encodeURIComponent(`*${query}*`);
    const rows = await supabaseUserRequest(req, `/rest/v1/astracore_conversations?user_id=eq.${encodeURIComponent(user.id)}&or=(title.ilike.${escaped})&select=id,title,model,created_at,updated_at&order=updated_at.desc&limit=${limit}`);
    return json(res, 200, { query, conversations: rows });
  }

  return false;
}
