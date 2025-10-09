import dotenv from "dotenv";
// FIX: Import QueryResultRow to use as a type constraint
import { Pool, QueryResult, QueryResultRow } from "pg";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
const PG_MAX_CLIENTS = Number(process.env.PG_MAX_CLIENTS || "10");
const PGVECTOR_DIM = Number(process.env.PGVECTOR_DIM || "1536");

if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in environment");
}

export const pgPool = new Pool({
    connectionString: DATABASE_URL,
    max: PG_MAX_CLIENTS,
});

pgPool.on("error", (err) => {
    // connection-level errors
    // In production, integrate with real telemetry (Sentry / Datadog)
    // but keep this informative
    // eslint-disable-next-line no-console
    console.error("Unexpected PG client error", err);
});

/**
 * Simple helper to run queries with automatic error handling.
 */
// FIX: Apply the QueryResultRow constraint to the generic type T
export async function query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const client = await pgPool.connect();
    try {
        const res = await client.query<T>(text, params);
        return res;
    } finally {
        client.release();
    }
}

/**
 * Convenience helper to insert a vector (Postgres pgvector).
 * embedding should be an array of numbers.
 */
export async function upsertEmbedding(
    chunkId: string,
    model: string,
    embedding: number[],
    extra: Record<string, any> = {}
) {
    const dim = embedding.length;
    const embeddingLiteral = `ARRAY[${embedding.join(",")}]::vector`;
    // Use parameterized for non-vector parts and raw for vector literal
    const text = `
    INSERT INTO embeddings (chunk_id, model, embedding, dim, norm, extra)
    VALUES ($1, $2, ${embeddingLiteral}, $3, $4, $5)
    RETURNING *;
  `;
    // compute simple L2 norm
    const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
    const params = [chunkId, model, dim, norm, JSON.stringify(extra)];
    return query(text, params);
}

/**
 * Return configured pgvector dim from env
 */
export function getVectorDim(): number {
    return PGVECTOR_DIM;
}

export default {
    pool: pgPool,
    query,
    upsertEmbedding,
    getVectorDim,
};
