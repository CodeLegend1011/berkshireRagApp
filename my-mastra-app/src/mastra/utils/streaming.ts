// src/utils/streaming.ts
/**
 * Streaming responses token-by-token for chat
 */
import { logger } from "../config/mastra";

/**
 * Streams tokens to a writable function (like Express res.write)
 * @param tokens string[] array of tokens
 * @param sendFn function to write data
 */
export async function streamTokens(tokens: string[], sendFn: (chunk: string) => void, delayMs = 20) {
  try {
    for (const token of tokens) {
      sendFn(token);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  } catch (err) {
    logger.error("Error in streamTokens", err);
  }
}

/**
 * Example usage with Express response:
 * streamTokens(tokens, (chunk) => res.write(chunk))
 */
