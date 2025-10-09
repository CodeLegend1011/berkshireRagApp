// src/mastra.ts
import { Mastra } from '@mastra/core/mastra';
import { PgVector, PostgresStore } from '@mastra/pg';
import { PinoLogger } from '@mastra/loggers';
import { berkshireAgent } from './agents/berkshire-agent';

const PG_CONNECTION_STRING = 
  process.env.DATABASE_URL! ;

export const pgVector = new PgVector({
  connectionString: PG_CONNECTION_STRING,
  schemaName: "berkshire_intelligence",
});

const pgStorage = new PostgresStore({
  connectionString: PG_CONNECTION_STRING,
});

export const mastra = new Mastra({
  workflows: {},
  
  agents: {
    'berkshire-agent': berkshireAgent,
  },
  
  storage: pgStorage,
  
  vectors: {
    pg: pgVector,
  },
  
  logger: new PinoLogger({
    name: 'BerkshireHathawayRAG',
    level: 'info',
  }),
  
  telemetry: {
    enabled: true,
  },
});

export default mastra;