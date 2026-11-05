import { redactSecrets } from '../core/safety-layer.js';

const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'blocked', 'cancelled']);

function clean(value, max = 500) {
  return redactSecrets(String(value ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim()).slice(0, max);
}

function leaseLostError() {
  return Object.assign(new Error('The agent job lease is no longer owned by this worker.'), {
    code: 'AGENT_JOB_LEASE_LOST',
    status: 409,
  });
}

/**
 * Creates one bounded worker tick. All persistence adapters must enforce the
 * lease token; completeJob must atomically persist the run result and mark the
 * queue row succeeded in one database transaction/RPC.
 */
export function createAgentWorker({
  workerId,
  claimJobs,
  heartbeatJob,
  readRun,
  persistProgress,
  executeTask,
  completeJob,
  failJob,
  leaseSeconds = 120,
  heartbeatIntervalMs = 30_000,
} = {}) {
  if (typeof workerId !== 'string' || !workerId.trim() || workerId.length > 128) {
    throw new Error('A valid workerId is required');
  }
  for (const [name, fn] of Object.entries({ claimJobs, heartbeatJob, readRun, persistProgress, executeTask, completeJob, failJob })) {
    if (typeof fn !== 'function') throw new Error('Worker adapter ' + name + ' is required');
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 900) {
    throw new Error('leaseSeconds must be between 15 and 900');
  }
  if (!Number.isInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 1 || heartbeatIntervalMs >= leaseSeconds * 1000) {
    throw new Error('heartbeatIntervalMs must be positive and shorter than the lease');
  }

  async function processJob(job) {
    if (!job || typeof job.id !== 'string' || typeof job.user_id !== 'string'
      || typeof job.run_id !== 'string' || typeof job.lease_token !== 'string') {
      return { job_id: job?.id || null, outcome: 'invalid_job_contract' };
    }

    let leaseLost = false;
    let completionAttempted = false;
    let heartbeatInFlight = Promise.resolve();
    const assertLease = () => {
      if (leaseLost) throw leaseLostError();
    };
    const timer = setInterval(() => {
      heartbeatInFlight = heartbeatInFlight.then(async () => {
        if (leaseLost) return;
        const renewed = await heartbeatJob({ job, workerId, leaseToken: job.lease_token, leaseSeconds });
        if (renewed !== true) leaseLost = true;
      }).catch(() => { leaseLost = true; });
    }, heartbeatIntervalMs);
    timer.unref?.();

    try {
      const run = await readRun({ runId: job.run_id, userId: job.user_id });
      assertLease();
      if (!run || run.id !== job.run_id || run.user_id !== job.user_id) {
        throw Object.assign(new Error('The queued job does not resolve to an agent run owned by its user.'), {
          code: 'AGENT_RUN_OWNERSHIP_MISMATCH',
          status: 403,
        });
      }

      if (run.cancel_requested_at || run.status === 'cancelled') {
        assertLease();
        completionAttempted = true;
        const committed = await completeJob({ job, result: { status: 'cancelled', reason: 'cancellation_requested' } });
        return { job_id: job.id, outcome: committed === true ? 'cancelled' : 'lease_lost' };
      }
      if (TERMINAL_RUN_STATES.has(run.status) || run.finished_at) {
        assertLease();
        completionAttempted = true;
        const committed = await completeJob({ job, result: { status: 'already_finished' } });
        return { job_id: job.id, outcome: committed === true ? 'already_finished' : 'lease_lost' };
      }
      if (run.status !== 'running') {
        throw Object.assign(new Error('The agent run is not in the running state.'), { code: 'AGENT_RUN_NOT_RUNNING', status: 409 });
      }

      const task = clean(run.plan?.task || job.payload?.task, 4000);
      if (!task || (job.payload?.task && clean(job.payload.task, 4000) !== task)) {
        throw Object.assign(new Error('The queued task does not match the persisted agent plan.'), { code: 'AGENT_JOB_PAYLOAD_MISMATCH', status: 400 });
      }
      const agentType = clean(run.agent_type || run.plan?.agent_type || 'general', 40) || 'general';

      const onProgress = async (state) => {
        assertLease();
        const saved = await persistProgress({ job, state });
        if (saved !== true) {
          leaseLost = true;
          throw leaseLostError();
        }
      };
      const isCancelled = async () => {
        assertLease();
        const latest = await readRun({ runId: job.run_id, userId: job.user_id });
        assertLease();
        if (!latest || latest.id !== job.run_id || latest.user_id !== job.user_id) {
          throw Object.assign(new Error('Agent run ownership changed during execution.'), { code: 'AGENT_RUN_OWNERSHIP_MISMATCH', status: 403 });
        }
        return Boolean(latest.cancel_requested_at || latest.status === 'cancelled');
      };

      const execution = await executeTask({ task, agentType, job, onProgress, isCancelled });
      await heartbeatInFlight;
      assertLease();
      completionAttempted = true;
      const committed = await completeJob({ job, result: { status: 'completed', execution } });
      return { job_id: job.id, outcome: committed === true ? 'completed' : 'lease_lost' };
    } catch (error) {
      await heartbeatInFlight;
      if (leaseLost || error?.code === 'AGENT_JOB_LEASE_LOST') {
        return { job_id: job.id, outcome: 'lease_lost' };
      }
      if (completionAttempted) {
        return { job_id: job.id, outcome: 'completion_unknown' };
      }
      if (error?.code === 'AGENT_RUN_CANCELLED') {
        try {
          assertLease();
          completionAttempted = true;
          const committed = await completeJob({ job, result: { status: 'cancelled', reason: 'cooperative_cancellation' } });
          return { job_id: job.id, outcome: committed === true ? 'cancelled' : 'lease_lost' };
        } catch {
          return { job_id: job.id, outcome: 'completion_unknown' };
        }
      }
      const status = Number(error?.status);
      const retryable = Number.isFinite(status) ? status >= 500 : true;
      try {
        assertLease();
        const state = await failJob({ job, error: clean(error?.message || 'Agent worker failed'), retryable });
        return { job_id: job.id, outcome: state || 'failure_recorded', retryable };
      } catch {
        return { job_id: job.id, outcome: leaseLost ? 'lease_lost' : 'failure_persist_failed', retryable };
      }
    } finally {
      clearInterval(timer);
      await heartbeatInFlight;
    }
  }

  async function runOnce({ limit = 1 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
      throw new Error('limit must be between 1 and 25');
    }
    const jobs = await claimJobs({ workerId, limit, leaseSeconds });
    if (!Array.isArray(jobs)) throw new Error('claimJobs must return an array');
    const results = [];
    for (const job of jobs) results.push(await processJob(job));
    return { claimed: jobs.length, results };
  }

  return Object.freeze({ runOnce });
}
