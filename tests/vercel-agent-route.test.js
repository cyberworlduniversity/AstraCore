import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.ASTRACORE_SUPABASE_URL = 'https://astracore-test.supabase.co';
process.env.ASTRACORE_SUPABASE_KEY = 'test-publishable-key';
process.env.ASTRACORE_SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-secret-that-is-never-real';
process.env.ASTRA_SESSION_SECRET = 'vercel-agent-route-test-session-secret';
process.env.ASTRA_PUBLIC_URL = 'http://127.0.0.1:8787';

const originalFetch = globalThis.fetch;
const auth = await import('../server/auth.js');
const { default: handler } = await import('../api/[...path].js?agent-service-role-wiring');

test('Vercel agent route receives the server-only Supabase service client', async () => {
  const flow = auth.oauthStart('google');
  const oauthCookie = flow.cookie.match(/^astracore_oauth=([^;]+)/)?.[1];
  assert.ok(oauthCookie);

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/token?grant_type=pkce')) {
      return new Response(JSON.stringify({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'agent-user@example.com',
          user_metadata: { name: 'Agent User' },
          app_metadata: { provider: 'google' },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'agent-user@example.com',
        user_metadata: { name: 'Agent User' },
        app_metadata: { provider: 'google' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target.endsWith('/rest/v1/rpc/create_astracore_agent_run_and_enqueue')) {
      assert.equal(options.headers.apikey, process.env.ASTRACORE_SUPABASE_SERVICE_ROLE_KEY);
      assert.equal(options.headers.Authorization, 'Bearer ' + process.env.ASTRACORE_SUPABASE_SERVICE_ROLE_KEY);
      const body = JSON.parse(options.body);
      assert.equal(body.p_user_id, '11111111-1111-4111-8111-111111111111');
      return new Response(JSON.stringify([{
        run_id: 'run-vercel-1',
        job_id: 'job-vercel-1',
        run_status: 'running',
        job_status: 'queued',
        created: true,
      }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('Unexpected test request: ' + target);
  };

  try {
    const session = await auth.exchangeOAuthCode('one-time-code', new URL(flow.url).searchParams.get('state'), {
      headers: { cookie: 'astracore_oauth=' + oauthCookie },
    });
    const req = Readable.from([JSON.stringify({
      task: 'Summarize the authenticated knowledge base',
      agent_type: 'research',
      execute: true,
      idempotency_key: 'vercel-agent-route-1',
    })]);
    req.url = '/api/agents';
    req.method = 'POST';
    req.headers = { host: 'astracore-test.local', cookie: auth.sessionCookie(session.token).split(';')[0] };

    const res = {
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(value) { this.body = JSON.parse(value); this.finished = true; },
    };

    await handler(req, res);
    assert.equal(res.statusCode, 202);
    assert.equal(res.body.agent_run.id, 'run-vercel-1');
    assert.equal(res.body.job.id, 'job-vercel-1');
    assert.equal(res.body.execution, 'queued');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
