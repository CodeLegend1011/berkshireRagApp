// src/memory/reflection-memory.ts
/**
 * Reflection memory: summarizes user intent & key topics from prior messages
 * and stores in a separate table for personalized context.
 */
import { getConversationContext } from "./conversation-store";
import { query } from "../config/database";
import gemini from "../config/gemini";
import { logger } from "../config/mastra";

export async function reflectAndStore(conversationId: string) {
  try {
    const messages = await getConversationContext(conversationId, 20);
    if (!messages.length) return;

    // Build short reflection prompt
    const prompt = `Summarize key topics, intents, and themes in the following conversation for personalized context:
${messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}
Return as short bullet points.`;

    const summary = await gemini.generate(prompt, undefined, 0.0);

    // Store reflection
    const sql = `
      INSERT INTO reflection_memory (conversation_id, summary, created_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (conversation_id) DO UPDATE SET summary = EXCLUDED.summary, created_at = NOW()
    `;
    await query(sql, [conversationId, summary]);
  } catch (err) {
    logger.error("reflectAndStore error", err);
  }
}
