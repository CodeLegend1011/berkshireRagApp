// scripts/chunk-documents.ts
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PARSED_DIR = path.join(__dirname, '../parsed');
const CHUNKS_DIR = path.join(__dirname, '../chunks');

interface TextChunk {
  text: string;
  metadata: {
    source: string;
    year: string;
    chunkIndex: number;
  };
}

function chunkText(text: string, chunkSize = 512, overlap = 50): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  
  let currentChunk = '';
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      
      // Keep overlap from previous chunk
      const words = currentChunk.split(' ');
      const overlapWords = words.slice(-Math.floor(overlap / 5));
      currentChunk = overlapWords.join(' ') + ' ' + sentence;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

async function processFileInChunks(filePath: string, fileName: string) {
  const content = await fs.readFile(filePath, 'utf-8');
  
  // Extract year from filename
  const yearMatch = fileName.match(/(\d{4})/);
  const year = yearMatch ? yearMatch[1] : 'unknown';
  
  console.log(`✂️  Chunking: ${fileName} (${content.length} chars)...`);
  
  // Chunk the text
  const textChunks = chunkText(content, 512, 50);
  
  // Process chunks in smaller batches to avoid memory issues
  const BATCH_SIZE = 50;
  const enrichedChunks: TextChunk[] = [];
  
  for (let i = 0; i < textChunks.length; i += BATCH_SIZE) {
    const batch = textChunks.slice(i, Math.min(i + BATCH_SIZE, textChunks.length));
    
    const batchChunks = batch.map((text, batchIndex) => ({
      text,
      metadata: {
        source: fileName,
        year,
        chunkIndex: i + batchIndex,
      },
    }));
    
    enrichedChunks.push(...batchChunks);
    
    // Force garbage collection if available
    if (global.gc && i + BATCH_SIZE < textChunks.length) {
      global.gc();
    }
  }
  
  // Save chunks to JSON file
  const outFile = path.join(CHUNKS_DIR, fileName.replace('.txt', '.json'));
  await fs.writeFile(outFile, JSON.stringify(enrichedChunks, null, 2), 'utf-8');
  
  console.log(`✅ Saved ${enrichedChunks.length} chunks → ${path.basename(outFile)}`);
  
  // Clear memory
  return enrichedChunks.length;
}

async function ingestAndChunkDocuments() {
  await fs.mkdir(CHUNKS_DIR, { recursive: true });
  
  const files = await fs.readdir(PARSED_DIR);
  const txtFiles = files.filter(f => f.endsWith('.txt'));
  
  console.log(`📚 Found ${txtFiles.length} parsed text files to chunk\n`);
  
  let totalChunks = 0;
  let processedFiles = 0;
  
  for (const file of txtFiles) {
    try {
      const filePath = path.join(PARSED_DIR, file);
      const numChunks = await processFileInChunks(filePath, file);
      totalChunks += numChunks;
      processedFiles++;
      
      // Small delay between files
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (err) {
      console.error(`❌ Error chunking ${file}:`, err);
    }
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   Files processed: ${processedFiles}/${txtFiles.length}`);
  console.log(`   Total chunks created: ${totalChunks}`);
  console.log(`   ✅ Done! All files saved in '${CHUNKS_DIR}/'`);
}

ingestAndChunkDocuments().catch(console.error);