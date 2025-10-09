// src/agents/rag-agent.ts
/**
 * RAG Agent (production-ready style):
 * - Accepts injected tools (retriever, citationService, memoryStore, gemini)
 * - Builds prompts using conversation context + retrieved chunks + citations
 * - Streams tokens back to caller using gemini.generateStream
 *
 * This is intentionally implementation-agnostic about retrieval details so it
 * can be wired to vector-search.ts or hybrid-search.ts.
 */

import { v4 as uuidv4 } from "uuid";
import type { QueryResult } from "pg";
import { logger } from "../config/mastra";
import gemini from "../config/gemini";
import type { pgPool } from "../config/database";

/**
 * Types for injected helpers
 */
export type RetrieverResult = {
  chunk_id: string;
  document_id: string;
  text: string;
  metadata?: Record<string, any>;
  score?: number; // similarity
};

export type Retriever = {
  retrieve: (query: string, options?: any) => Promise<RetrieverResult[]>;
};

export type CitationService = {
  createCitations: (responseId: string, chunks: RetrieverResult[], extra?: any) => Promise<void>;
};

export type MemoryStore = {
  addUserMessage: (conversationId: string, content: string) => Promise<void>;
  addAssistantMessage: (conversationId: string, content: string, metadata?: any) => Promise<void>;
  getConversationContext: (conversationId: string, limit?: number) => Promise<Array<{ role: string; content: string }>>;
  reflectAndStore?: (conversationId: string) => Promise<void>;
};

export type RAGAgentOptions = {
  retriever: Retriever;
  citationService: CitationService;
  memory: MemoryStore;
  defaultGenModel?: string;
  temperature?: number;
};

export class RAGAgent {
  retriever: Retriever;
  citationService: CitationService;
  memory: MemoryStore;
  defaultGenModel: string;
  temperature: number;

  constructor(opts: RAGAgentOptions) {
    this.retriever = opts.retriever;
    this.citationService = opts.citationService;
    this.memory = opts.memory;
    this.defaultGenModel = opts.defaultGenModel || process.env.DEFAULT_GEN_MODEL || "gemini/gemini-prose-1";
    this.temperature = typeof opts.temperature === "number" ? opts.temperature : 0.0;
  }

  /**
   * High-level streaming answer method.
   * Returns an async iterable that yields token strings for streaming to client.
   */
  async *answerStreaming({
    conversationId,
    userId,
    question,
    topK = 6,
    filters = {},
  }: {
    conversationId?: string;
    userId?: string;
    question: string;
    topK?: number;
    filters?: Record<string, any>;
  }): AsyncGenerator<string> {
    const responseId = uuidv4();
    try {
      // 1. Persist user message to memory store (non-blocking)
      if (conversationId) {
        try {
          await this.memory.addUserMessage(conversationId, question);
        } catch (err) {
          logger.warn("Failed to persist user message to memory", err);
        }
      }

      // 2. Get conversation context (short)
      const context = conversationId
        ? await this.memory.getConversationContext(conversationId, 6)
        : [];

      // 3. Retrieve relevant chunks (injected retriever should implement hybrid logic if needed)
      const retrieved = await this.retriever.retrieve(question, { topK, filters });

      // 4. Build system prompt including short context and retrieved passages with citation keys
      const systemParts: string[] = [
        "You are an assistant knowledgeable about Warren Buffett's investment philosophy.",
        "Answer concisely, reference the source paragraphs using [CITE_x] tokens and include short TL;DR for each citation.",
        `If you cannot find relevant information in the sources, be upfront and avoid hallucination.`,
      ];
      if (context.length) {
        systemParts.push("\nConversation context (most recent):");
        for (const msg of context.slice(-6)) {
          systemParts.push(`${msg.role.toUpperCase()}: ${msg.content}`);
        }
      }

      const retrievedBlockLines: string[] = [];
      retrieved.slice(0, topK).forEach((r, idx) => {
        const citeToken = `[CITE_${idx + 1}]`;
        const metaSummary = r.metadata ? ` (meta: ${JSON.stringify(r.metadata)})` : "";
        retrievedBlockLines.push(`${citeToken}\n${r.text}\n--${metaSummary}`);
      });

      const prompt = [
        systemParts.join("\n"),
        "\n\nSources:",
        retrievedBlockLines.join("\n\n"),
        "\n\nUser question:",
        question,
        "\n\nProvide answer now, refer to sources with [CITE_n] tokens inline, and include a 'Sources' section listing each citation with document title/year and a one-sentence TL;DR for the cited paragraph.",
      ].join("\n");

      // 5. Stream tokens from Gemini
      const genStream = gemini.generateStream(prompt, this.defaultGenModel, this.temperature);
      let assistantAccum = "";
      for await (const chunk of genStream) {
        // chunk might be partial text tokens
        assistantAccum += chunk;
        yield chunk;
      }

      // 6. After finishing stream: persist assistant message
      if (conversationId) {
        try {
          await this.memory.addAssistantMessage(conversationId, assistantAccum, {
            responseId,
            citedChunks: retrieved.slice(0, topK).map((r) => ({ chunk_id: r.chunk_id, doc: r.document_id })),
          });
          // Optionally run reflection to update personalization memory
          if (this.memory.reflectAndStore) {
            // best-effort
            await this.memory.reflectAndStore(conversationId);
          }
        } catch (err) {
          logger.warn("Failed to persist assistant message to memory", err);
        }
      }

      // 7. Create citation entries via injected service (best-effort)
      try {
        await this.citationService.createCitations(responseId, retrieved.slice(0, topK), {
          userId,
          question,
        });
      } catch (err) {
        logger.warn("Failed to create citations", err);
      }
    } catch (err: any) {
      // yield a short error to client, but do not leak internal info
      const safeMsg = `\n\n[ERROR] The assistant encountered an error while generating the response.`;
      // attempt to yield something to streaming client
      yield safeMsg;
      logger.error("RAGAgent.answerStreaming error", err);
      return;
    }
  }
}

export default RAGAgent;
