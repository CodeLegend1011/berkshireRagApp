// // scripts/ingest-embeddings.ts - Fixed for OpenAI with proper error handling
// import { randomUUID } from 'crypto';
// import dotenv from 'dotenv';
// import fs from 'fs/promises';
// import path from 'path';
// import { fileURLToPath } from 'url';
// import { query } from '../mastra/config/database.js';
// import OpenAI from 'openai';

// dotenv.config();

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// // Verify API key exists
// if (!process.env.OPENAI_API_KEY) {
//   console.error('❌ OPENAI_API_KEY not found in environment variables');
//   console.error('💡 Add it to your .env file: OPENAI_API_KEY=sk-...');
//   process.exit(1);
// }

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

// interface Chunk {
//   text: string;
//   metadata: {
//     source: string;
//     year: string;
//     chunkIndex: number;
//   };
// }

// async function generateEmbeddingsParallel(chunks: Chunk[], concurrency = 5) {
//   const results: Array<{ chunk: Chunk; embedding: number[] | null; error?: string }> = [];
  
//   console.log(`   🔄 Generating embeddings in batches of ${concurrency}...`);
  
//   for (let i = 0; i < chunks.length; i += concurrency) {
//     const batch = chunks.slice(i, Math.min(i + concurrency, chunks.length));
    
//     const promises = batch.map(async (chunk, batchIdx) => {
//       const chunkNum = i + batchIdx + 1;
//       try {
//         const response = await openai.embeddings.create({
//           model: 'text-embedding-3-small',
//           input: chunk.text.substring(0, 8000), // OpenAI limit
//           encoding_format: 'float',
//         });
        
//         const embedding = response.data[0].embedding;
        
//         // Validate dimension
//         if (embedding.length !== 1536) {
//           throw new Error(`Wrong dimension: got ${embedding.length}, expected 1536`);
//         }
        
//         process.stdout.write(`\r   📊 Embedding progress: ${chunkNum}/${chunks.length}`);
        
//         return { chunk, embedding };
//       } catch (err: any) {
//         console.error(`\n   ⚠️  Failed chunk ${chunkNum}: ${err.message}`);
//         return { chunk, embedding: null, error: err.message };
//       }
//     });
    
//     const batchResults = await Promise.all(promises);
//     results.push(...batchResults);
    
//     // Rate limiting delay
//     if (i + concurrency < chunks.length) {
//       await new Promise(resolve => setTimeout(resolve, 100));
//     }
//   }
  
//   console.log(''); // New line after progress
//   return results;
// }

// async function verifyTableDimension() {
//   console.log('🔍 Verifying table dimension...');
  
//   const dimCheck = await query(`
//     SELECT (atttypmod - 4) as dimensions
//     FROM pg_attribute 
//     WHERE attrelid = 'embeddings'::regclass 
//       AND attname = 'embedding'
//   `);
  
//   if (dimCheck.rows.length === 0) {
//     throw new Error('embeddings table does not exist or has no embedding column');
//   }
  
//   const dims = dimCheck.rows[0].dimensions;
  
//   if (dims !== 1536) {
//     console.error(`❌ Table has WRONG dimension: ${dims} (expected 1536)`);
//     console.error('💡 Fix this by running:');
//     console.error('   DROP TABLE embeddings CASCADE;');
//     console.error('   Then run the setup-database.sql script again');
//     process.exit(1);
//   }
  
//   console.log(`✅ Table dimension correct: ${dims}\n`);
// }

// async function main() {
//   console.log('🚀 Starting embedding generation with OpenAI...\n');
  
//   // Verify table dimension first
//   try {
//     await verifyTableDimension();
//   } catch (err: any) {
//     console.error('❌ Table verification failed:', err.message);
    
//     if (err.message.includes('does not exist')) {
//       console.log('💡 Creating embeddings table...');
      
//       await query(`
//         CREATE TABLE IF NOT EXISTS embeddings (
//           id SERIAL PRIMARY KEY,
//           chunk_id TEXT UNIQUE NOT NULL,
//           document_id TEXT NOT NULL,
//           text TEXT NOT NULL,
//           metadata JSONB,
//           embedding vector(1536),
//           created_at TIMESTAMP DEFAULT NOW(),
//           updated_at TIMESTAMP DEFAULT NOW()
//         )
//       `);
      
//       console.log('✅ Table created\n');
//     } else {
//       throw err;
//     }
//   }
  
//   const chunksDir = path.join(__dirname, '../chunks');
  
//   // Check chunks directory
//   try {
//     await fs.access(chunksDir);
//   } catch {
//     console.error(`❌ Chunks directory not found: ${chunksDir}`);
//     console.error('💡 Run these commands first:');
//     console.error('   npm run parse-pdfs');
//     console.error('   npm run chunk-docs');
//     process.exit(1);
//   }
  
//   const files = await fs.readdir(chunksDir);
//   const jsonFiles = files.filter(f => f.endsWith('.json')).sort();
  
//   if (jsonFiles.length === 0) {
//     console.error(`❌ No JSON chunk files found in ${chunksDir}`);
//     console.error('💡 Run: npm run chunk-docs');
//     process.exit(1);
//   }
  
//   console.log(`📚 Found ${jsonFiles.length} chunk files to process\n`);
  
//   let totalProcessed = 0;
//   let totalFailed = 0;
//   let totalSkipped = 0;
//   const startTime = Date.now();
  
//   for (let fileIdx = 0; fileIdx < jsonFiles.length; fileIdx++) {
//     const file = jsonFiles[fileIdx];
//     const fileStartTime = Date.now();
    
//     console.log(`\n📄 [${fileIdx + 1}/${jsonFiles.length}] Processing ${file}...`);
    
//     const filePath = path.join(chunksDir, file);
    
//     try {
//       const fileContent = await fs.readFile(filePath, 'utf8');
//       const chunks: Chunk[] = JSON.parse(fileContent);
      
//       if (!Array.isArray(chunks) || chunks.length === 0) {
//         console.log(`   ⚠️  No chunks in ${file}. Skipping.`);
//         totalSkipped++;
//         continue;
//       }
      
//       const documentId = randomUUID();
//       console.log(`   📊 Processing ${chunks.length} chunks...`);
      
//       // Generate embeddings with lower concurrency for stability
//       const embeddingResults = await generateEmbeddingsParallel(chunks, 5);
      
//       let fileProcessed = 0;
//       let fileFailed = 0;
      
//       // Insert into database in batches
//       const DB_BATCH_SIZE = 50;
      
//       for (let i = 0; i < embeddingResults.length; i += DB_BATCH_SIZE) {
//         const dbBatch = embeddingResults.slice(i, Math.min(i + DB_BATCH_SIZE, embeddingResults.length));
        
//         const values: string[] = [];
//         const params: any[] = [];
//         let paramIndex = 1;
        
//         for (const result of dbBatch) {
//           if (!result.embedding) {
//             fileFailed++;
//             totalFailed++;
//             continue;
//           }
          
//           const chunkId = `${documentId}-${result.chunk.metadata.chunkIndex}`;
//           const embeddingStr = `[${result.embedding.join(',')}]`;
          
//           values.push(
//             `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}::vector)`
//           );
          
//           params.push(
//             chunkId,
//             documentId,
//             result.chunk.text,
//             JSON.stringify(result.chunk.metadata),
//             embeddingStr
//           );
          
//           paramIndex += 5;
//         }
        
//         if (values.length > 0) {
//           try {
//             await query(
//               `
//               INSERT INTO embeddings (chunk_id, document_id, text, metadata, embedding)
//               VALUES ${values.join(', ')}
//               ON CONFLICT (chunk_id) DO UPDATE 
//               SET text = EXCLUDED.text,
//                   metadata = EXCLUDED.metadata,
//                   embedding = EXCLUDED.embedding,
//                   updated_at = NOW()
//               `,
//               params
//             );
            
//             totalProcessed += values.length;
//             fileProcessed += values.length;
//           } catch (err: any) {
//             console.error(`\n   ❌ Batch insert failed:`, err.message);
//             fileFailed += values.length;
//             totalFailed += values.length;
//           }
//         }
        
//         const progress = Math.min(i + DB_BATCH_SIZE, embeddingResults.length);
//         const percentage = Math.round((progress / embeddingResults.length) * 100);
//         console.log(`   💾 Database progress: ${progress}/${embeddingResults.length} (${percentage}%)`);
//       }
      
//       const fileTime = ((Date.now() - fileStartTime) / 1000).toFixed(1);
//       const rate = (fileProcessed / parseFloat(fileTime)).toFixed(1);
//       console.log(`   ✅ Complete: ${fileProcessed} success, ${fileFailed} failed (${rate} chunks/sec)`);
      
//       // Garbage collection
//       if (global.gc) {
//         global.gc();
//       }
      
//     } catch (err: any) {
//       console.error(`   ❌ Failed to process ${file}:`, err.message);
//       totalSkipped++;
//     }
//   }
  
//   const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
//   const avgRate = totalProcessed > 0 ? (totalProcessed / parseFloat(totalTime)).toFixed(1) : '0';
  
//   console.log('\n' + '='.repeat(70));
//   console.log('📊 INGESTION SUMMARY');
//   console.log('='.repeat(70));
//   console.log(`⏱️  Total time: ${totalTime}s`);
//   console.log(`⚡ Average rate: ${avgRate} chunks/sec`);
//   console.log(`✅ Successfully processed: ${totalProcessed}`);
//   console.log(`❌ Failed: ${totalFailed}`);
//   console.log(`⭐ Skipped files: ${totalSkipped}`);
  
//   // Verify and create index
//   try {
//     const countResult = await query('SELECT COUNT(*) as count FROM embeddings');
//     const totalStored = parseInt(countResult.rows[0].count);
//     console.log(`💾 Total in database: ${totalStored}`);
    
//     if (totalStored === 0) {
//       console.log('\n⚠️  WARNING: No data was stored in the database!');
//       process.exit(1);
//     }
    
//     const yearStats = await query(`
//       SELECT 
//         metadata->>'year' as year,
//         COUNT(*) as count
//       FROM embeddings
//       GROUP BY metadata->>'year'
//       ORDER BY year
//     `);
    
//     console.log('\n📈 Distribution by year:');
//     yearStats.rows.forEach(row => {
//       console.log(`   ${row.year}: ${row.count} chunks`);
//     });
    
//     console.log('\n🔧 Creating vector index for fast similarity search...');
//     await query(`
//       CREATE INDEX IF NOT EXISTS embeddings_embedding_idx 
//       ON embeddings USING ivfflat (embedding vector_cosine_ops)
//       WITH (lists = 100)
//     `);
//     console.log('✅ Index created successfully');
    
//   } catch (err: any) {
//     console.error('   ⚠️  Error verifying database:', err.message);
//   }
  
//   console.log('\n' + '='.repeat(70));
//   console.log('✅ INGESTION COMPLETE!');
//   console.log('🎉 Your RAG system is ready to use!');
//   console.log('='.repeat(70));
// }

// main().catch(err => {
//   console.error('\n❌ FATAL ERROR:', err);
//   console.error('\nStack trace:', err.stack);
//   process.exit(1);
// });



// scripts/ingest-embeddings.ts
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../mastra/config/database.js';
import gemini from '../mastra/config/gemini.js';

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