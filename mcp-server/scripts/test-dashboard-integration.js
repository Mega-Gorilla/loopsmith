// ダッシュボード統合テストスクリプト
const WebSocket = require('ws');

const MCP_URL = 'ws://localhost:23110/mcp';

async function testDashboardIntegration() {
  console.log('🔄 ダッシュボード統合テストを開始...');
  console.log(`📡 MCPサーバーに接続中: ${MCP_URL}`);
  
  const ws = new WebSocket(MCP_URL);
  
  return new Promise((resolve, reject) => {
    let messageId = 1;
    
    ws.on('open', () => {
      console.log('✅ WebSocket接続成功');
      
      // Initialize
      const initMessage = {
        jsonrpc: '2.0',
        method: 'initialize',
        id: messageId++,
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {}
        }
      };
      
      console.log('📤 初期化メッセージ送信');
      ws.send(JSON.stringify(initMessage));
    });
    
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      console.log('📥 メッセージ受信:', JSON.stringify(message, null, 2));
      
      // 初期化完了後、評価を実行
      if (message.result && message.result.serverInfo) {
        console.log('✅ 初期化完了');
        console.log('📤 評価リクエスト送信');
        
        const evalMessage = {
          jsonrpc: '2.0',
          method: 'tools/call',
          id: messageId++,
          params: {
            name: 'evaluate_document',
            arguments: {
              content: `# ダッシュボード統合テスト

## 概要
このドキュメントは、ダッシュボード統合テストのために作成されました。

## 機能テスト
- リアルタイムログ表示
- 評価進捗表示
- 結果の可視化

## コード例
\`\`\`javascript
console.log('Dashboard integration test');
\`\`\`

## まとめ
ダッシュボードとMCPサーバーの統合により、評価プロセスをリアルタイムで監視できます。`,
              rubric: {
                completeness: 0.3,
                accuracy: 0.3,
                clarity: 0.2,
                usability: 0.2
              },
              target_score: 8.0
            }
          }
        };
        
        ws.send(JSON.stringify(evalMessage));
      }
      
      // 評価結果受信
      if (message.result && message.result.content) {
        console.log('✅ 評価完了！');
        const result = JSON.parse(message.result.content[0].text);
        console.log('📊 評価結果:', result);
        
        console.log('\n🎉 ダッシュボード統合テスト成功！');
        console.log('📌 ダッシュボードで確認: http://localhost:3001');
        
        ws.close();
        resolve();
      }
      
      // エラー処理
      if (message.error) {
        console.error('❌ エラー:', message.error);
        ws.close();
        reject(new Error(message.error.message));
      }
    });
    
    ws.on('error', (error) => {
      console.error('❌ WebSocketエラー:', error);
      reject(error);
    });
    
    ws.on('close', () => {
      console.log('📤 WebSocket接続終了');
    });
    
    // タイムアウト設定
    setTimeout(() => {
      console.error('❌ タイムアウト: 30秒以内に応答がありませんでした');
      ws.close();
      reject(new Error('Timeout'));
    }, 30000);
  });
}

// 実行
testDashboardIntegration()
  .then(() => {
    console.log('\n✅ テスト完了');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ テスト失敗:', error);
    process.exit(1);
  });