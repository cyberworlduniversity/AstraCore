import { randomUUID } from 'node:crypto';
import { authorizeTool } from './step16-27.js';
import { redactSecrets } from './safety-layer.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_SCHEMA_DEPTH = 8;

function fail(message, status = 400, code = 'TOOL_EXECUTION_REJECTED') {
  throw Object.assign(new Error(message), { status, code });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function jsonBytes(value, label, limit) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { fail(`${label} must be JSON serializable`); }
  if (typeof serialized !== 'string') fail(`${label} must be JSON serializable`);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > limit) fail(`${label} exceeds the ${limit}-byte limit`, 413);
  return { serialized, bytes };
}

function validateSchemaValue(value, schema, path, depth = 0) {
  if (depth > MAX_SCHEMA_DEPTH) fail('Tool schema nesting is too deep');
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) fail('Tool input schema is invalid', 500);
  const type = schema.type;
  const matches = type === 'object' ? isPlainObject(value)
    : type === 'array' ? Array.isArray(value)
    : type === 'string' ? typeof value === 'string'
    : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
    : type === 'integer' ? Number.isSafeInteger(value)
    : type === 'boolean' ? typeof value === 'boolean'
    : type === 'null' ? value === null
    : false;
  if (!matches) fail(`Invalid tool input at ${path}: expected ${String(type || 'a declared JSON type')}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    fail(`Invalid tool input at ${path}: value is not allowed`);
  }
  if (type === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) fail(`Invalid tool input at ${path}: string is too short`);
    if (schema.maxLength != null && value.length > schema.maxLength) fail(`Invalid tool input at ${path}: string is too long`);
  }
  if (type === 'number' || type === 'integer') {
    if (schema.minimum != null && value < schema.minimum) fail(`Invalid tool input at ${path}: value is too small`);
    if (schema.maximum != null && value > schema.maximum) fail(`Invalid tool input at ${path}: value is too large`);
  }
  if (type === 'array') {
    if (schema.maxItems != null && value.length > schema.maxItems) fail(`Invalid tool input at ${path}: too many items`);
    if (schema.items) value.forEach((item, index) => validateSchemaValue(item, schema.items, `${path}[${index}]`, depth + 1));
  }
  if (type === 'object') {
    const properties = schema.properties || {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`Missing required tool input: ${path}.${key}`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(properties, key)) fail(`Unexpected tool input: ${path}.${key}`);
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) validateSchemaValue(value[key], childSchema, `${path}.${key}`, depth + 1);
    }
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function redactOutput(value) {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactOutput);
  if (isPlainObject(value)) return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, redactOutput(child)])
  );
  return value;
}

function safeAuditEvent(event) {
  return Object.freeze({
    event: event.event,
    tool: event.tool,
    requestId: event.requestId,
    principalId: event.principalId,
    status: event.status,
    durationMs: event.durationMs,
    errorCode: event.errorCode,
  });
}

/**
 * Executes only a pre-registered adapter. This is an application policy boundary,
 * NOT an operating-system/container sandbox. Never register arbitrary user code here.
 */
export async function executeToolWithPolicy(tool, input, request = {}) {
  const requestId = String(request.requestId || randomUUID()).slice(0, 128);
  const principalId = String(request.userId || request.principalId || '').slice(0, 128);
  if (!principalId) fail('Authenticated principal ID is required for tool execution', 401, 'PRINCIPAL_REQUIRED');
  if (typeof request.audit !== 'function') fail('A trusted audit writer is required before tool execution', 503, 'AUDIT_UNAVAILABLE');
  if (typeof tool?.execute !== 'function') fail('Tool adapter is not implemented', 501, 'TOOL_NOT_IMPLEMENTED');
  const authorization = authorizeTool(tool, {
    ...request,
    explicitApproval: request.explicitApproval === true,
  });
  if (!authorization.allowed) fail(authorization.reason, 403, 'TOOL_NOT_AUTHORIZED');
  if (Array.isArray(request.allowedTools) && !request.allowedTools.includes(tool.name)) {
    fail('Tool is not in the caller allow-list', 403, 'TOOL_NOT_ALLOWLISTED');
  }

  if (!isPlainObject(input)) fail('Tool input must be a JSON object');
  const { serialized } = jsonBytes(input, 'Tool input', MAX_INPUT_BYTES);
  const parsed = JSON.parse(serialized);
  validateSchemaValue(parsed, tool.inputSchema || { type: 'object' }, '$');
  const frozenInput = deepFreeze(parsed);
  const timeoutMs = Math.min(Math.max(Number(tool.timeoutMs || tool.timeout_ms) || DEFAULT_TIMEOUT_MS, 100), MAX_TIMEOUT_MS);
  const controller = new AbortController();
  const startedAt = Date.now();
  const baseEvent = { tool: tool.name, requestId, principalId };

  await request.audit(safeAuditEvent({ ...baseEvent, event: 'tool.started', status: 'started' }));

  let timer;
  try {
    const execution = Promise.resolve().then(() => tool.execute(frozenInput, Object.freeze({
      signal: controller.signal,
      requestId,
      principalId,
    })));
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(Object.assign(new Error('Tool execution timed out'), { status: 504, code: 'TOOL_TIMEOUT' }));
        controller.abort(new Error('Tool execution deadline exceeded'));
      }, timeoutMs);
      timer.unref?.();
    });
    const result = await Promise.race([execution, timeout]);
    const { serialized: outputJson } = jsonBytes(result, 'Tool output', MAX_OUTPUT_BYTES);
    const redacted = redactOutput(JSON.parse(outputJson));
    await request.audit(safeAuditEvent({
      ...baseEvent, event: 'tool.completed', status: 'completed', durationMs: Date.now() - startedAt,
    }));
    return redacted;
  } catch (error) {
    const status = Number(error?.status) || 500;
    const code = String(error?.code || 'TOOL_EXECUTION_FAILED').slice(0, 80);
    await request.audit(safeAuditEvent({
      ...baseEvent, event: 'tool.failed', status: 'failed',
      durationMs: Date.now() - startedAt, errorCode: code,
    }));
    throw Object.assign(new Error(status === 504 ? 'Tool execution timed out' : 'Tool execution failed'), { status, code });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
