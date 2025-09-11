#!/usr/bin/env node

/**
 * MCP Server with Stdio Transport (CommonJS compatible)
 * 
 * This is the standard MCP implementation using stdio transport
 * as per the Model Context Protocol specification.
 */

// Environment setup
require('dotenv').config();

const winston = require('winston');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const axios = require('axios').default;

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    })
  ),
  transports: [
    new winston.transports.File({ filename: 'mcp-server-stdio.log' })
  ]
});

// Select evaluator based on environment variable
const useMock = process.env.USE_MOCK_EVALUATOR === 'true';

// Dashboard related variables
let dashboardProcess = null;
const dashboardPort = process.env.DASHBOARD_PORT || '3000';

// Function to check if port is available
async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

// Function to wait for dashboard to be ready
async function waitForDashboard(port, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${port}/health`, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error('Not ready'));
          }
        });
        req.on('error', reject);
        req.setTimeout(1000);
      });
      return true;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return false;
}

// Function to open browser
function openBrowser(url) {
  const platform = process.platform;
  let command;
  
  if (platform === 'win32') {
    command = 'start';
  } else if (platform === 'darwin') {
    command = 'open';
  } else {
    command = 'xdg-open';
  }
  
  spawn(command, [url], { 
    shell: true,
    detached: true,
    stdio: 'ignore'
  }).unref();
}

// Function to launch dashboard
async function launchDashboard() {
  try {
    // Check if port is available
    const portAvailable = await isPortAvailable(dashboardPort);
    if (!portAvailable) {
      console.error(`Dashboard port ${dashboardPort} is already in use`);
      return;
    }
    
    // Launch dashboard process
    console.error(`Launching dashboard on port ${dashboardPort}...`);
    
    const dashboardScript = path.join(__dirname, '../dist/dashboard.js');
    dashboardProcess = spawn('node', [dashboardScript], {
      env: { ...process.env, DASHBOARD_PORT: dashboardPort },
      detached: false,
      stdio: 'ignore'
    });
    
    dashboardProcess.on('error', (err) => {
      console.error('Failed to start dashboard:', err);
    });
    
    // Wait for dashboard to be ready
    const ready = await waitForDashboard(dashboardPort);
    if (ready) {
      const dashboardUrl = `http://localhost:${dashboardPort}`;
      console.error(`Dashboard ready at ${dashboardUrl}`);
      
      // Auto-open browser if enabled
      if (process.env.AUTO_OPEN_BROWSER !== 'false') {
        console.error('Opening dashboard in browser...');
        openBrowser(dashboardUrl);
      }
    } else {
      console.error('Dashboard failed to start within timeout');
    }
  } catch (error) {
    console.error('Error launching dashboard:', error);
  }
}

// Function to send events to dashboard via HTTP
async function sendDashboardEvent(event, data) {
  if (process.env.ENABLE_DASHBOARD === 'false' || !dashboardPort) {
    return;
  }
  
  try {
    await axios.post(`http://localhost:${dashboardPort}/api/event`, {
      event,
      data,
      timestamp: new Date().toISOString()
    }, {
      timeout: 1000
    });
  } catch (error) {
    // Silently fail if dashboard is not available
    logger.debug('Failed to send event to dashboard:', error.message);
  }
}

async function main() {
  try {
    // Debug: Log environment variables
    console.error('Environment variables:');
    console.error('  ENABLE_DASHBOARD:', process.env.ENABLE_DASHBOARD);
    console.error('  DASHBOARD_PORT:', process.env.DASHBOARD_PORT);
    console.error('  AUTO_OPEN_BROWSER:', process.env.AUTO_OPEN_BROWSER);
    
    // Dynamic import of ESM modules
    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const { 
      ListToolsRequestSchema,
      CallToolRequestSchema 
    } = await import('@modelcontextprotocol/sdk/types.js');
    
    // Import evaluators from compiled dist
    const { CodexEvaluator: RealCodexEvaluator } = require('../dist/codex-evaluator');
    const { CodexEvaluatorMock } = require('../dist/codex-evaluator-mock');
    
    const CodexEvaluator = useMock ? CodexEvaluatorMock : RealCodexEvaluator;
    
    if (useMock) {
      logger.info('Using mock evaluator (USE_MOCK_EVALUATOR=true)');
      console.log('⚠️  Using mock evaluator (USE_MOCK_EVALUATOR=true)');
    }

    // Create MCP server instance
    const server = new Server(
      {
        name: 'loopsmith',
        version: '2.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    // Initialize evaluator
    const evaluator = new CodexEvaluator();

    // Register tool handlers
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{
        name: 'evaluate_document',
        description: 'Evaluate document quality using Codex CLI',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The document content to evaluate'
            },
            target_score: {
              type: 'number',
              description: 'Target score for the document (default: 8.0)',
              default: 8.0
            },
            weights: {
              type: 'object',
              description: 'Custom weights for evaluation criteria',
              properties: {
                completeness: {
                  type: 'number',
                  description: 'Weight for completeness (0-100)',
                  default: 30
                },
                accuracy: {
                  type: 'number',
                  description: 'Weight for accuracy (0-100)',
                  default: 30
                },
                clarity: {
                  type: 'number',
                  description: 'Weight for clarity (0-100)',
                  default: 20
                },
                usability: {
                  type: 'number',
                  description: 'Weight for usability (0-100)',
                  default: 20
                }
              }
            },
            project_path: {
              type: 'string',
              description: 'Path to the project directory for context-aware evaluation (read-only access)'
            }
          },
          required: ['content']
        }
      }]
    }));

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'evaluate_document') {
        try {
          logger.info('Starting document evaluation', { 
            contentLength: args.content?.length,
            targetScore: args.target_score,
            projectPath: args.project_path 
          });

          // Send start event to dashboard
          await sendDashboardEvent('evaluation:start', {
            document: args.content?.substring(0, 200) + '...',
            projectPath: args.project_path,
            targetScore: args.target_score
          });

          const evaluationRequest = {
            content: args.content,
            target_score: args.target_score || parseFloat(process.env.TARGET_SCORE || '8.0'),
            weights: args.weights || {
              completeness: 30,
              accuracy: 30,
              clarity: 20,
              usability: 20
            },
            project_path: args.project_path  // Claude Codeの実行ディレクトリ
          };

          // Send progress event
          await sendDashboardEvent('evaluation:progress', { progress: 50 });

          const result = await evaluator.evaluate(evaluationRequest);

          logger.info('Evaluation completed', {
            score: result.score,
            pass: result.score >= evaluationRequest.target_score
          });

          // Send completion event to dashboard
          await sendDashboardEvent('evaluation:complete', result);

          // Return evaluation result
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          };
        } catch (error) {
          logger.error('Evaluation failed:', error);
          
          // Send error event to dashboard
          await sendDashboardEvent('evaluation:error', {
            error: error.message,
            stack: error.stack
          });
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: error.message || 'Unknown error occurred',
                  details: error.stack || undefined
                }, null, 2)
              }
            ],
            isError: true
          };
        }
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`
            }
          ],
          isError: true
        };
      }
    });

    // Create stdio transport
    const transport = new StdioServerTransport();
    
    // Connect server to transport
    await server.connect(transport);
    
    logger.info('MCP Server (stdio) started successfully');
    logger.info(`Mock evaluator: ${useMock}`);
    logger.info(`Target score: ${process.env.TARGET_SCORE || '8.0'}`);
    
    // Log to stderr so it doesn't interfere with stdio protocol
    console.error('MCP Server started (stdio transport)');
    console.error(`Using ${useMock ? 'mock' : 'real'} Codex evaluator`);
    
    // Launch dashboard if enabled
    if (process.env.ENABLE_DASHBOARD !== 'false') {
      await launchDashboard();
    }
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down MCP server...');
      if (dashboardProcess) {
        console.error('Shutting down dashboard...');
        dashboardProcess.kill();
      }
      await server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down MCP server...');
      if (dashboardProcess) {
        console.error('Shutting down dashboard...');
        dashboardProcess.kill();
      }
      await server.close();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    logger.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

// Run the server
main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});