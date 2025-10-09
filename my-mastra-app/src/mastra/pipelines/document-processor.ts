// src/pipelines/improved-document-processor.ts
/**
 * Improved document ingestion pipeline with better error handling
 * and verification that data is actually stored in PostgreSQL
 */
import fs from "fs";
import path from "path";
import { parsePdf } from "../utils/pdf-parser";
import { chunkText, TextChunk } from "./chunking-strategy";
import { generateEmbeddings } from "./embedding-generator";
import { query } from "../config/database";
import { logger } from "../config/mastra";
import { v4 as uuidv4 } from "uuid";

interface ProcessDocumentOptions {
  filePath: string;
  year?: number;
  company?: string;
  topic?: string;
}

export async function processDocument(options: ProcessDocumentOptions) {
  const { filePath, year, company = "Berkshire Hathaway", topic } = options;
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const documentId = uuidv4();
  const fileName = path.basename(filePath);

  try {
    logger.info(`📄 Processing document: ${fileName}`);

    // 1. Parse PDF to text
    const text = await parsePdf(filePath);
    logger.info(`📝 Extracted ${text.length} characters from PDF`);

    if (text.length < 100) {
      throw new Error("Extracted text is too short. PDF parsing may have failed.");
    }

    // 2. Chunk text with better parameters for financial documents
    const chunks: TextChunk[] = chunkText(text, {
      documentId,
      fileName,
      year,
      company,
      topic,
    }, 800, 100); // Larger chunks for better context

    logger.info(`✂️  Text split into ${chunks.length} chunks`);

    // 3. Generate embeddings
    logger.info(`🔄 Generating embeddings for ${chunks.length} chunks...`);
    const embeddedChunks = await generateEmbeddings(chunks);
    logger.info(`✅ Generated embeddings for ${embeddedChunks.length} chunks`);

    // 4. Store in PostgreSQL with verification
    let successCount = 0;
    let failCount = 0;

    for (const chunk of embeddedChunks) {
      try {
        const sql = `
          INSERT INTO embeddings (chunk_id, document_id, text, metadata, embedding)
          VALUES ($1, $2, $3, $4, $5::vector)
          ON CONFLICT (chunk_id) DO UPDATE 
          SET text = EXCLUDED.text,
              metadata = EXCLUDED.metadata,
              embedding = EXCLUDED.embedding,
              updated_at = NOW()
          RETURNING id
        `;
        
        const embeddingStr = `[${chunk.embedding.join(",")}]`;
        
        const result = await query(sql, [
          chunk.chunkId,
          documentId,
          chunk.text,
          JSON.stringify(chunk.metadata),
          embeddingStr,
        ]);

        if (result.rowCount && result.rowCount > 0) {
          successCount++;
        }
      } catch (err) {
        failCount++;
        logger.error(`❌ Failed to insert chunk ${chunk.chunkId}:`, err);
      }
    }

    logger.info(`💾 Database storage: ${successCount} successful, ${failCount} failed`);

    // 5. Verify data was stored
    const verifyQuery = await query(
      `SELECT COUNT(*) as count FROM embeddings WHERE document_id = $1`,
      [documentId]
    );
    const storedCount = parseInt(verifyQuery.rows[0].count);

    logger.info(`✅ Verification: ${storedCount} chunks found in database for document ${documentId}`);

    if (storedCount === 0) {
      throw new Error("No chunks were successfully stored in the database!");
    }

    return {
      documentId,
      fileName,
      totalChunks: chunks.length,
      chunksProcessed: embeddedChunks.length,
      chunksStored: storedCount,
      success: storedCount > 0,
    };
  } catch (err) {
    logger.error(`❌ Error processing document ${fileName}:`, err);
    throw err;
  }
}

/**
 * Process all documents in a directory
 */
export async function processDirectory(dirPath: string, options?: { yearPattern?: RegExp }) {
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.pdf'));
  
  logger.info(`📚 Found ${files.length} PDF files in ${dirPath}`);

  const results = [];

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    
    // Try to extract year from filename (e.g., "2023_letter.pdf" -> 2023)
    let year: number | undefined;
    if (options?.yearPattern) {
      const match = file.match(options.yearPattern);
      if (match && match[1]) {
        year = parseInt(match[1]);
      }
    }

    try {
      const result = await processDocument({
        filePath,
        year,
        company: "Berkshire Hathaway",
        topic: "Annual Shareholder Letter",
      });
      results.push({ ...result, status: "success" });
      logger.info(`✅ Successfully processed: ${file}`);
    } catch (err) {
      logger.error(`❌ Failed to process ${file}:`, err);
      results.push({ fileName: file, status: "failed", error: err });
    }
  }

  // Summary
  const successCount = results.filter(r => r.status === "success").length;
  const failCount = results.filter(r => r.status === "failed").length;
  
  logger.info(`\n📊 Processing Summary:`);
  logger.info(`   Total files: ${files.length}`);
  logger.info(`   ✅ Successful: ${successCount}`);
  logger.info(`   ❌ Failed: ${failCount}`);

  return results;
}

/**
 * Get database statistics
 */
export async function getDatabaseStats() {
  try {
    const stats = await query(`
      SELECT 
        COUNT(*) as total_chunks,
        COUNT(DISTINCT document_id) as total_documents,
        jsonb_object_agg(
          COALESCE(metadata->>'year', 'unknown'),
          cnt
        ) as chunks_per_year
      FROM (
        SELECT 
          document_id,
          metadata,
          COUNT(*) as cnt
        FROM embeddings
        GROUP BY metadata->>'year', document_id, metadata
      ) subquery
    `);

    return stats.rows[0];
  } catch (err) {
    logger.error("Failed to get database stats:", err);
    return null;
  }
}