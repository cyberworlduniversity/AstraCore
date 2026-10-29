export class ModelProvider {
  constructor({ id, name, engine = null, tokenizer = null, metadata = {} } = {}) {
    this.id = id || 'unknown-model';
    this.name = name || this.id;
    this.engine = engine;
    this.tokenizer = tokenizer;
    this.metadata = { ...metadata };
  }

  async generate(prompt, options = {}) {
    if (!this.engine || typeof this.engine.generate !== 'function') {
      throw new Error('Model provider generation is not implemented');
    }
    return this.engine.generate(prompt, options);
  }

  async *stream(prompt, options = {}) {
    const result = await this.generate(prompt, options);
    yield typeof result === 'string' ? result : result?.text ?? '';
  }

  countTokens(text = '') {
    if (this.tokenizer?.encode) return this.tokenizer.encode(String(text)).length;
    return String(text).length;
  }

  async load() {
    if (this.engine?.load) await this.engine.load();
    return this;
  }

  async unload() {
    if (this.engine?.unload) await this.engine.unload();
    return this;
  }

  getModelInfo() {
    return {
      id: this.id,
      name: this.name,
      provider: 'AstraCore-native',
      ...this.metadata,
      knowledgeSource: 'model weights only; external knowledge is retrieved separately',
    };
  }
}

export function createModelProvider(config = {}) {
  return new ModelProvider(config);
}
