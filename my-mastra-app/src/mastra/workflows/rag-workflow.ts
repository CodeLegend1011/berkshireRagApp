// src/workflows/rag-workflow.ts
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";

/**
 * Fixed RAG workflow with proper streaming handling
 */
const queryRagStep = createStep({
  id: "query-rag",
  description: "Queries the RAG Agent to answer questions about Warren Buffett's investment philosophy.",

  inputSchema: z.object({
    question: z.string().describe("The user's question"),
    conversationId: z.string().optional(),
  }),

  outputSchema: z.object({
    text: z.string().describe("The complete agent response"),
    toolCalls: z.array(z.any()).optional(),
    sources: z.array(z.object({
      text: z.string(),
      year: z.number().optional(),
      score: z.number(),
    })).optional(),
  }),

  execute: async ({ inputData, mastra }) => {
    if (!inputData?.question) {
      throw new Error("Question is required");
    }

    const agent = mastra?.getAgent("rag-agent");
    if (!agent) {
      throw new Error("RAG Agent not found in Mastra instance");
    }

    try {
      // Use generate() instead of stream for workflow execution
      // This ensures we get a complete response before returning
      const result = await agent.generate(inputData.question, {
        maxSteps: 5, // Allow multiple tool calls
        // Don't use onStepFinish here as it can cause streaming issues
      });

      // Extract sources from tool calls
      const sources: any[] = [];
      if (result.toolCalls && result.toolCalls.length > 0) {
        for (const toolCall of result.toolCalls) {
          const call = toolCall as any;
          
          if (call.toolName === "vector-search" && call.result?.results) {
            sources.push(
              ...call.result.results.map((r: any) => ({
                text: r.text?.substring(0, 200) + "..." || "",
                year: r.metadata?.year,
                score: r.score,
              }))
            );
          }
        }
      }

      // Return complete response
      return {
        text: result.text || "No response generated",
        toolCalls: result.toolCalls,
        sources: sources.length > 0 ? sources : undefined,
      };
      
    } catch (err: any) {
      console.error("Workflow execution error:", err);
      
      // Return error message instead of throwing
      return {
        text: `Error: ${err.message || 'Failed to generate response'}`,
        toolCalls: undefined,
        sources: undefined,
      };
    }
  },
});

/**
 * Create and commit the workflow
 */
export const ragWorkflow = createWorkflow({
  id: "rag-workflow",
  
  inputSchema: z.object({
    question: z.string(),
    conversationId: z.string().optional(),
  }),

  outputSchema: z.object({
    text: z.string(),
    toolCalls: z.array(z.any()).optional(),
    sources: z.array(z.object({
      text: z.string(),
      year: z.number().optional(),
      score: z.number(),
    })).optional(),
  }),
}).then(queryRagStep);

// Commit the workflow
ragWorkflow.commit();

export default ragWorkflow;