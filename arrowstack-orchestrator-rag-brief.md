# Arrowstack Orchestrator --- Vector DB (RAG) Integration Brief

## Objective

Add Retrieval-Augmented Generation (RAG) capabilities to the
Kubernetes-based Arrowstack Agent Orchestrator.

The system must:

1.  Index repositories and documents into a vector database\
2.  Retrieve relevant context during agent execution\
3.  Attach citations to run steps for observability\
4.  Remain container-native and Kubernetes-ready\
5.  Maintain approval gates and auditability

------------------------------------------------------------------------

## Architecture Addition

### New Components

1.  **Vector Database**
    -   Option A: PostgreSQL + pgvector (recommended default)
    -   Option B: Qdrant (if higher filtering/performance required)
2.  **Retrieval API Service**
    -   Handles embedding generation
    -   Handles chunk storage
    -   Handles similarity search
3.  **Indexer Job**
    -   Runs per repository or per run
    -   Chunks files
    -   Generates embeddings
    -   Upserts into vector DB

------------------------------------------------------------------------

## Data Model

### Chunk Object

Each indexed chunk must contain:

``` json
{
  "id": "chunk_...",
  "source_type": "repo|doc|run_artifact|ticket",
  "source_uri": "git@...#path",
  "chunk_text": "...",
  "metadata": {
    "repo": "repo-name",
    "branch": "main",
    "commit_sha": "abc123",
    "path": "src/auth/service.ts",
    "lang": "ts",
    "run_id": null,
    "tags": ["keycloak", "auth"]
  },
  "embedding": [1536 floats]
}
```

------------------------------------------------------------------------

## Embedding Model

Use:

-   `text-embedding-3-small` (default)
    -   1536 dimensions
    -   Cost-efficient
-   Optional upgrade: `text-embedding-3-large` (3072 dims)

------------------------------------------------------------------------

## Retrieval API Contract

### POST `/ingest`

``` json
{
  "repo": "repo-name",
  "branch": "main",
  "commit_sha": "abc123",
  "files": [
    {
      "path": "src/auth/service.ts",
      "content": "..."
    }
  ]
}
```

Behavior: - Chunk files - Generate embeddings - Upsert into vector DB

------------------------------------------------------------------------

### POST `/query`

``` json
{
  "query": "Where is Keycloak configured?",
  "filters": {
    "repo": "repo-name",
    "branch": "main"
  },
  "topK": 8
}
```

Response:

``` json
{
  "matches": [
    {
      "chunk_id": "chunk_01",
      "score": 0.83,
      "path": "src/auth/keycloak.ts",
      "snippet": "..."
    }
  ]
}
```

------------------------------------------------------------------------

## Agent Workflow Integration

For each run:

1.  Worker clones repository
2.  Indexer ingests key files (README, config, main modules)
3.  Supervisor calls `/query` before:
    -   Planning
    -   Patch generation
    -   Test analysis
4.  Retrieved chunks are:
    -   Injected into model context
    -   Logged in step record
    -   Emitted as `context.used` event
5.  ui-agent-view displays citations

------------------------------------------------------------------------

## Event Addition

Add new SSE event type:

``` json
{
  "type": "context.used",
  "runId": "run_123",
  "stepId": "step_05",
  "chunks": ["chunk_01", "chunk_04"]
}
```

------------------------------------------------------------------------

## Kubernetes Components

### Deployment: vector-db

If using pgvector: - Extend orchestrator Postgres with pgvector
extension

If using Qdrant: - Deploy as separate service (ClusterIP)

------------------------------------------------------------------------

### Deployment: retrieval-api

Environment variables: - `DATABASE_URL` - `OPENAI_API_KEY` -
`EMBEDDING_MODEL=text-embedding-3-small`

Mount: - None required (stateless)

------------------------------------------------------------------------

### Job: repo-indexer

Triggered: - On run creation - Or via CronJob for global indexing

------------------------------------------------------------------------

## Security Controls

-   No public ingress to vector DB
-   Retrieval API internal-only (ClusterIP)
-   Enforce max chunk size
-   Enforce max query size
-   Redact secrets before embedding
-   Log embedding + query usage for audit

------------------------------------------------------------------------

## Implementation Phases

### Phase 1 (MVP)

-   pgvector inside orchestrator Postgres
-   Basic file chunking
-   Retrieval for repo only
-   Citation display in UI

### Phase 2

-   Metadata filtering
-   Artifact indexing (plans, test reports)
-   Run history retrieval

### Phase 3

-   Cross-repo knowledge
-   Ticket + documentation indexing
-   Semantic diff awareness

------------------------------------------------------------------------

## Success Criteria

-   Agent can answer repo-specific questions without full repo context
-   Patch generation improves due to targeted retrieval
-   ui-agent-view shows context citations
-   No degradation in run stability
-   All retrieval actions logged
