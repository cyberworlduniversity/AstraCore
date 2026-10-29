# AstraCoreEmbed training data

Use approved semantic pairs in JSONL format:

```json
{"left":"How do I reset my password?","right":"Steps for changing or recovering an account password."}
```

The dataset must contain real positive semantic pairs. Do not generate synthetic labels merely to make training appear successful.

Before production indexing, train and validate AstraCoreEmbed v0.1 and keep the vector search disabled until a real checkpoint is available.
