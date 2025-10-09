// scripts/ingest-embeddings.ts
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../../mastra/config/database.js';
import gemini from '../../mastra/config/gemini.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Chunk {
  text: string;
  metadata: {
    source: string;
    year: string;
    chunkIndex: number;
  };
}

// Process multiple embeddings in parallel
async function generateEmbeddingsParallel(chunks: Chunk[], concurrency = 10) {
  const results: Array<{ chunk: Chunk; embedding: number[] | null; error?: string }> = [];
  
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, Math.min(i + concurrency, chunks.length));
    
    const promises = batch.map(async (chunk) => {
      try {
        const embeddingResponse = await gemini.getEmbedding(chunk.text);
        return { chunk, embedding: embeddingResponse.embedding };
      } catch (err: any) {
        return { chunk, embedding: null, error: err.message };
      }
    });
    
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
    
    // Small delay between batches only
    if (i + concurrency < chunks.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  
  return results;
}

async function main() {
  console.log('🚀 Starting FAST embedding generation and ingestion...');
  
  const chunksDir = path.join(__dirname, '../chunks');
  
  // Check if chunks directory exists
  try {
    await fs.access(chunksDir);
  } catch {
    console.error(`❌ Chunks directory not found: ${chunksDir}`);
    console.error('Please run "npm run chunk-docs" first');
    process.exit(1);
  }
  
  const files = await fs.readdir(chunksDir);
  const jsonFiles = files.filter(f => f.endsWith('.json')).sort();
  
  console.log(`📚 Found ${jsonFiles.length} chunk files to process`);
  
  // Create embeddings table with correct dimension (768 for Gemini)
  console.log('🔧 Setting up database table...');
  
  await query(`
    CREATE TABLE IF NOT EXISTS embeddings (
      id SERIAL PRIMARY KEY,
      chunk_id TEXT UNIQUE NOT NULL,
      document_id TEXT NOT NULL,
      text TEXT NOT NULL,
      metadata JSONB,
      embedding vector(768),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  
  console.log('✅ Database table ready\n');
  
  let totalProcessed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  const startTime = Date.now();
  
  for (let fileIdx = 0; fileIdx < jsonFiles.length; fileIdx++) {
    const file = jsonFiles[fileIdx];
    const fileStartTime = Date.now();
    
    console.log(`\n📄 [${fileIdx + 1}/${jsonFiles.length}] Processing ${file}...`);
    
    const filePath = path.join(chunksDir, file);
    
    try {
      // Read chunks from JSON file
      const fileContent = await fs.readFile(filePath, 'utf8');
      const chunks: Chunk[] = JSON.parse(fileContent);
      
      if (!Array.isArray(chunks) || chunks.length === 0) {
        console.log(`   ⚠️  No chunks in ${file}. Skipping.`);
        totalSkipped++;
        continue;
      }
      
      const documentId = randomUUID();
      console.log(`   📊 Processing ${chunks.length} chunks with parallel embedding generation...`);
      
      // Generate all embeddings in parallel (10 at a time)
      const embeddingResults = await generateEmbeddingsParallel(chunks, 10);
      
      // Batch insert into database
      let fileProcessed = 0;
      let fileFailed = 0;
      
      const DB_BATCH_SIZE = 50; // Insert 50 at a time
      
      for (let i = 0; i < embeddingResults.length; i += DB_BATCH_SIZE) {
        const dbBatch = embeddingResults.slice(i, Math.min(i + DB_BATCH_SIZE, embeddingResults.length));
        
        // Prepare bulk insert
        const values: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;
        
        for (const result of dbBatch) {
          if (!result.embedding) {
            fileFailed++;
            totalFailed++;
            continue;
          }
          
          // Verify embedding dimension
          if (result.embedding.length !== 768) {
            console.error(`   ⚠️  Wrong dimension: ${result.embedding.length}`);
            fileFailed++;
            totalFailed++;
            continue;
          }
          
          const chunkId = `${documentId}-${result.chunk.metadata.chunkIndex}`;
          const embeddingStr = `[${result.embedding.join(',')}]`;
          
          values.push(
            `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}::vector)`
          );
          
          params.push(
            chunkId,
            documentId,
            result.chunk.text,
            JSON.stringify(result.chunk.metadata),
            embeddingStr
          );
          
          paramIndex += 5;
          fileProcessed++;
        }
        
        // Bulk insert
        if (values.length > 0) {
          try {
            await query(
              `
              INSERT INTO embeddings (chunk_id, document_id, text, metadata, embedding)
              VALUES ${values.join(', ')}
              ON CONFLICT (chunk_id) DO UPDATE 
              SET text = EXCLUDED.text,
                  metadata = EXCLUDED.metadata,
                  embedding = EXCLUDED.embedding,
                  updated_at = NOW()
              `,
              params
            );
            
            totalProcessed += values.length;
          } catch (err: any) {
            console.error(`   ❌ Batch insert failed:`, err.message);
            fileFailed += values.length;
            totalFailed += values.length;
          }
        }
        
        const progress = Math.min(i + DB_BATCH_SIZE, embeddingResults.length);
        const percentage = Math.round((progress / embeddingResults.length) * 100);
        console.log(`   💾 Progress: ${progress}/${embeddingResults.length} (${percentage}%)`);
      }
      
      const fileTime = ((Date.now() - fileStartTime) / 1000).toFixed(1);
      const rate = (fileProcessed / parseFloat(fileTime)).toFixed(1);
      console.log(`   ✅ File complete in ${fileTime}s: ${fileProcessed} success, ${fileFailed} failed (${rate} chunks/sec)`);
      
      // Force garbage collection
      if (global.gc) {
        global.gc();
      }
      
    } catch (err: any) {
      console.error(`   ❌ Failed to process file ${file}:`, err.message);
      totalSkipped++;
    }
  }
  
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const avgRate = (totalProcessed / parseFloat(totalTime)).toFixed(1);
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Ingestion Summary:');
  console.log('='.repeat(60));
  console.log(`   ⏱️  Total time: ${totalTime}s`);
  console.log(`   ⚡ Average rate: ${avgRate} chunks/sec`);
  console.log(`   ✅ Successfully processed: ${totalProcessed}`);
  console.log(`   ❌ Failed: ${totalFailed}`);
  console.log(`   ⏭️  Skipped files: ${totalSkipped}`);
  
  // Verify data in database
  try {
    const countResult = await query('SELECT COUNT(*) as count FROM embeddings');
    const totalStored = parseInt(countResult.rows[0].count);
    console.log(`   💾 Total embeddings in database: ${totalStored}`);
    
    // Check distribution by year
    const yearStats = await query(`
      SELECT 
        metadata->>'year' as year,
        COUNT(*) as count
      FROM embeddings
      GROUP BY metadata->>'year'
      ORDER BY year
    `);
    
    console.log('\n📈 Distribution by year:');
    yearStats.rows.forEach(row => {
      console.log(`   ${row.year}: ${row.count} chunks`);
    });
    
    // Create index AFTER data insertion for better performance
    console.log('\n🔧 Creating vector index for fast similarity search...');
    await query(`
      CREATE INDEX IF NOT EXISTS embeddings_embedding_idx 
      ON embeddings USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `).catch((err) => {
      console.log('   ⚠️  Index may already exist');
    });
    console.log('✅ Index ready');
    
  } catch (err) {
    console.error('   ⚠️  Could not verify database contents');
  }
  
  console.log('\n✅ All chunks processed and stored successfully!');
  console.log(`🎉 You can now query your RAG system embedded chunks!`);
}

main().catch(err => {
  console.error('❌ Fatal Error:', err);
  process.exit(1);
});