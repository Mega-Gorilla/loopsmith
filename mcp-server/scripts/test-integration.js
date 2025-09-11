const WebSocket = require('ws');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

class MCPClient {
  constructor() {
    this.ws = null;
    this.messageId = 1;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const port = process.env.MCP_PORT || '23101';  // テスト用ポート
      this.ws = new WebSocket(`ws://localhost:${port}/mcp`);
      
      this.ws.on('open', () => {
        console.log('✅ MCPサーバーに接続しました');
        resolve();
      });
      
      this.ws.on('message', (data) => {
        const message = JSON.parse(data);
        console.log('📨 受信:', JSON.stringify(message, null, 2));
      });
      
      this.ws.on('error', (error) => {
        console.error('❌ エラー:', error);
        reject(error);
      });
    });
  }

  async evaluateDocument(content) {
    const message = {
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'tools/call',
      params: {
        name: 'evaluate_document',  // tool_name から name に修正
        arguments: {
          content: content,
          target_score: 8.0
        }
      }
    };
    
    console.log('📤 送信:', JSON.stringify(message, null, 2));
    this.ws.send(JSON.stringify(message));
  }
  
  async getSuggestions(content, previousScore) {
    const message = {
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'tools/call',
      params: {
        name: 'get_improvement_suggestions',
        arguments: {
          content: content,
          previous_score: previousScore
        }
      }
    };
    
    console.log('📤 送信:', JSON.stringify(message, null, 2));
    this.ws.send(JSON.stringify(message));
  }
  
  async listTools() {
    const message = {
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'tools/list',
      params: {}
    };
    
    console.log('📤 ツール一覧取得:', JSON.stringify(message, null, 2));
    this.ws.send(JSON.stringify(message));
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function main() {
  const client = new MCPClient();
  
  try {
    await client.connect();
    
    // まずツール一覧を取得
    console.log('\n📋 利用可能なツールを確認中...');
    await client.listTools();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // テストドキュメント
    const testDoc = `
# テストドキュメント

## 概要
これは自動評価システムのテストドキュメントです。

## 機能
- 機能1: 基本的な処理
- 機能2: エラーハンドリング

## 実装例
\`\`\`javascript
function test() {
  console.log("Hello World");
}
\`\`\`
`;
    
    console.log('\n📝 評価するドキュメント:');
    console.log(testDoc);
    console.log('\n⏳ 評価中...\n');
    
    await client.evaluateDocument(testDoc);
    
    // レスポンスを待つ
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 改善提案の取得テスト
    console.log('\n💡 改善提案を取得中...');
    await client.getSuggestions(testDoc, 5.0);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
  } catch (error) {
    console.error('テスト失敗:', error);
  } finally {
    client.close();
  }
}

// 対話モード
async function interactive() {
  const client = new MCPClient();
  await client.connect();
  
  console.log('\n対話モード開始 (終了: "exit")');
  
  const askQuestion = () => {
    rl.question('\nドキュメント内容を入力 > ', async (input) => {
      if (input.toLowerCase() === 'exit') {
        client.close();
        rl.close();
        return;
      }
      
      await client.evaluateDocument(input);
      setTimeout(askQuestion, 2000);
    });
  };
  
  askQuestion();
}

// コマンドライン引数で動作を切り替え
if (process.argv.includes('--interactive')) {
  interactive();
} else {
  main();
}