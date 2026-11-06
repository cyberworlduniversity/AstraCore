import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { redactSecrets } from './safety-layer.js';

const MAX_CODE_BYTES = 16 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 5_000;
const REQUIRED_DOCKER_SOCKET_PREFIX = 'unix:///run/astracore-sandbox/';

function sandboxError(message, status = 503, code = 'SANDBOX_UNAVAILABLE') {
  return Object.assign(new Error(message), { status, code });
}

function readSandboxConfig(env) {
  const image = String(env.ASTRA_SANDBOX_IMAGE || '');
  const dockerHost = String(env.ASTRA_SANDBOX_DOCKER_HOST || '');
  if (!/^.+@sha256:[a-f0-9]{64}$/.test(image)) {
    throw sandboxError('A digest-pinned sandbox image is required', 503, 'SANDBOX_IMAGE_NOT_PINNED');
  }
  if (!dockerHost.startsWith(REQUIRED_DOCKER_SOCKET_PREFIX)) {
    throw sandboxError('A dedicated rootless sandbox Docker socket is required', 503, 'SANDBOX_DAEMON_NOT_ISOLATED');
  }
  return { image, dockerHost };
}

/**
 * Executes Python in a disposable gVisor container. This is deliberately
 * unavailable unless an operator provisions a dedicated rootless Docker daemon,
 * a digest-pinned image, and the runsc runtime. Never fall back to host execution.
 */
export class IsolatedPythonWorker {
  constructor({ env = process.env, spawnProcess = spawn } = {}) {
    this.env = env;
    this.spawnProcess = spawnProcess;
  }

  async run({ code, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
    if (typeof code !== 'string' || !code.trim()) {
      throw sandboxError('Python source code is required', 400, 'INVALID_SANDBOX_INPUT');
    }
    if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
      throw sandboxError('Python source exceeds the 16 KiB limit', 413, 'SANDBOX_INPUT_TOO_LARGE');
    }
    if (signal?.aborted) throw sandboxError('Isolated worker was cancelled', 499, 'SANDBOX_ABORTED');
    const { image, dockerHost } = readSandboxConfig(this.env);
    const timeout = Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 100), MAX_TIMEOUT_MS);
    const containerName = 'astracore-job-' + randomUUID();
    const spawnOptions = {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: this.env.PATH || '/usr/bin:/bin',
        DOCKER_HOST: dockerHost,
      },
    };
    const args = [
      'run', '--rm', '--interactive', '--pull=never',
      '--name=' + containerName,
      '--runtime=runsc',
      '--network=none',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges:true',
      '--pids-limit=16',
      '--memory=64m',
      '--memory-swap=64m',
      '--cpus=0.25',
      '--ulimit=nofile=32:32',
      '--ulimit=nproc=16:16',
      '--user=65532:65532',
      '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=8m',
      '--workdir=/tmp',
      '--entrypoint=/usr/local/bin/python3',
      image, '-I', '-S', '-B', '-',
    ];
    const started = Date.now();

    return new Promise((resolve, reject) => {
      let child;
      let stdout = '';
      let stderr = '';
      let outputBytes = 0;
      let settled = false;
      let timedOut = false;
      let aborted = false;
      let outputExceeded = false;
      let timer;

      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      };

      try {
        child = this.spawnProcess('docker', args, spawnOptions);
      } catch {
        finishReject(sandboxError('Unable to start isolated worker', 503, 'SANDBOX_START_FAILED'));
        return;
      }

      const kill = () => {
        // Kill the container through the dedicated daemon before stopping the attached CLI.
        // The random name is generated here and is never derived from user input.
        try {
          const killer = this.spawnProcess('docker', ['kill', containerName], {
            shell: false, windowsHide: true, stdio: 'ignore', env: spawnOptions.env,
          });
          killer.on('error', () => {});
        } catch { /* daemon may not have created the container */ }
        try { child.kill('SIGKILL'); } catch { /* process may already have exited */ }
      };
      const collect = (target, chunk) => {
        const text = chunk.toString('utf8');
        outputBytes += Buffer.byteLength(text, 'utf8');
        if (outputBytes > MAX_OUTPUT_BYTES) {
          outputExceeded = true;
          kill();
          return;
        }
        if (target === 'stdout') stdout += text;
        else stderr += text;
      };

      child.stdout.on('data', (chunk) => collect('stdout', chunk));
      child.stderr.on('data', (chunk) => collect('stderr', chunk));
      child.on('error', () => {
        finishReject(sandboxError('Isolated worker process failed to start', 503, 'SANDBOX_START_FAILED'));
      });
      child.on('close', (exitCode, signal) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        const durationMs = Date.now() - started;
        if (timedOut) {
          reject(sandboxError('Isolated worker exceeded its execution deadline', 504, 'SANDBOX_TIMEOUT'));
          return;
        }
        if (aborted) {
          reject(sandboxError('Isolated worker was cancelled', 499, 'SANDBOX_ABORTED'));
          return;
        }
        if (outputExceeded) {
          reject(sandboxError('Isolated worker exceeded its output limit', 413, 'SANDBOX_OUTPUT_TOO_LARGE'));
          return;
        }
        resolve({
          exitCode,
          signal: signal || null,
          stdout: redactSecrets(stdout),
          stderr: redactSecrets(stderr),
          durationMs,
        });
      });

      const onAbort = () => {
        aborted = true;
        kill();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, timeout);
      child.stdin.on('error', () => {
        // A worker that exits early is reported through its close event.
      });
      child.stdin.end(code);
    });
  }
}

export const ISOLATED_WORKER_LIMITS = Object.freeze({
  maxCodeBytes: MAX_CODE_BYTES,
  maxOutputBytes: MAX_OUTPUT_BYTES,
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  maxTimeoutMs: MAX_TIMEOUT_MS,
  runtime: 'runsc',
  network: 'none',
  memory: '64m',
  cpus: '0.25',
  pids: 16,
});

/**
 * Creates a registry-compatible adapter. It is disabled unless the operator
 * explicitly opts in after provisioning and validating the isolated daemon.
 */
export function createIsolatedPythonTool(worker, { enabled = false } = {}) {
  if (!worker || typeof worker.run !== 'function') {
    throw new TypeError('An IsolatedPythonWorker instance is required');
  }
  return {
    name: 'code_execution',
    description: 'Execute a short Python program in a disposable gVisor container with no network access.',
    status: enabled === true ? 'enabled' : 'disabled',
    risk: 'high',
    riskLevel: 'high',
    timeoutMs: MAX_TIMEOUT_MS + 1_000,
    inputSchema: {
      type: 'object',
      required: ['code'],
      additionalProperties: false,
      properties: {
        code: { type: 'string', minLength: 1, maxLength: MAX_CODE_BYTES },
      },
    },
    execute: async ({ code }, context = {}) => worker.run({
      code,
      timeoutMs: MAX_TIMEOUT_MS,
      signal: context.signal,
    }),
  };
}
