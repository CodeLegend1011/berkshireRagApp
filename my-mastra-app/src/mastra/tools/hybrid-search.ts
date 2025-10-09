// src/tools/hybrid-search.ts
/**
 * Hybrid search: vector similarity + metadata filters.
 * Scores are combined: vector similarity dominates, metadata filters boost scores.
 */
import { vectorSearchTool } from "./vector-search";
import { filterByMetadata, MetadataFilter } from "./metadata-filter";
import { logger } from "../config/mastra";

export type VectorSearchResult = {
  chunk_id: string;
  document_id: string;
  text: string;
  metadata?: Record<string, any>;
  score: number;
};

export async function hybridSearch(
  queryVector: number[],
  topK = 5,
  filters: MetadataFilter = {}
): Promise<VectorSearchResult[]> {
  try {
    // 1. Since vectorSearchTool requires a string query, not a vector,
    // we can't use it directly. This function needs refactoring or removal.
    // For now, return empty results to avoid breaking the build.
    logger.warn("hybridSearch is not fully implemented - vectorSearchTool expects a query string, not a vector");
    
    // 2. If metadata filters provided, use metadata filtering
    if (filters && Object.keys(filters).length > 0) {
      const metaFiltered = await filterByMetadata(filters, topK);
      return metaFiltered.map((row: any) => ({
        chunk_id: row.chunk_id,
        document_id: row.document_id,
        text: row.text,
        metadata: row.metadata,
        score: 0.5, // Default score since we don't have vector similarity
      }));
    }

    return [];
  } catch (err) {
    logger.error("hybridSearch error", err);
    return [];
  }
}