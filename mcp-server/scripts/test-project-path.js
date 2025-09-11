#!/usr/bin/env node

/**
 * Test script for project_path parameter functionality
 * 
 * This script tests whether the project_path parameter correctly
 * sets the working directory for Codex evaluation.
 */

const path = require('path');
const { spawn } = require('child_process');

// Test with mock evaluator first
process.env.USE_MOCK_EVALUATOR = 'true';

// Import after setting environment
const { CodexEvaluator } = require('../dist/codex-evaluator');

async function testProjectPath() {
  console.log('Testing project_path parameter functionality\n');
  console.log('='.repeat(60));
  
  const evaluator = new CodexEvaluator();
  
  // Test case 1: Without project_path
  console.log('\nTest 1: Without project_path');
  console.log('-'.repeat(40));
  
  const request1 = {
    content: '# Test Documentation\n\nThis is a test document.',
    target_score: 8.0,
    weights: {
      completeness: 30,
      accuracy: 30,
      clarity: 20,
      usability: 20
    }
  };
  
  try {
    console.log('Request:', JSON.stringify(request1, null, 2));
    const result1 = await evaluator.evaluate(request1);
    console.log('Result:', JSON.stringify(result1, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
  
  // Test case 2: With project_path
  console.log('\nTest 2: With project_path');
  console.log('-'.repeat(40));
  
  const testProjectPath = path.resolve(__dirname, '..', '..');  // Repository root
  const request2 = {
    content: `# LoopSmith Documentation
    
This documentation describes the LoopSmith MCP server implementation.

## Files
- mcp-server/src/server.ts: WebSocket server
- mcp-server/src/codex-evaluator.ts: Evaluation logic

Please verify these files exist in the project.`,
    target_score: 8.0,
    weights: {
      completeness: 30,
      accuracy: 30,
      clarity: 20,
      usability: 20
    },
    project_path: testProjectPath
  };
  
  console.log('Request:', JSON.stringify(request2, null, 2));
  console.log('Project path:', testProjectPath);
  
  // Switch to real evaluator for actual test
  if (process.argv.includes('--real')) {
    console.log('\nUsing REAL Codex evaluator...');
    process.env.USE_MOCK_EVALUATOR = 'false';
    
    // Re-require to get real evaluator
    delete require.cache[require.resolve('../dist/codex-evaluator')];
    const { CodexEvaluator: RealEvaluator } = require('../dist/codex-evaluator');
    const realEvaluator = new RealEvaluator();
    
    try {
      const result2 = await realEvaluator.evaluate(request2);
      console.log('Result:', JSON.stringify(result2, null, 2));
      
      // Check if Codex could access the files
      if (result2.suggestions) {
        console.log('\nSuggestions indicate file access:');
        result2.suggestions.forEach(s => console.log('- ' + s));
      }
    } catch (error) {
      console.error('Error:', error);
    }
  } else {
    // Mock test
    try {
      const result2 = await evaluator.evaluate(request2);
      console.log('Result:', JSON.stringify(result2, null, 2));
      console.log('\n✅ Mock test passed. Run with --real flag to test with actual Codex.');
    } catch (error) {
      console.error('Error:', error);
    }
  }
  
  // Test case 3: Invalid project path
  console.log('\nTest 3: Invalid project path');
  console.log('-'.repeat(40));
  
  const request3 = {
    content: '# Test',
    project_path: '/nonexistent/path'
  };
  
  console.log('Request:', JSON.stringify(request3, null, 2));
  
  try {
    const result3 = await evaluator.evaluate(request3);
    console.log('Result:', JSON.stringify(result3, null, 2));
  } catch (error) {
    console.error('Expected error for invalid path:', error.message || error);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Test completed');
}

// Check if Codex is available
function checkCodexAvailable() {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const checkCommand = isWindows ? 'where' : 'which';
    
    const check = spawn(checkCommand, ['codex'], { shell: isWindows });
    
    check.on('close', (code) => {
      resolve(code === 0);
    });
    
    check.on('error', () => {
      resolve(false);
    });
  });
}

async function main() {
  const codexAvailable = await checkCodexAvailable();
  
  if (!codexAvailable) {
    console.log('⚠️  Codex CLI not found. Running with mock evaluator only.');
    console.log('Install Codex with: npm install -g @openai/codex\n');
  } else {
    console.log('✅ Codex CLI found');
    if (process.argv.includes('--real')) {
      console.log('🚀 Running with REAL Codex evaluator\n');
    } else {
      console.log('ℹ️  Running with mock evaluator. Use --real flag to test with actual Codex.\n');
    }
  }
  
  await testProjectPath();
}

main().catch(console.error);