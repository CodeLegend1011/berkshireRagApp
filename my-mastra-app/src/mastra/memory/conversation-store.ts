// src/memory/conversation-store.ts
/**
 * Simple conversation memory store using Postgres.
 * Stores user and assistant messages for persistent context.
 */
import { query } from "../config/database";
import { logger } from "../config/mastra";

export type ConversationMessage = {
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: Record<string, any>;
  created_at?: string;
};

export async function addUserMessage(conversationId: string, content: string) {
  const sql = `
    INSERT INTO conversation_messages (conversation_id, role, content, created_at)
    VALUES ($1, 'user', $2, NOW())
  `;
  try {
    await query(sql, [conversationId, content]);
  } catch (err) {
    logger.error("addUserMessage error", err);
  }
}

export async function addAssistantMessage(conversationId: string, content: string, metadata?: any) {
  const sql = `
    INSERT INTO conversation_messages (conversation_id, role, content, metadata, created_at)
    VALUES ($1, 'assistant', $2, $3, NOW())
  `;
  try {
    await query(sql, [conversationId, content, metadata ? JSON.stringify(metadata) : null]);
  } catch (err) {
    logger.error("addAssistantMessage error", err);
  }
}

export async function getConversationContext(conversationId: string, limit = 10) {
  const sql = `
    SELECT role, content
    FROM conversation_messages
    WHERE conversation_id = $1
    ORDER BY created_at ASC
    LIMIT $2
  `;
  try {
    const res = await query(sql, [conversationId, limit]);
    return res.rows;
  } catch (err) {
    logger.error("getConversationContext error", err);
    return [];
  }
}
