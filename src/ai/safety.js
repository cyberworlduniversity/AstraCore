const MAX_INPUT = 4000;
const MAX_NEW_TOKENS = 256;

export function validateChatInput(body) {
  if (!body || typeof body !== "object") throw new Error("Invalid request body");
  if (typeof body.message !== "string") throw new Error("message must be a string");
  if (!body.message.trim()) throw new Error("message cannot be empty");
  if (body.message.length > MAX_INPUT) throw new Error("message exceeds 4000 characters");
  const requested = Number(body.maxNewTokens);
  return { message: body.message, maxNewTokens: Math.min(Math.max(Number.isFinite(requested) ? Math.floor(requested) : 64, 1), MAX_NEW_TOKENS) };
}

export function limitOutput(text, maxChars = 16000) {
  return String(text).slice(0, maxChars);
}
