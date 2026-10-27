const SPECIAL = Object.freeze({ PAD: 0, BOS: 1, EOS: 2, UNK: 3 });

export class CharacterTokenizer {
  constructor(vocabulary = null) {
    this.special = SPECIAL;
    this.chars = vocabulary ?? Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
    this.tokenToId = new Map([
      ['<pad>', SPECIAL.PAD],
      ['<bos>', SPECIAL.BOS],
      ['<eos>', SPECIAL.EOS],
      ['<unk>', SPECIAL.UNK]
    ]);
    this.chars.forEach((ch, i) => this.tokenToId.set(ch, i + 4));
    this.idToToken = new Map([...this.tokenToId].map(([token, id]) => [id, token]));
  }

  get vocabSize() { return this.tokenToId.size; }

  encode(text, { addBos = true, addEos = true } = {}) {
    const ids = [];
    if (addBos) ids.push(SPECIAL.BOS);
    for (const ch of String(text)) ids.push(this.tokenToId.get(ch) ?? SPECIAL.UNK);
    if (addEos) ids.push(SPECIAL.EOS);
    return ids;
  }

  decode(ids) {
    return ids.map(id => this.idToToken.get(id) ?? '').filter(t => !['<pad>', '<bos>', '<eos>'].includes(t)).join('');
  }

  toJSON() { return { chars: this.chars }; }
  static fromJSON(value) { return new CharacterTokenizer(value.chars); }
}
