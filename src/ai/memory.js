export class ConversationMemory {
  constructor({ maxTurns = 12 } = {}) {
    this.maxTurns = maxTurns;
    this.turns = [];
  }

  add(role, content) {
    this.turns.push({ role, content: String(content) });
    if (this.turns.length > this.maxTurns) this.turns.splice(0, this.turns.length - this.maxTurns);
  }

  recent() { return [...this.turns]; }
  clear() { this.turns.length = 0; }
  toPrompt() { return this.turns.map(t => `${t.role}: ${t.content}`).join("\n"); }
}
