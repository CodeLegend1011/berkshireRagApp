import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import ragAgent from "./agents/mastra-rag-agent";
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";

// ---------------------------
// Workflow
// ---------------------------
const queryRagStep = createStep({
  id: "query-rag",
  description: "Queries the RAG Agent to answer user questions.",
  inputSchema: z.object({ question: z.string() }),
  outputSchema: z.object({ text: z.string() }),
  execute: async ({ inputData, mastra }) => {
    const agent = mastra?.getAgent("rag-agent");
    if (!agent) throw new Error("RAG Agent not found");

    const result = await agent.generate(inputData.question);

    return { text: result.text || "" };
  },
});

const ragWorkflow = createWorkflow({
  id: "rag-workflow",
  inputSchema: z.object({ question: z.string() }),
  outputSchema: z.object({ text: z.string() }),
}).then(queryRagStep);

ragWorkflow.commit();

// ---------------------------
// Mastra instance with Admin UI
// ---------------------------
export const mastra = new Mastra({
  agents: { "rag-agent": ragAgent },
  workflows: { "rag-workflow": ragWorkflow },
  logger: new PinoLogger({ name: "MyMastraRAG", level: "info" }),
  telemetry: { enabled: false },
});