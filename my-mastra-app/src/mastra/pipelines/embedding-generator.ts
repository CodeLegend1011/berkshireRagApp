// src/mastra/pipelines/embedding-generator.ts

import gemini from "../config/gemini";
import { TextChunk } from "./chunking-strategy";
import { logger } from "../config/mastra";

/**
 * Adds embedding vector to each chunk using the correct `getEmbedding` method.
 * OPTIMIZED: Processes embeddings in small batches to avoid memory overflow
 */
export async function generateEmbeddings(
  chunks: TextChunk[], 
  batchSize: number = 10
): Promise<(TextChunk & { embedding: number[] })[]> {
  const results: (TextChunk & { embedding: number[] })[] = [];
  
  logger.info(`Generating embeddings for ${chunks.length} chunks in batches of ${batchSize}...`);

  // Process in small batches to avoid memory issues
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, Math.min(i + batchSize, chunks.length));
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(chunks.length / batchSize);
    
    logger.info(`  Embedding batch ${batchNum}/${totalBatches} (chunks ${i + 1}-${Math.min(i + batchSize, chunks.length)})`);

    for (const chunk of batch) {
      try {
        // Generate embedding for this chunk
        const embeddingResponse = await gemini.getEmbedding(chunk.text);
        const embedding = embeddingResponse.embedding;

        results.push({
          ...chunk,
          embedding,
        });

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 50));
        
      } catch (err) {
        logger.error(`Failed to generate embedding for chunk ${chunk.chunkId}`, err);
        // Continue with other chunks even if one fails
      }
    }

    // Force garbage collection if available between batches
    if (global.gc && i + batchSize < chunks.length) {
      global.gc();
    }
  }

  logger.info(`✅ Generated ${results.length}/${chunks.length} embeddings successfully`);
  return results;
}