// アーキテクチャドキュメント評価スクリプト
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const MCP_URL = 'ws://localhost:23110/mcp';
const DOC_PATH = path.join(__dirname, '../../docs/architecture.md');

async function evaluateArchitectureDoc() {
  console.log('📚 アーキテクチャドキュメントの評価を開始...');
  console.log(`📄 評価対象: ${DOC_PATH}`);
  
  // ドキュメントを読み込み
  const docContent = fs.readFileSync(DOC_PATH, 'utf-8');
  console.log(`📝 ドキュメントサイズ: ${docContent.length}文字`);
  
  console.log(`\n📡 MCPサーバーに接続中: ${MCP_URL}`);
  const ws = new WebSocket(MCP_URL);
  
  return new Promise((resolve, reject) => {
    let messageId = 1;
    const startTime = Date.now();
    
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
      
      // 初期化完了後、評価を実行
      if (message.result && message.result.serverInfo) {
        console.log('✅ 初期化完了');
        console.log('\n🔍 ドキュメント評価を開始...');
        console.log('⏳ Codexによる評価を実行中（最大10分）...\n');
        
        const evalMessage = {
          jsonrpc: '2.0',
          method: 'tools/call',
          id: messageId++,
          params: {
            name: 'evaluate_document',
            arguments: {
              content: docContent,
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
        
        // 進捗表示
        const progressInterval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          process.stdout.write(`\r⏱️  評価実行中... ${elapsed}秒経過`);
        }, 1000);
        
        // タイムアウト処理を10分に延長
        setTimeout(() => {
          clearInterval(progressInterval);
          console.error('\n❌ タイムアウト: 10分以内に応答がありませんでした');
          ws.close();
          reject(new Error('Evaluation timeout'));
        }, 600000); // 10分
      }
      
      // 評価結果受信
      if (message.result && message.result.content) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        console.log(`\n\n✅ 評価完了！（処理時間: ${elapsed}秒）`);
        
        const result = JSON.parse(message.result.content[0].text);
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 評価結果サマリー');
        console.log('='.repeat(60));
        
        // 総合スコア
        console.log(`\n🎯 総合スコア: ${result.score}/10 ${result.pass ? '✅ 合格' : '❌ 不合格'}`);
        
        // 詳細スコア
        console.log('\n📈 詳細スコア:');
        if (result.rubric_scores) {
          console.log(`  • 完全性 (Completeness): ${result.rubric_scores.completeness}/10`);
          console.log(`  • 正確性 (Accuracy): ${result.rubric_scores.accuracy}/10`);
          console.log(`  • 明確性 (Clarity): ${result.rubric_scores.clarity}/10`);
          console.log(`  • 実用性 (Usability): ${result.rubric_scores.usability}/10`);
        }
        
        // 改善提案
        if (result.suggestions && result.suggestions.length > 0) {
          console.log('\n💡 改善提案:');
          result.suggestions.forEach((suggestion, index) => {
            console.log(`  ${index + 1}. ${suggestion}`);
          });
        }
        
        // ダッシュボード案内
        console.log('\n' + '='.repeat(60));
        console.log('🌐 ダッシュボードで詳細を確認:');
        console.log('   http://localhost:3001');
        console.log('='.repeat(60));
        
        ws.close();
        resolve(result);
      }
      
      // エラー処理
      if (message.error) {
        console.error('\n❌ エラー:', message.error);
        ws.close();
        reject(new Error(message.error.message));
      }
    });
    
    ws.on('error', (error) => {
      console.error('\n❌ WebSocketエラー:', error);
      reject(error);
    });
    
    ws.on('close', () => {
      console.log('\n📤 評価セッション終了');
    });
  });
}

// 実行
console.log('🔄 LoopSmith Document Evaluator');
console.log('================================\n');

evaluateArchitectureDoc()
  .then((result) => {
    console.log('\n✨ 評価プロセス正常終了');
    
    // 結果をファイルに保存
    const resultPath = path.join(__dirname, '../evaluation-results.json');
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(`📁 結果を保存: ${resultPath}`);
    
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 評価プロセスエラー:', error.message);
    process.exit(1);
  });