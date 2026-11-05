const SHA256 = /^[a-f0-9]{64}$/i;

function validateBaseUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('A valid Supabase URL is required'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:')) {
    throw new Error('The worker requires HTTPS for remote Supabase connections');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new Error('Supabase URL must be an origin without credentials, path, query, or fragment');
  }
  return parsed.origin;
}

export function createSupabaseAgentWorkerAdapters({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  const baseUrl = validateBaseUrl(supabaseUrl);
  if (typeof serviceRoleKey !== 'string' || serviceRoleKey.length < 32) {
    throw new Error('A server-only Supabase service-role key is required');
  }
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000) throw new Error('timeoutMs must be between 1000 and 60000');

  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(baseUrl + path, {
        method,
        headers: {
          apikey: serviceRoleKey,
          Authorization: 'Bearer ' + serviceRoleKey,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!response.ok) {
        throw Object.assign(new Error('Supabase worker request failed with HTTP ' + response.status), {
          status: response.status,
          code: 'SUPABASE_WORKER_REQUEST_FAILED',
        });
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  const rpc = (name, args) => request('/rest/v1/rpc/' + name, { method: 'POST', body: args });

  return Object.freeze({
    async claimJobs({ workerId, limit, leaseSeconds }) {
      const rows = await rpc('claim_astracore_agent_jobs', {
        p_worker_id: workerId,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      return Array.isArray(rows) ? rows : [];
    },

    async heartbeatJob({ job, workerId, leaseToken, leaseSeconds }) {
      const renewed = await rpc('heartbeat_astracore_agent_job', {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_lease_token: leaseToken,
        p_lease_seconds: leaseSeconds,
      });
      return renewed === true;
    },

    async readRun({ runId, userId }) {
      const params = new URLSearchParams({
        id: 'eq.' + runId,
        user_id: 'eq.' + userId,
        select: '*',
        limit: '1',
      });
      const rows = await request('/rest/v1/astracore_agent_runs?' + params.toString());
      return Array.isArray(rows) ? rows[0] || null : null;
    },

    async persistProgress({ job, state, workerId, leaseToken }) {
      const saved = await rpc('persist_astracore_agent_run_progress', {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_lease_token: leaseToken,
        p_execution_state: state,
      });
      return saved === true;
    },

    async completeJob({ job, workerId, leaseToken, result }) {
      const execution = result?.execution && typeof result.execution === 'object' ? result.execution : {};
      const state = result?.status === 'cancelled'
        ? { phase: 'cancelled' }
        : {
            phase: 'completed',
            steps_completed: Array.isArray(execution.plan?.steps) ? execution.plan.steps.length : 0,
            tool_calls_completed: Array.isArray(execution.tool_results) ? execution.tool_results.length : 0,
          };
      return rpc('finalize_astracore_agent_job', {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_lease_token: leaseToken,
        p_result: result,
        p_execution_state: state,
      });
    },

    async failJob({ job, workerId, leaseToken, error, retryable }) {
      return rpc('fail_astracore_agent_job', {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_lease_token: leaseToken,
        p_error: error,
        p_retryable: retryable,
      });
    },

    async knowledgeSearch({ userId, query, limit = 5 }) {
      const rows = await rpc('search_astracore_knowledge_for_user', {
        p_user_id: userId,
        search_query: String(query || '').slice(0, 2000),
        result_limit: Math.min(Math.max(Number(limit) || 5, 1), 20),
      });
      return Array.isArray(rows) ? rows : [];
    },
  });
}
