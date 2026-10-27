import { validateChatInput, limitOutput } from "./safety.js";
import { ConversationMemory } from "./memory.js";

export class AstraCoreEngine {
  constructor({ tokenizer, model, memory = new ConversationMemory() }) {
    this.tokenizer = tokenizer;
    this.model = model;
    this.memory = memory;
  }

  chat(body) {
    const { message, maxNewTokens } = validateChatInput(body);
    this.memory.add("user", message);
    const ids = this.tokenizer.encode(this.memory.toPrompt());
    const generated = [];
    let state = ids.slice(-this.model.contextLength);

    for (let i = 0; i < maxNewTokens; i++) {
      const next = this.model.nextToken(state);
      generated.push(next);
      state = [...state, next].slice(-this.model.contextLength);
      if (next === this.tokenizer.eosId) break;
    }

    const text = limitOutput(this.tokenizer.decode(generated));
    this.memory.add("assistant", text);
    return { text, model: "astracore-neural-v0.1" };
  }
}
