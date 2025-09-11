const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// 評価対象のドキュメントを読み込み
const docPath = path.join(__dirname, '../../docs/architecture.md');
const documentContent = fs.readFileSync(docPath, 'utf-8');

class EvaluationClient {
  constructor(port = 23106) {  // 改善版本番モードのポート
    this.port = port;
    this.ws = null;
    this.messageId = 1;
    this.evaluationComplete = false;
    this.evaluationResult = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      console.log(`📡 MCPサーバーに接続中 (ws://localhost:${this.port}/mcp)...`);
      this.ws = new WebSocket(`ws://localhost:${this.port}/mcp`);
      
      this.ws.on('open', () => {
        console.log('✅ 接続成功\n');
        resolve();
      });
      
      this.ws.on('message', (data) => {
        const message = JSON.parse(data);
        console.log('📨 受信メッセージ:');
        console.log(JSON.stringify(message, null, 2));
        console.log('---\n');
        
        // 評価結果の解析
        if (message.result && message.result.content) {
          try {
            const content = message.result.content[0].text;
            const result = JSON.parse(content);
            
            // 評価完了フラグを設定
            this.evaluationComplete = true;
            this.evaluationResult = result;
            
            console.log('🎯 評価結果サマリー:');
            console.log(`  総合スコア: ${result.score}/10`);
            console.log(`  合格判定: ${result.pass ? '✅ 合格' : '❌ 不合格'}`);
            console.log('\n📊 詳細スコア:');
            console.log(`  完全性: ${result.rubric_scores.completeness}/10`);
            console.log(`  正確性: ${result.rubric_scores.accuracy}/10`);
            console.log(`  明確性: ${result.rubric_scores.clarity}/10`);
            console.log(`  実用性: ${result.rubric_scores.usability}/10`);
            
            if (result.suggestions && result.suggestions.length > 0) {
              console.log('\n💡 改善提案:');
              result.suggestions.forEach((s, i) => {
                console.log(`  ${i + 1}. ${s}`);
              });
            }
            
            if (result.metadata) {
              console.log('\n⚙️ メタデータ:');
              console.log(`  評価時間: ${result.metadata.evaluation_time}ms`);
              console.log(`  使用モデル: ${result.metadata.model_used}`);
            }
          } catch (e) {
            // JSON解析エラーは無視（他のメッセージの可能性）
          }
        }
        
        // エラーメッセージの処理
        if (message.error) {
          console.error('❌ エラー応答:');
          console.error(`  コード: ${message.error.code}`);
          console.error(`  メッセージ: ${message.error.message}`);
          if (message.error.data) {
            console.error(`  詳細: ${JSON.stringify(message.error.data, null, 2)}`);
          }
          this.evaluationComplete = true; // エラーでも完了とする
        }
      });
      
      this.ws.on('error', (error) => {
        console.error('❌ エラー:', error.message);
        reject(error);
      });
      
      this.ws.on('close', () => {
        console.log('🔌 接続終了');
      });
    });
  }

  async initialize() {
    const message = {
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'initialize',
      params: {}
    };
    
    console.log('📤 初期化リクエスト送信...');
    this.ws.send(JSON.stringify(message));
    
    // レスポンス待機
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async listTools() {
    const message = {
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'tools/list',
      params: {}
    };
    
    console.log('📤 ツール一覧取得...');
    this.ws.send(JSON.stringify(message));
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async evaluateDocument(content) {
    const message = {
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'tools/call',
      params: {
        name: 'evaluate_document',
        arguments: {
          content: content,
          target_score: 8.0,
          rubric: {
            completeness: 0.3,
            accuracy: 0.3,
            clarity: 0.2,
            usability: 0.2
          }
        }
      }
    };
    
    console.log('📤 ドキュメント評価リクエスト送信...');
    console.log(`  ドキュメントサイズ: ${content.length} 文字`);
    console.log(`  最初の100文字: ${content.substring(0, 100)}...`);
    console.log('');
    
    this.ws.send(JSON.stringify(message));
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function main() {
  const client = new EvaluationClient(23106);  // 改善版本番モードのポート
  
  try {
    // MCPサーバーに接続
    await client.connect();
    
    // 初期化
    await client.initialize();
    
    // ツール一覧確認
    await client.listTools();
    
    // ドキュメント評価
    console.log('📝 アーキテクチャドキュメントを評価中...\n');
    await client.evaluateDocument(documentContent);
    
    // 結果を待つ（Codex処理時間を考慮）
    console.log('⏳ Codex CLIでの評価処理中... (最大10分)\n');
    console.log('  ※ Codexは大規模なドキュメント評価に時間がかかります。しばらくお待ちください...\n');
    
    // 10分間、5秒ごとに評価完了をチェック
    const maxWaitTime = 600000; // 10分
    const checkInterval = 5000; // 5秒
    let elapsed = 0;
    let lastProgressReport = 0;
    
    while (elapsed < maxWaitTime && !client.evaluationComplete) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      elapsed += checkInterval;
      
      // 30秒ごとに進捗表示
      if (elapsed - lastProgressReport >= 30000) {
        const minutes = Math.floor(elapsed / 60000);
        const seconds = (elapsed % 60000) / 1000;
        console.log(`  ⏱️ 経過時間: ${minutes}分${seconds}秒`);
        lastProgressReport = elapsed;
      }
    }
    
    if (client.evaluationComplete) {
      console.log('\n✅ 評価が完了しました！');
    } else {
      console.log('\n⚠️ タイムアウト: 10分経過しても評価が完了しませんでした。');
    }
    
  } catch (error) {
    console.error('❌ テスト失敗:', error);
  } finally {
    // 少し待ってから切断
    await new Promise(resolve => setTimeout(resolve, 2000));
    client.close();
  }
}

// 実行
console.log('========================================');
console.log('  LoopSmith ドキュメント評価テスト');
console.log('========================================\n');
console.log(`📁 評価対象: ${docPath}`);
console.log(`📊 目標スコア: 8.0/10`);
console.log(`🔧 評価モード: 本番 (Codex CLI)`);
console.log('========================================\n');

main();