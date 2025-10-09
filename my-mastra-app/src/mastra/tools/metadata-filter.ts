// src/tools/metadata-filter.ts
/**
 * Filters retrieved chunks using metadata.
 * Example filters: year, company, topic.
 */

import { logger } from "../config/mastra";
import { query } from "../config/database";

export type MetadataFilter = Record<string, string | number | Array<string | number>>;

export async function filterByMetadata(filters: MetadataFilter, topK = 5) {
  try {
    if (!filters || Object.keys(filters).length === 0) return [];

    const conditions: string[] = [];
    const params: any[] = [];

    let i = 1;
    for (const key in filters) {
      const val = filters[key];
      if (Array.isArray(val)) {
        conditions.push(`${key} = ANY($${i}::text[])`);
        params.push(val.map((v) => v.toString()));
      } else {
        conditions.push(`${key} = $${i}`);
        params.push(val);
      }
      i++;
    }

    const sql = `
      SELECT chunk_id, document_id, text, metadata
      FROM embeddings
      WHERE ${conditions.join(" AND ")}
      LIMIT $${i}
    `;
    params.push(topK);

    const res = await query(sql, params);
    return res.rows;
  } catch (err) {
    logger.error("filterByMetadata error", err);
    return [];
  }
}
