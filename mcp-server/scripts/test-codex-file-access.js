#!/usr/bin/env node

/**
 * Test script to investigate Codex file exploration capabilities
 * 
 * This script tests whether Codex can access and explore files
 * in the repository when evaluating documents.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Test configuration
const TEST_CASES = [
  {
    name: 'Test 1: Simple evaluation with file context request',
    prompt: `Please evaluate the following documentation and check if it matches the actual implementation in the codebase.

Look for files named "server.ts" or "codex-evaluator.ts" in the repository to verify the documentation accuracy.

Documentation to evaluate:
# LoopSmith MCP Server

This server implements the Model Context Protocol for document evaluation.

## Main Components
- server.ts: WebSocket server implementation
- codex-evaluator.ts: Evaluation logic using Codex CLI

Please provide:
1. Your evaluation score (1-10)
2. List any files you were able to access
3. Any suggestions for improvement

Format your response as JSON with score, files_accessed, and suggestions fields.`
  },
  {
    name: 'Test 2: Direct file exploration request',
    prompt: `List all TypeScript files in the current directory and its subdirectories.

Then evaluate this statement: "The project uses TypeScript for all server code."

Provide your response as JSON with:
- files_found: array of file paths
- evaluation_score: 1-10
- can_access_files: boolean`
  },
  {
    name: 'Test 3: Working directory check',
    prompt: `What is your current working directory? 
Can you see any package.json files?
List the first 5 files you can find in the current directory tree.

Response format:
- cwd: current working directory
- package_json_found: boolean
- files_list: array of file paths`
  }
];

async function runCodexTest(testCase) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Running: ${testCase.name}`);
    console.log(`${'='.repeat(80)}\n`);
    
    const isWindows = process.platform === 'win32';
    const codexCommand = isWindows ? 'codex.cmd' : 'codex';
    
    // Get the repository root (parent of mcp-server)
    const repoRoot = path.resolve(__dirname, '..', '..');
    console.log(`Repository root: ${repoRoot}`);
    console.log(`Current working directory: ${process.cwd()}`);
    
    const codexArgs = [
      'exec',
      '--full-auto',
      '--skip-git-repo-check'
    ];
    
    console.log(`Command: ${codexCommand} ${codexArgs.join(' ')}`);
    console.log(`Working directory for Codex: ${repoRoot}\n`);
    
    const codexProcess = spawn(codexCommand, codexArgs, {
      shell: isWindows,
      windowsHide: true,
      timeout: 60000, // 1 minute timeout
      env: { ...process.env },
      cwd: repoRoot // Set working directory to repository root
    });
    
    let stdout = '';
    let stderr = '';
    
    codexProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      // Real-time output for debugging
      process.stdout.write(chunk);
    });
    
    codexProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      // Real-time error output
      process.stderr.write(chunk);
    });
    
    // Send the prompt
    codexProcess.stdin.write(testCase.prompt);
    codexProcess.stdin.end();
    
    codexProcess.on('close', (code) => {
      console.log(`\n${'─'.repeat(80)}`);
      console.log(`Process exited with code: ${code}`);
      
      if (stderr) {
        console.log('\nStderr output:');
        console.log(stderr);
      }
      
      console.log(`\nFull stdout (length: ${stdout.length}):`);
      console.log(stdout);
      
      // Try to parse JSON from output
      try {
        // Look for JSON in the output
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          console.log('\nParsed JSON:');
          console.log(JSON.stringify(parsed, null, 2));
          
          // Analyze file access capability
          if (parsed.files_accessed || parsed.files_found || parsed.files_list) {
            console.log('\n✅ Codex appears to have file access capability!');
            console.log('Files accessed:', parsed.files_accessed || parsed.files_found || parsed.files_list);
          } else if (parsed.can_access_files !== undefined) {
            console.log(`\n${parsed.can_access_files ? '✅' : '❌'} File access: ${parsed.can_access_files}`);
          }
        }
      } catch (e) {
        console.log('\nCould not parse JSON from output');
      }
      
      resolve({ stdout, stderr, code });
    });
    
    codexProcess.on('error', (error) => {
      console.error('Process error:', error);
      reject(error);
    });
  });
}

async function main() {
  console.log('Starting Codex File Access Investigation');
  console.log('=========================================\n');
  
  // Check if Codex is available
  const isWindows = process.platform === 'win32';
  const checkCommand = isWindows ? 'where codex' : 'which codex';
  
  try {
    const { execSync } = require('child_process');
    const codexPath = execSync(checkCommand, { encoding: 'utf-8' }).trim();
    console.log(`Codex found at: ${codexPath}`);
  } catch (e) {
    console.error('❌ Codex CLI not found. Please install it first.');
    process.exit(1);
  }
  
  // Check current directory structure
  console.log('\nRepository structure check:');
  const repoRoot = path.resolve(__dirname, '..', '..');
  console.log(`Repository root: ${repoRoot}`);
  
  // List some files to verify structure
  try {
    const files = fs.readdirSync(repoRoot).slice(0, 10);
    console.log('Root directory contents:', files);
    
    const mcpServerPath = path.join(repoRoot, 'mcp-server');
    if (fs.existsSync(mcpServerPath)) {
      const mcpFiles = fs.readdirSync(mcpServerPath).slice(0, 10);
      console.log('mcp-server directory contents:', mcpFiles);
    }
  } catch (e) {
    console.error('Error listing directory:', e.message);
  }
  
  // Run tests
  for (const testCase of TEST_CASES) {
    try {
      await runCodexTest(testCase);
    } catch (error) {
      console.error(`Test failed: ${error.message}`);
    }
    
    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('Investigation Complete');
  console.log('='.repeat(80));
  
  console.log('\n📋 Summary:');
  console.log('- Check the output above to see if Codex could access files');
  console.log('- Look for file paths in the responses');
  console.log('- Note any error messages about file access');
  console.log('\n💡 Recommendations:');
  console.log('- If Codex has file access, ensure sensitive files are excluded');
  console.log('- If no file access, consider passing file context explicitly');
  console.log('- Consider setting appropriate working directory for evaluations');
}

// Run the investigation
main().catch(console.error);