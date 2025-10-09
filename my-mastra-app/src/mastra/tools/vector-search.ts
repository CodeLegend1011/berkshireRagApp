// src/tools/vector-search.ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { query } from '../config/database';
import { openai } from '../config/openai';

export const vectorSearchTool = createTool({
  id: 'vector-search',
  description: 
    'Search through Warren Buffett\'s shareholder letters using semantic similarity. ' +
    'Use this tool to find relevant information about investment philosophy, business strategy, ' +
    'and specific topics from Berkshire Hathaway annual letters.',
  
  inputSchema: z.object({
    query: z.string().describe('The search query - what you want to find in the letters'),
    topK: z.number().optional().default(5).describe('Number of results to return (default: 5)'),
    yearFilter: z.number().optional().describe('Optional: filter by specific year'),
  }),
  
  outputSchema: z.object({
    results: z.array(z.object({
      text: z.string(),
      score: z.number(),
      metadata: z.object({
        year: z.string(),
        source: z.string(),
        chunkIndex: z.number(),
      }),
    })),
    totalFound: z.number(),
    searchQuery: z.string(),
  }),

  execute: async ({ context }) => {
    const { query: searchQuery, topK = 5, yearFilter } = context;
    
    console.log(`🔍 Vector search for: "${searchQuery}" (topK: ${topK})`);
    
    try {
      // Generate embedding for the query using OpenAI
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: searchQuery,
      });
      
      const queryEmbedding = embeddingResponse.data[0].embedding;
      
      // Build SQL query with optional year filter
      let sqlQuery = `
        SELECT 
          chunk_id,
          document_id,
          text,
          metadata,
          1 - (embedding <=> $1::vector) as similarity_score
        FROM embeddings
      `;
      
      const params: any[] = [`[${queryEmbedding.join(',')}]`];
      
      if (yearFilter) {
        sqlQuery += ` WHERE metadata->>'year' = $2`;
        params.push(yearFilter.toString());
      }
      
      sqlQuery += `
        ORDER BY embedding <=> $1::vector
        LIMIT $${params.length + 1}
      `;
      params.push(topK);
      
      console.log('📊 Executing vector similarity search in PostgreSQL...');
      const result = await query(sqlQuery, params);
      
      const results = result.rows.map(row => ({
        text: row.text,
        score: parseFloat(row.similarity_score),
        metadata: {
          year: row.metadata.year,
          source: row.metadata.source,
          chunkIndex: row.metadata.chunkIndex,
          documentId: row.document_id,
          chunkId: row.chunk_id,
        },
      }));
      
      console.log(`✅ Found ${results.length} relevant chunks`);
      
      return {
        results,
        totalFound: results.length,
        searchQuery,
      };
      
    } catch (error) {
      console.error('❌ Vector search error:', error);
      throw new Error(`Vector search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },
});


// for Gemini
// import { createTool } from "@mastra/core/tools";
// import { z } from "zod";
// import { query } from "../config/database";
// import gemini from "../config/gemini";
// import { logger } from "../config/mastra";

// /**
//  * Vector similarity search tool for Mastra agent
//  * This tool will show up in the agent's tool calls with structured output
//  */
// export const vectorSearchTool = createTool({
//   id: "vector-search",
//   description: "Search through Berkshire Hathaway shareholder letters using semantic similarity. Returns relevant passages from Warren Buffett's letters with metadata.",
//   inputSchema: z.object({
//     query: z.string().describe("The search query or question to find relevant information"),
//     topK: z.number().optional().default(5).describe("Number of results to return (default: 5)"),
//     yearFilter: z.number().optional().describe("Filter results by specific year if provided"),
//   }),
//   outputSchema: z.object({
//     results: z.array(
//       z.object({
//         text: z.string().describe("The relevant text passage from the shareholder letter"),
//         score: z.number().describe("Similarity score (0-1, higher is better)"),
//         metadata: z.object({
//           fileName: z.string().optional(),
//           year: z.number().optional(),
//           company: z.string().optional(),
//           documentId: z.string(),
//           chunkId: z.string(),
//         }),
//       })
//     ),
//     totalFound: z.number(),
//     searchQuery: z.string(),
//   }),
//   execute: async (ctx: any) => {
//     try {
//       // FIX: Access parameters from ctx.context
//       const searchQuery: string = ctx.context.query;
//       const topK: number = ctx.context.topK ?? 5;
//       const yearFilter: number | undefined = ctx.context.yearFilter;

//       // Add validation to prevent undefined queries
//       if (!searchQuery || searchQuery === 'undefined') {
//         logger.error("Failed to extract query from context:", ctx);
//         throw new Error('Search query is required and cannot be undefined');
//       }

//       logger.info(`🔍 Vector search for: "${searchQuery}" (topK: ${topK})`);

//       // 1. Generate embedding for the query using Gemini
//       const queryEmbeddingResponse = await gemini.getEmbedding(searchQuery);
//       const queryEmbedding = queryEmbeddingResponse.embedding;

//       // Validate embedding was generated
//       if (!queryEmbedding || queryEmbedding.length === 0) {
//         throw new Error('Failed to generate embedding for query');
//       }
//       // 2. Build SQL query with pgvector similarity search
//       let sql = `
//         SELECT 
//           chunk_id,
//           document_id,
//           text,
//           metadata,
//           1 - (embedding <=> $1::vector) as similarity_score
//         FROM embeddings
//       `;

//       // PostgreSQL requires vector array to be passed as a string representation
//       const params: any[] = [`[${queryEmbedding.join(",")}]`];

//       // Add year filter if provided
//       if (yearFilter) {
//         // Since $1 is always the embedding vector, the yearFilter parameter must be $2
//         sql += ` WHERE (metadata->>'year')::int = $2`;
//         params.push(yearFilter);
//       }

//       // The similarity comparison still uses $1, which is the embedding vector
//       // The LIMIT parameter index is dynamically set based on the number of preceding parameters
//       sql += `
//         ORDER BY embedding <=> $1::vector
//         LIMIT $${params.length + 1}
//       `;
//       params.push(topK);

//       // 3. Execute vector similarity search
//       logger.info("📊 Executing vector similarity search in PostgreSQL...");
//       const result = await query(sql, params);

//       // 4. Format results
//       const formattedResults = result.rows.map((row: any) => ({
//         text: row.text,
//         // The similarity_score is returned as a string from the DB, convert to float
//         score: parseFloat(row.similarity_score),
//         metadata: {
//           // Spread existing metadata from the JSONB column
//           ...row.metadata,
//           // Explicitly map top-level column IDs
//           documentId: row.document_id,
//           chunkId: row.chunk_id,
//         },
//       }));

//       logger.info(`✅ Found ${formattedResults.length} relevant chunks`);

//       return {
//         results: formattedResults,
//         totalFound: formattedResults.length,
//         searchQuery,
//       };
//     } catch (err) {
//       logger.error("❌ Vector search error:", err);
//       // Ensure the error message is clear for the agent/user
//       throw new Error(`Vector search failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
//     }
//   },
// });