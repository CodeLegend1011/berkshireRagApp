// scripts/ingest-embeddings.ts - Updated for OpenAI
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../mastra/config/database.js';
import OpenAI from 'openai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface Chunk {
  text: string;
  metadata: {
    source: string;
    year: string;
    chunkIndex: number;
  };
}

async function generateEmbeddingsParallel(chunks: Chunk[], concurrency = 10) {
  const results: Array<{ chunk: Chunk; embedding: number[] | null; error?: string }> = [];
  
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, Math.min(i + concurrency, chunks.length));
    
    const promises = batch.map(async (chunk) => {
      try {
        const response = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: chunk.text,
        });
        return { chunk, embedding: response.data[0].embedding };
      } catch (err: any) {
        return { chunk, embedding: null, error: err.message };
      }
    });
    
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
    
    if (i + concurrency < chunks.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  
  return results;
}

async function main() {
  console.log('🚀 Starting embedding generation with OpenAI...');
  
  const chunksDir = path.join(__dirname, '../chunks');
  
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
  
  // Create embeddings table (1536 dimensions for text-embedding-3-small)
  console.log('🔧 Setting up database table...');
  
  await query(`
    CREATE TABLE IF NOT EXISTS embeddings (
      id SERIAL PRIMARY KEY,
      chunk_id TEXT UNIQUE NOT NULL,
      document_id TEXT NOT NULL,
      text TEXT NOT NULL,
      metadata JSONB,
      embedding vector(1536),
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
      const fileContent = await fs.readFile(filePath, 'utf8');
      const chunks: Chunk[] = JSON.parse(fileContent);
      
      if (!Array.isArray(chunks) || chunks.length === 0) {
        console.log(`   ⚠️  No chunks in ${file}. Skipping.`);
        totalSkipped++;
        continue;
      }
      
      const documentId = randomUUID();
      console.log(`   📊 Processing ${chunks.length} chunks...`);
      
      const embeddingResults = await generateEmbeddingsParallel(chunks, 10);
      
      let fileProcessed = 0;
      let fileFailed = 0;
      
      const DB_BATCH_SIZE = 50;
      
      for (let i = 0; i < embeddingResults.length; i += DB_BATCH_SIZE) {
        const dbBatch = embeddingResults.slice(i, Math.min(i + DB_BATCH_SIZE, embeddingResults.length));
        
        const values: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;
        
        for (const result of dbBatch) {
          if (!result.embedding) {
            fileFailed++;
            totalFailed++;
            continue;
          }
          
          if (result.embedding.length !== 1536) {
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
      console.log(`   ✅ Complete: ${fileProcessed} success, ${fileFailed} failed (${rate} chunks/sec)`);
      
      if (global.gc) {
        global.gc();
      }
      
    } catch (err: any) {
      console.error(`   ❌ Failed to process ${file}:`, err.message);
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
  console.log(`   ✅ Processed: ${totalProcessed}`);
  console.log(`   ❌ Failed: ${totalFailed}`);
  console.log(`   ⭐ Skipped files: ${totalSkipped}`);
  
  try {
    const countResult = await query('SELECT COUNT(*) as count FROM embeddings');
    const totalStored = parseInt(countResult.rows[0].count);
    console.log(`   💾 Total in database: ${totalStored}`);
    
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
    
    console.log('\n🔧 Creating vector index...');
    await query(`
      CREATE INDEX IF NOT EXISTS embeddings_embedding_idx 
      ON embeddings USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `).catch(() => {
      console.log('   ⚠️  Index may already exist');
    });
    console.log('✅ Index ready');
    
  } catch (err) {
    console.error('   ⚠️  Could not verify database');
  }
  
  console.log('\n✅ All chunks processed successfully!');
  console.log('🎉 RAG system ready!');
}

main().catch(err => {
  console.error('❌ Fatal Error:', err);
  process.exit(1);
});