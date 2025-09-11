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

async function main() {
  try {
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
            }
          };

          const result = await evaluator.evaluate(evaluationRequest);

          logger.info('Evaluation completed', {
            score: result.score,
            pass: result.score >= evaluationRequest.target_score
          });

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
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down MCP server...');
      await server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down MCP server...');
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