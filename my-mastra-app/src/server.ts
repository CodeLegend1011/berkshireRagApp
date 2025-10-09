// src/server.ts
import express from 'express';
import cors from 'cors';
import { mastra } from './mastra/index.js';

const app = express();
const PORT = process.env.PORT || 4111;

// Middleware
app.use(cors());
app.use(express.json());

// Mount Mastra's built-in admin/playground router
// Check if servePlayground method exists (newer versions of Mastra)
try {
  if (typeof (mastra as any).servePlayground === 'function') {
    const adminRouter = (mastra as any).servePlayground();
    if (adminRouter) {
      app.use('/playground', adminRouter);
      console.log('✅ Mastra Playground mounted at /playground');
    }
  } else {
    console.log('ℹ️  servePlayground not available, using API endpoints only');
    console.log('💡 To access full UI, run: npm run dev (with Mastra CLI)');
  }
} catch (error) {
  console.warn('⚠️  Could not mount Mastra playground:', error);
}

// API endpoint for agent queries (for Postman/API testing)
app.post('/api/agent/query', async (req, res) => {
  try {
    const { message, agentId = 'berkshire-agent' } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const agent = mastra.getAgent(agentId);
    if (!agent) {
      return res.status(404).json({ error: `Agent ${agentId} not found` });
    }

    const result = await agent.generate(message);

    res.json({
      success: true,
      response: result.text,
      agentId,
    });
  } catch (error) {
    console.error('Agent query error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// API endpoint for workflow execution
app.post('/api/workflow/execute', async (req, res) => {
  try {
    const { workflowId = 'berkshire-workflow', input } = req.body;

    if (!input || !input.question) {
      return res.status(400).json({ error: 'Input with question is required' });
    }

    const workflow = mastra.getWorkflow(workflowId);
    if (!workflow) {
      return res.status(404).json({ error: `Workflow ${workflowId} not found` });
    }

    const result = await workflow.execute(input);

    res.json({
      success: true,
      result,
      workflowId,
    });
  } catch (error) {
    console.error('Workflow execution error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// List available agents
app.get('/api/agents', (req, res) => {
  try {
    const agents = mastra.getAgents();
    const agentList = agents ? Object.keys(agents) : [];
    res.json({ agents: agentList });
  } catch (error) {
    res.json({ agents: [] });
  }
});

// List available workflows
app.get('/api/workflows', (req, res) => {
  try {
    const workflows = mastra.getWorkflows();
    const workflowList = workflows ? Object.keys(workflows) : [];
    res.json({ workflows: workflowList });
  } catch (error) {
    res.json({ workflows: [] });
  }
});

// Root endpoint with API documentation
app.get('/', (req, res) => {
  try {
    const agents = mastra.getAgents();
    const workflows = mastra.getWorkflows();
    
    res.json({
      message: 'Berkshire Hathaway RAG API',
      note: 'For full Mastra UI playground, run: npm run dev',
      endpoints: {
        playground: 'GET /playground (if available)',
        agentQuery: 'POST /api/agent/query',
        workflowExecute: 'POST /api/workflow/execute',
        listAgents: 'GET /api/agents',
        listWorkflows: 'GET /api/workflows',
        health: 'GET /health'
      },
      agents: agents ? Object.keys(agents) : [],
      workflows: workflows ? Object.keys(workflows) : []
    });
  } catch (error) {
    res.json({
      message: 'Berkshire Hathaway RAG API',
      error: 'Could not load Mastra configuration'
    });
  }
});

// Playground fallback route (if native playground not available)
app.get('/playground', (req, res) => {
  try {
    const agents = mastra.getAgents();
    const workflows = mastra.getWorkflows();
    
    res.json({
      message: 'Mastra Playground - API Mode',
      note: 'For full interactive UI, run: npm run dev (Mastra CLI)',
      availableResources: {
        agents: agents ? Object.keys(agents) : [],
        workflows: workflows ? Object.keys(workflows) : []
      },
      howToUse: {
        postman: 'Import the Postman collection to test endpoints',
        curl: 'Use curl commands to test the API',
        mastraCLI: 'Run "npm run dev" for full interactive playground'
      },
      apiEndpoints: {
        queryAgent: {
          method: 'POST',
          path: '/api/agent/query',
          body: {
            message: 'Your question here',
            agentId: 'berkshire-agent'
          }
        },
        executeWorkflow: {
          method: 'POST',
          path: '/api/workflow/execute',
          body: {
            workflowId: 'berkshire-workflow',
            input: { question: 'Your question here' }
          }
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Playground unavailable',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 API Base: http://localhost:${PORT}`);
  console.log(`📊 Playground: http://localhost:${PORT}/playground`);
  console.log(`🔗 API endpoints:`);
  console.log(`   POST /api/agent/query`);
  console.log(`   POST /api/workflow/execute`);
  console.log(`   GET  /api/agents`);
  console.log(`   GET  /api/workflows`);
  console.log(`   GET  /health`);
  console.log(`\n💡 For full interactive Mastra UI, run: npm run dev`);
});