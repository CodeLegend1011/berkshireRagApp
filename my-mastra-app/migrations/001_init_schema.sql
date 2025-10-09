-- 001_init_schema.sql
-- Initialize schema for Berkshire RAG (Postgres + pgvector)
-- NOTE: adjust embedding vector dimension if your Gemini embeddings differ (default used below: 1536).
-- If using Neon, run these in the Neon query console or via psql with proper DATABASE_URL.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for UUID generation
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector extension

-- Table: documents
-- Stores raw text chunks, metadata, and embeddings
CREATE TABLE IF NOT EXISTS documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file     TEXT,                      -- e.g., "1978.pdf"
  source_page     INT,                       -- page number if available
  year            INT,                       -- document year for metadata filtering
  title           TEXT,                      -- optional title
  content         TEXT NOT NULL,             -- chunk text
  metadata        JSONB DEFAULT '{}'::jsonb, -- arbitrary metadata (company, topic, etc.)
  embedding       VECTOR(1536),              -- adjust dimension to match Gemini embedding size
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Recommended: ivfflat index for fast approximate nearest neighbors.
-- Requires setting the number of lists depending on data size (tune later).
-- If you have small dataset, you may also use brute-force index (no index) or use pgvector's "vector_cosine_ops" with ivfflat.
CREATE INDEX IF NOT EXISTS documents_embedding_idx
  ON documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Table: citations
-- Tracks citations used in responses (one row per citation)
CREATE TABLE IF NOT EXISTS citations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID REFERENCES documents(id) ON DELETE SET NULL,
  snippet_start INT,    -- approximate position, optional
  snippet_end   INT,
  quote         TEXT,
  relevance     FLOAT,  -- score returned by retrieval
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Table: conversations
-- Minimal conversation store for Mastra persistence & session linking
CREATE TABLE IF NOT EXISTS conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    TEXT UNIQUE,        -- external session id (e.g., user cookie)
  title         TEXT,
  context       JSONB DEFAULT '{}'::jsonb, -- serialized thread or state
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Table: reflection_memory
-- Stores Reflection Memory entries (user intent, key topics, personalization)
CREATE TABLE IF NOT EXISTS reflection_memory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  memory_key    TEXT NOT NULL,
  memory_value  JSONB NOT NULL,
  score         FLOAT DEFAULT 1.0,      -- optional importance score
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Table: analytics
-- Stores summary metrics for queries: response times, retrieval counts, success flags
CREATE TABLE IF NOT EXISTS analytics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        TEXT,
  query_text        TEXT NOT NULL,
  response_time_ms  INT,
  retrieved_count   INT,
  retrieval_score   FLOAT,   -- e.g., avg similarity
  success           BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Table: hybrid_metadata (optional)
-- If you want a normalized metadata table for year/company/topic lookups
CREATE TABLE IF NOT EXISTS hybrid_metadata (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID REFERENCES documents(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  value         TEXT NOT NULL
);

-- Utility: update timestamp trigger for conversations & reflection_memory
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS conversations_set_updated_at ON conversations;
CREATE TRIGGER conversations_set_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS reflection_set_updated_at ON reflection_memory;
CREATE TRIGGER reflection_set_updated_at
BEFORE UPDATE ON reflection_memory
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- End of migration
