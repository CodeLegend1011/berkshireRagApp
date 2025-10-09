import dotenv from "dotenv";
import { createLogger } from "@mastra/core/logger";
import { Mastra } from "@mastra/core/mastra";

dotenv.config();

const MASTRA_LOG_LEVEL = (process.env.MASTRA_LOG_LEVEL as any) || "info";

export const logger = createLogger({
  level: MASTRA_LOG_LEVEL,
  name: "my-mastra-app",
});

export function createMastra(): Mastra {
  const mastra = new Mastra({
    logger, // only pass allowed props
    // other allowed options can go here if needed
  });

  return mastra;
}

export default {
  createMastra,
  logger,
};
