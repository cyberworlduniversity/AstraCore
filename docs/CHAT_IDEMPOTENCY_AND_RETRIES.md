# Chat idempotency and retry safety

## Behavior

Every browser chat submission creates one UUID `requestId`. The Retry control reuses that exact ID and the original message text.

The API derives stable UUID primary keys for the conversation, user message, and assistant message from the request ID plus the authenticated user and conversation scope. It uses PostgREST conflict-ignore inserts against the existing primary-key constraints; no database schema migration is required.

Before generation, the handler:
1. Resolves the same conversation ID for a retried first message.
2. Inserts the user message idempotently.
3. Reads the stored user message under both conversation and owner filters and rejects a reused key with different text (HTTP 409).
4. Returns a previously saved assistant message when one exists, avoiding another generation on a completed retry.

After generation, the assistant message is inserted with its deterministic ID. If concurrent attempts race, the unique primary key allows only one saved assistant message; the handler reads and returns that canonical saved response.

## Failure and retry behavior

- If model generation fails after the user message is saved, the same request can be retried without duplicating the user message.
- If the assistant message was saved but the HTTP response was lost, retry returns the saved answer.
- If a request ID is reused with different message text, the API returns HTTP 409.
- IDs are scoped using authenticated user and conversation identity; a different user cannot collide into another user's message.
- The UI retains the request ID and original text in its Retry action. A new intentional message receives a new request ID.

## Security and deployment notes

- Existing RLS and owner filters remain in force.
- No Supabase migration, production data write, merge, or deployment was performed for this change.
- Both the Vercel API handler and Node server handler implement the same persistence behavior.
- The new regression tests run through the repository's existing `npm test` command.
