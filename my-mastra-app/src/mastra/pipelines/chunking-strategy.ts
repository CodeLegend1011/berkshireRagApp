// src/pipelines/chunking-strategy.ts
/**
 * Strategy to split long text into manageable chunks for embeddings
 */
export interface TextChunk {
  chunkId: string;
  text: string;
  metadata: Record<string, any>;
}

/**
 * Simple sentence-based chunking
 * - maxChunkSize: maximum number of characters per chunk
 * - overlap: number of characters to overlap between chunks
 */
export function chunkText(
  text: string,
  metadata: Record<string, any>,
  maxChunkSize = 500,
  overlap = 50
): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChunkSize, text.length);
    const chunkText = text.slice(start, end);

    chunks.push({
      chunkId: `${metadata.documentId}-${chunkIndex}`,
      text: chunkText,
      metadata,
    });

    start = end - overlap; // overlap
    chunkIndex++;
  }

  return chunks;
}
