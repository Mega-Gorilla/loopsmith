#!/usr/bin/env node

/**
 * Test script for MCP Server with stdio transport
 * 
 * This script tests the MCP server by sending JSON-RPC messages
 * through stdio and checking the responses.
 */

const { spawn } = require('child_process');
const path = require('path');

// Test configuration
const SERVER_PATH = path.join(__dirname, '..', 'src', 'server-stdio.js');
const TEST_TIMEOUT = 30000; // 30 seconds

// Test messages
const initMessage = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'test-client',
      version: '1.0.0'
    }
  }
};

const listToolsMessage = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: {}
};

const evaluateMessage = {
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: {
    name: 'evaluate_document',
    arguments: {
      content: `# Test Document

This is a test document for evaluating the MCP server.

## Features
- Feature 1: Basic functionality
- Feature 2: Advanced capabilities
- Feature 3: Integration support

## Usage
The system is designed to be easy to use.

## Conclusion
This document serves as a test for the evaluation system.`,
      target_score: 7.0
    }
  }
};

async function runTest() {
  console.log('Starting MCP Server stdio test...\n');
  
  // Set environment for mock evaluator
  const env = { 
    ...process.env, 
    USE_MOCK_EVALUATOR: 'true',
    LOG_LEVEL: 'debug'
  };
  
  // Spawn the server process
  const server = spawn('node', [SERVER_PATH], {
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  let responses = [];
  let errors = [];
  
  // Handle server output
  server.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      try {
        const response = JSON.parse(line);
        responses.push(response);
        console.log('Response:', JSON.stringify(response, null, 2));
      } catch (e) {
        // Not JSON, ignore
      }
    }
  });
  
  // Handle server errors
  server.stderr.on('data', (data) => {
    const message = data.toString();
    console.error('Server log:', message.trim());
  });
  
  // Handle server exit
  server.on('close', (code) => {
    if (code !== 0) {
      console.error(`Server exited with code ${code}`);
    }
  });
  
  // Send test messages with delays
  const sendMessage = (message) => {
    return new Promise((resolve) => {
      console.log('\nSending:', message.method || 'response');
      server.stdin.write(JSON.stringify(message) + '\n');
      setTimeout(resolve, 1000); // Wait 1 second for response
    });
  };
  
  try {
    // Test 1: Initialize
    await sendMessage(initMessage);
    
    // Test 2: List tools
    await sendMessage(listToolsMessage);
    
    // Test 3: Call evaluate_document tool
    await sendMessage(evaluateMessage);
    
    // Wait for all responses
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check results
    console.log('\n=== Test Results ===');
    console.log(`Total responses received: ${responses.length}`);
    
    // Check initialization response
    const initResponse = responses.find(r => r.id === 1);
    if (initResponse && initResponse.result) {
      console.log('✓ Initialization successful');
    } else {
      console.log('✗ Initialization failed');
    }
    
    // Check tools list response
    const toolsResponse = responses.find(r => r.id === 2);
    if (toolsResponse && toolsResponse.result && toolsResponse.result.tools) {
      console.log(`✓ Tools listed: ${toolsResponse.result.tools.length} tool(s)`);
      const evalTool = toolsResponse.result.tools.find(t => t.name === 'evaluate_document');
      if (evalTool) {
        console.log('✓ evaluate_document tool found');
      }
    } else {
      console.log('✗ Tools list failed');
    }
    
    // Check evaluation response
    const evalResponse = responses.find(r => r.id === 3);
    if (evalResponse && evalResponse.result) {
      console.log('✓ Evaluation completed');
      if (evalResponse.result.content && evalResponse.result.content[0]) {
        const result = JSON.parse(evalResponse.result.content[0].text);
        console.log(`  Score: ${result.score}/10`);
        console.log(`  Pass: ${result.score >= 7.0 ? 'Yes' : 'No'}`);
      }
    } else {
      console.log('✗ Evaluation failed');
    }
    
    console.log('\n✅ All tests completed');
    
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  } finally {
    // Clean up
    server.kill();
    process.exit(0);
  }
}

// Run the test
runTest().catch(console.error);