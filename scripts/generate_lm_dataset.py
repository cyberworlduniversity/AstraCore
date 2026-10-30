import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

CONCEPTS = [
    ("authentication", "Authentication verifies that a user controls an identity before access is granted."),
    ("authorization", "Authorization determines which actions an authenticated identity is permitted to perform."),
    ("least privilege", "Least privilege gives each identity only the permissions required for its task."),
    ("rate limiting", "Rate limiting bounds request volume so abusive or accidental bursts cannot exhaust a service."),
    ("input validation", "Input validation rejects malformed or unexpected data at the trust boundary before processing."),
    ("output encoding", "Output encoding prevents data from being interpreted as executable markup in a browser."),
    ("SQL injection", "SQL injection occurs when untrusted input changes the structure of a database query."),
    ("cross site scripting", "Cross site scripting occurs when attacker-controlled content executes in a victim browser."),
    ("CSRF", "CSRF abuses a browser session to make an unwanted state-changing request on behalf of a user."),
    ("path traversal", "Path traversal attempts to escape an intended directory by manipulating path components."),
    ("SSRF", "SSRF causes a server to make a request to an attacker-chosen destination and can expose internal services."),
    ("command injection", "Command injection happens when untrusted input is interpreted as operating-system commands."),
    ("secret management", "Secrets should be stored in protected secret storage and never committed to source control."),
    ("audit logging", "Audit logs record security-relevant events with request identifiers and enough context for investigation."),
    ("encryption at rest", "Encryption at rest protects stored data if storage media or snapshots are exposed."),
    ("TLS", "TLS protects data in transit by authenticating endpoints and encrypting the connection."),
    ("hashing", "A cryptographic hash maps input to a fixed-size digest and is useful for integrity verification."),
    ("password hashing", "Password hashing uses a deliberately expensive password-specific function rather than reversible encryption."),
    ("RLS", "Row level security restricts database rows according to the authenticated identity and policy conditions."),
    ("tenant isolation", "Tenant isolation prevents one customer or user from reading or changing another customer's data."),
    ("backup", "A backup is useful only when it can be restored successfully and the restoration procedure is tested."),
    ("rollback", "Rollback returns a deployment or model to a previously verified version after a failed release."),
    ("health check", "A health check reports whether a process is alive and whether required dependencies are ready."),
    ("observability", "Observability combines logs, metrics, and traces to explain system behavior and failures."),
    ("request id", "A request identifier links related logs and downstream operations for one request."),
    ("timeout", "A timeout bounds how long an operation may consume resources before the caller receives a failure."),
    ("retry", "A retry is appropriate only for failures that are transient and safe to repeat."),
    ("circuit breaker", "A circuit breaker temporarily stops calls to an unhealthy dependency to prevent cascading failure."),
    ("idempotency", "Idempotency makes repeated execution of the same operation produce the same intended state."),
    ("transaction", "A database transaction groups related changes so they commit atomically or roll back together."),
    ("index", "A database index can accelerate selective queries but adds storage and write maintenance cost."),
    ("foreign key", "A foreign key enforces a relationship between a child row and a referenced parent row."),
    ("migration", "A database migration changes schema in a versioned and repeatable way."),
    ("vector embedding", "A vector embedding represents text as numeric coordinates that can be compared for semantic similarity."),
    ("cosine similarity", "Cosine similarity compares the angle between vectors and is commonly used for normalized embeddings."),
    ("RAG", "Retrieval augmented generation retrieves relevant evidence before generation so answers can be grounded in sources."),
    ("hybrid retrieval", "Hybrid retrieval combines lexical and vector signals to improve recall across different query types."),
    ("reranking", "Reranking applies a stronger relevance model to a smaller candidate set after initial retrieval."),
    ("citation", "A citation should point to a retrieved source that actually supports the associated claim."),
    ("prompt injection", "Prompt injection attempts to make untrusted content override higher-priority instructions."),
    ("tool authorization", "Tool authorization checks whether the current identity and context permit a requested tool action."),
    ("sandbox", "A sandbox isolates untrusted code from production secrets, filesystem access, and network privileges."),
    ("agent orchestration", "Agent orchestration controls which specialist runs, what tools it can use, and when execution stops."),
    ("planner agent", "A planner agent decomposes a goal into bounded steps instead of executing an unbounded loop."),
    ("memory", "Memory stores selected information for later retrieval while respecting consent, isolation, and retention rules."),
    ("data minimization", "Data minimization collects and retains only information necessary for the stated purpose."),
    ("PII filtering", "PII filtering detects and removes or protects personal information before data enters a training corpus."),
    ("deduplication", "Deduplication removes repeated or near-repeated records so evaluation and training are not biased by copies."),
    ("data provenance", "Data provenance records where training data came from and under which license or permission it was obtained."),
    ("train validation test split", "Separate train, validation, and test sets prevent model selection from contaminating final evaluation."),
    ("checkpoint", "A model checkpoint stores enough state to reload a verified training result."),
    ("model hash", "A model hash provides an integrity identifier for the exact checkpoint bytes that were evaluated."),
    ("evaluation gate", "An evaluation gate promotes a candidate only when measured criteria are satisfied."),
    ("perplexity", "Perplexity is the exponential of average language-model cross entropy and reflects predictive uncertainty."),
    ("cross entropy", "Cross entropy measures the negative log likelihood assigned to observed target tokens."),
    ("gradient clipping", "Gradient clipping limits gradient magnitude to reduce instability from unusually large updates."),
    ("learning rate", "The learning rate controls the size of parameter updates during optimization."),
    ("checkpoint resume", "Checkpoint resume restores model and optimizer state so training can continue after interruption."),
    ("tokenizer", "A tokenizer maps text to model vocabulary identifiers and must remain compatible with a trained checkpoint."),
    ("context window", "A context window limits how many tokens the model can process in one sequence."),
    ("attention", "Self-attention lets each token use information from other positions in the permitted context."),
    ("causal mask", "A causal mask prevents a language model from reading future target tokens during training."),
    ("weight tying", "Weight tying reuses token embedding weights for the output projection and can reduce parameters."),
    ("temperature", "Sampling temperature changes the sharpness of a probability distribution during text generation."),
    ("deterministic evaluation", "Deterministic evaluation fixes seeds and decoding settings so repeated measurements are comparable."),
    ("document extraction", "Document extraction converts supported files into normalized text and metadata for downstream processing."),
    ("OCR", "Optical character recognition converts text visible in images into machine-readable characters."),
    ("chunking", "Chunking divides documents into bounded passages that can be indexed and retrieved efficiently."),
    ("file validation", "File validation checks type, size, structure, and content constraints before processing an upload."),
    ("MIME type", "A MIME type describes the media format of a file or HTTP payload but should not be trusted alone for validation."),
    ("web fetch", "A web fetch retrieves external content that must be treated as untrusted input."),
    ("source verification", "Source verification checks that retrieved content and metadata actually support the intended claim."),
    ("web deduplication", "Web deduplication removes repeated pages or mirrored content before ranking research evidence."),
    ("code indexing", "Code indexing makes functions, classes, symbols, and relevant text retrievable for repository assistance."),
    ("dependency analysis", "Dependency analysis identifies direct and transitive packages and their known security or compatibility risks."),
    ("static analysis", "Static analysis examines code without executing it to detect patterns associated with defects or vulnerabilities."),
    ("test generation", "Test generation proposes executable tests that should be run and evaluated rather than trusted by appearance."),
    ("patch verification", "Patch verification checks that a proposed code change passes regression and security tests."),
    ("structured errors", "Structured errors give clients stable machine-readable fields without exposing sensitive internals."),
    ("schema validation", "Schema validation checks request fields and types before business logic executes."),
    ("content security policy", "A content security policy restricts which browser resources may execute or load."),
    ("HSTS", "HTTP Strict Transport Security tells compliant browsers to use HTTPS for a protected domain."),
    ("security headers", "Security headers add browser-enforced restrictions that reduce common web attack surfaces."),
    ("session security", "Session security protects session identifiers from theft, fixation, replay, and excessive lifetime."),
    ("cookie flags", "Secure, HttpOnly, and appropriate SameSite cookie attributes reduce common session attack risks."),
    ("CSRF token", "A CSRF token binds a state-changing browser request to an expected session context."),
    ("CORS", "Cross-origin resource sharing controls which browser origins may call a web API."),
    ("concurrency", "Concurrency testing measures behavior when multiple requests execute at the same time."),
    ("p95 latency", "p95 latency is the response time below which 95 percent of measured requests complete."),
    ("error rate", "Error rate is the proportion of requests or operations that fail under a defined measurement window."),
    ("resource usage", "Resource usage measures CPU, memory, disk, and other limits that can constrain reliability."),
    ("graceful shutdown", "Graceful shutdown stops accepting new work and allows in-flight operations to finish within a deadline."),
    ("feature flag", "A feature flag can control rollout without changing the deployed artifact, but flags must have safe defaults."),
    ("release candidate", "A release candidate is a version that has passed required validation and is awaiting final promotion."),
    ("production registry", "A production registry records which verified model or software version is currently approved."),
    ("artifact retention", "Artifact retention defines how long checkpoints and test outputs remain available for audit or rollback."),
    ("reproducibility", "Reproducibility requires versioned inputs, configuration, code, and seeds sufficient to repeat an experiment."),
    ("license compliance", "License compliance requires tracking whether data and dependencies may legally be used for the intended purpose."),
    ("supply chain", "Software supply-chain security reduces risk from compromised dependencies, build steps, or release artifacts."),
    ("dependency pinning", "Dependency pinning records exact versions so builds do not silently change between executions."),
    ("secret scanning", "Secret scanning searches commits and artifacts for credentials that should never be published."),
    ("threat modeling", "Threat modeling identifies assets, trust boundaries, attacker capabilities, and mitigations before release."),
    ("security incident", "A security incident should trigger containment, evidence preservation, investigation, and recovery procedures."),
]

TEMPLATES = [
    "Define {name}. {fact}",
    "Why is {name} important in a production AI system? {fact}",
    "Explain {name} in practical terms. {fact}",
    "What should an engineer verify about {name}? {fact} Verification should be evidence based.",
    "Give a safe engineering rule for {name}. {fact}",
    "How does {name} affect reliability or security? {fact}",
    "AstraCore engineering note: {name}. {fact}",
    "A production checklist item is {name}. {fact}",
    "What is a common mistake involving {name}? Ignoring the rule that follows is unsafe: {fact}",
    "How should {name} be measured? Measure the concrete behavior described here: {fact}",
    "What evidence supports a {name} release decision? Start with this principle: {fact}",
    "Summarize {name} for a developer. {fact}",
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='datasets/astracore-lm-v1.0')
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()
    root = Path(args.output)
    root.mkdir(parents=True, exist_ok=True)
    records = []
    for concept_index, (name, fact) in enumerate(CONCEPTS):
        for variant_index, template in enumerate(TEMPLATES):
            text = template.format(name=name, fact=fact)
            records.append({'id': f'c{concept_index:03d}-v{variant_index:02d}', 'text': text, 'source': 'original-astracore-engineering-curriculum', 'license': 'CC0-1.0', 'concept': name})
    # Deterministic split: 1008 train, 108 validation, 84 test.
    train_end = 1008
    validation_end = 1116
    for index, record in enumerate(records):
        record['split'] = 'train' if index < train_end else 'validation' if index < validation_end else 'test'
    jsonl = root / 'records.jsonl'
    with jsonl.open('w', encoding='utf-8') as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + '\n')
    for split in ('train', 'validation', 'test'):
        rows = [r['text'] for r in records if r['split'] == split]
        (root / f'{split}.txt').write_text('\n\n'.join(rows) + '\n', encoding='utf-8')
    digest = hashlib.sha256(jsonl.read_bytes()).hexdigest()
    metadata = {
        'dataset_id': 'astracore-lm-v1.0',
        'dataset_version': '1.0.0',
        'source': 'original-astracore-engineering-curriculum',
        'license': 'CC0-1.0',
        'document_count': len(records),
        'train_count': train_end,
        'validation_count': validation_end - train_end,
        'test_count': len(records) - validation_end,
        'hash': digest,
        'created_at': datetime.now(timezone.utc).isoformat(),
        'generation_seed': args.seed,
        'provenance': 'Deterministic original curriculum records generated by scripts/generate_lm_dataset.py; no private or third-party corpus is ingested.'
    }
    (root / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(metadata, indent=2))


if __name__ == '__main__':
    main()
