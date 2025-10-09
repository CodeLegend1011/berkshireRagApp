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
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start = end - overlap;
  }
  
  return chunks;
}

async function ingestAndChunkDocuments() {
  await fs.mkdir(CHUNKS_DIR, { recursive: true });
  
  const files = await fs.readdir(PARSED_DIR);
  const txtFiles = files.filter(f => f.endsWith('.txt'));
  
  console.log(`📚 Found ${txtFiles.length} parsed text files to chunk`);
  
  for (const file of txtFiles) {
    try {
      const filePath = path.join(PARSED_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      console.log(`✂️  Chunking: ${file}...`);
      
      // Extract year from filename (e.g., "1978.txt" or "letter_1978.txt")
      const yearMatch = file.match(/(\d{4})/);
      const year = yearMatch ? yearMatch[1] : 'unknown';
      
      // Chunk the text
      const textChunks = chunkText(content, 512, 50);
      
      // Enrich chunks with metadata
      const enrichedChunks: TextChunk[] = textChunks.map((text, index) => ({
        text,
        metadata: {
          source: file,
          year,
          chunkIndex: index,
        },
      }));
      
      // Save chunks to JSON file
      const outFile = path.join(CHUNKS_DIR, file.replace('.txt', '.json'));
      await fs.writeFile(outFile, JSON.stringify(enrichedChunks, null, 2), 'utf-8');
      
      console.log(`✅ Saved ${enrichedChunks.length} chunks → ${outFile}`);
    } catch (err) {
      console.error(`❌ Error chunking ${file}:`, err);
    }
  }
  
  console.log(`\n✅ Done! All files processed and saved in '${CHUNKS_DIR}/'`);
}

ingestAndChunkDocuments().catch(console.error);