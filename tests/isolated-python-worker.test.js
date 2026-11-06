import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { IsolatedPythonWorker, ISOLATED_WORKER_LIMITS } from '../src/core/isolated-python-worker.js';

const IMAGE = 'registry.example/astracore-python@sha256:' + 'a'.repeat(64);
const ENV = {
  PATH: '/usr/bin:/bin',
  ASTRA_SANDBOX_IMAGE: IMAGE,
  ASTRA_SANDBOX_DOCKER_HOST: 'unix:///run/astracore-sandbox/docker.sock',
};

function fakeSpawn({ stdout = '', stderr = '', exitCode = 0, closeDelay = 0 } = {}) {
  let captured;
  const spawnProcess = (command, args, options) => {
    captured = { command, args, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.killed = false;
    child.kill = (signal) => {
      child.killed = true;
      child.killSignal = signal;
      queueMicrotask(() => child.emit('close', null, signal));
      return true;
    };
    child.stdin.resume();
    child.stdin.on('data', () => {});
    queueMicrotask(() => {
      if (stdout) child.stdout.write(stdout);
      if (stderr) child.stderr.write(stderr);
      setTimeout(() => {
        child.stdout.end();
        child.stderr.end();
        child.emit('close', exitCode, null);
      }, closeDelay);
    });
    return child;
  };
  return { spawnProcess, getCaptured: () => captured };
}

test('sandbox fails closed without digest-pinned image or dedicated socket', async () => {
  const noImage = new IsolatedPythonWorker({ env: {}, spawnProcess: () => { throw new Error('must not spawn'); } });
  await assert.rejects(noImage.run({ code: 'print(1)' }), (error) => error.code === 'SANDBOX_IMAGE_NOT_PINNED');

  const sharedDaemon = new IsolatedPythonWorker({
    env: { ASTRA_SANDBOX_IMAGE: IMAGE, ASTRA_SANDBOX_DOCKER_HOST: 'unix:///var/run/docker.sock' },
    spawnProcess: () => { throw new Error('must not spawn'); },
  });
  await assert.rejects(sharedDaemon.run({ code: 'print(1)' }), (error) => error.code === 'SANDBOX_DAEMON_NOT_ISOLATED');
});

test('sandbox rejects empty and oversized source before starting a container', async () => {
  const fake = fakeSpawn();
  const worker = new IsolatedPythonWorker({ env: ENV, spawnProcess: fake.spawnProcess });
  await assert.rejects(worker.run({ code: '  ' }), (error) => error.code === 'INVALID_SANDBOX_INPUT');
  await assert.rejects(worker.run({ code: 'x'.repeat(17 * 1024) }), (error) => error.status === 413);
  assert.equal(fake.getCaptured(), undefined);
});

test('sandbox uses fixed gVisor, no-network, no-mount, read-only resource-limited container flags', async () => {
  const fake = fakeSpawn({ stdout: 'hello\\n' });
  const worker = new IsolatedPythonWorker({ env: ENV, spawnProcess: fake.spawnProcess });
  const result = await worker.run({ code: 'print("hello")' });
  const { command, args, options } = fake.getCaptured();
  assert.equal(command, 'docker');
  assert.equal(options.shell, false);
  assert.equal(options.env.DOCKER_HOST, ENV.ASTRA_SANDBOX_DOCKER_HOST);
  assert.equal(options.env.ASTRA_SANDBOX_IMAGE, undefined);
  for (const flag of [
    '--runtime=runsc', '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true', '--pids-limit=16', '--memory=64m',
    '--memory-swap=64m', '--cpus=0.25', '--user=65532:65532',
    '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=8m', '--pull=never',
  ]) assert.ok(args.includes(flag), 'missing ' + flag);
  assert.equal(args.some((arg) => arg.includes('/host') || arg.startsWith('--volume')), false);
  assert.equal(result.stdout, 'hello\\n');
  assert.equal(result.exitCode, 0);
  assert.equal(ISOLATED_WORKER_LIMITS.network, 'none');
});

test('sandbox clamps timeout and kills an over-time worker', async () => {
  let childRef;
  const fake = fakeSpawn({ closeDelay: 100 });
  const spawnProcess = (...args) => {
    childRef = fake.spawnProcess(...args);
    return childRef;
  };
  const worker = new IsolatedPythonWorker({ env: ENV, spawnProcess });
  await assert.rejects(
    worker.run({ code: 'while True: pass', timeoutMs: 100 }),
    (error) => error.code === 'SANDBOX_TIMEOUT' && error.status === 504,
  );
  assert.equal(childRef.killed, true);
  assert.equal(childRef.killSignal, 'SIGKILL');
});

test('sandbox bounds combined stdout and stderr and redacts secrets', async () => {
  const noisy = new IsolatedPythonWorker({
    env: ENV,
    spawnProcess: fakeSpawn({ stdout: 'x'.repeat(17 * 1024) }).spawnProcess,
  });
  await assert.rejects(noisy.run({ code: 'print("x")' }), (error) => error.code === 'SANDBOX_OUTPUT_TOO_LARGE');

  const redacting = new IsolatedPythonWorker({
    env: ENV,
    spawnProcess: fakeSpawn({ stdout: 'api_key=super-secret-value' }).spawnProcess,
  });
  const result = await redacting.run({ code: 'print("secret")' });
  assert.equal(result.stdout, '[REDACTED_SECRET]');
});
