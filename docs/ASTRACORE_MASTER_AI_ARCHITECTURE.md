# AstraCore Master AI Agent Architecture

## Principle
AstraCore is a knowledge orchestrator, not a claim that its neural weights contain all world knowledge.

**Understand → Retrieve → Verify → Reason → Act → Explain**

## Current implemented foundation
- `src/core/model-provider.js` — provider abstraction around AstraCore-native models.
- `src/core/router.js` — deterministic intent routing for model, files, memory, web, calculation, code and data-analysis requests.
- `src/core/knowledge.js` — deterministic text chunking and explicit ingestion support boundaries.
- `src/core/source.js` — provenance records and retrieved-data isolation markers.
- `src/core/orchestrator.js` — context assembly and honest capability status handling.
- `src/core/tools.js` — permission/risk-aware tool registry.
- Supabase knowledge, chunk, memory, tool and audit tables with RLS.
- PostgreSQL full-text search and pgvector storage are ready; semantic embedding generation is not yet implemented.

## Capability status
| Capability | Status |
|---|---|
| AstraCoreLM provider abstraction | IMPLEMENTED |
| Conversation storage | IMPLEMENTED |
| User memory storage API | IMPLEMENTED in data layer; API wiring incremental |
| Text/Markdown/JSON/CSV/HTML ingestion | FOUNDATION IMPLEMENTED |
| PostgreSQL keyword retrieval | IMPLEMENTED |
| pgvector storage | IMPLEMENTED |
| Hybrid semantic retrieval | PARTIAL — embedding provider NOT IMPLEMENTED |
| PDF/DOCX/PPTX/XLSX extraction | NOT IMPLEMENTED |
| OCR | NOT IMPLEMENTED |
| Web search | NOT IMPLEMENTED |
| Sandboxed Python execution | NOT IMPLEMENTED |
| Structured database agent | NOT IMPLEMENTED |
| Vision/image understanding | NOT IMPLEMENTED |
| MCP source adapters | NOT IMPLEMENTED |
| Admin knowledge panel | NOT IMPLEMENTED |
| Evaluation suite | FOUNDATION ONLY |

## Security model
Retrieved files and web content are data, never higher-priority instructions. Tool execution requires explicit registry status and permission checks. User knowledge is isolated by `auth.uid()` RLS policies.

## Retrieval
The database supports keyword retrieval and a 384-dimensional vector column. An embedding model/provider must be connected before semantic retrieval can be truthfully marked active.

## Azure compatibility
Azure Blob, Azure SQL, SharePoint, OneLake, Azure AI Search and web retrieval can be added behind provider interfaces. They are not required by the core architecture and are not assumed to be connected.
