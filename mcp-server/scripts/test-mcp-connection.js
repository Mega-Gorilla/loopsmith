#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('MCPサーバー接続テスト開始...\n');

// サーバープロセスを起動
const serverPath = path.join(__dirname, '../src/server-stdio.js');
const server = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let responseBuffer = '';

// サーバーからの出力を監視
server.stdout.on('data', (data) => {
  responseBuffer += data.toString();
  
  // 初期化完了メッセージを探す
  if (responseBuffer.includes('"method":"tools/list"')) {
    console.log('✓ サーバー初期化完了');
    
    // ツールリストリクエストを送信
    const listRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    };
    
    server.stdin.write(JSON.stringify(listRequest) + '\n');
  }
  
  // レスポンスを探す
  const lines = responseBuffer.split('\n');
  for (const line of lines) {
    if (line.trim() && line.startsWith('{')) {
      try {
        const response = JSON.parse(line);
        if (response.result && response.result.tools) {
          console.log('\n✓ 利用可能なツール:');
          response.result.tools.forEach(tool => {
            console.log(`  - ${tool.name}: ${tool.description}`);
          });
          
          // テスト成功
          console.log('\n✓ MCPサーバー接続テスト成功！');
          process.exit(0);
        }
      } catch (e) {
        // JSONパースエラーは無視
      }
    }
  }
});

server.stderr.on('data', (data) => {
  console.error('エラー:', data.toString());
});

server.on('close', (code) => {
  console.log(`サーバープロセス終了 (code: ${code})`);
  process.exit(code);
});

// タイムアウト設定
setTimeout(() => {
  console.error('✗ タイムアウト: サーバーからの応答がありません');
  server.kill();
  process.exit(1);
}, 10000);

// 初期リクエストを送信
setTimeout(() => {
  const initRequest = {
    jsonrpc: '2.0',
    id: 0,
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
  
  console.log('初期化リクエスト送信...');
  server.stdin.write(JSON.stringify(initRequest) + '\n');
}, 1000);