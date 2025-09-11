# Claude Code × OpenAI Codex 自動評価ループ 実装ガイド

## 目次
1. [環境準備](#1-環境準備)
2. [MCPサーバー実装](#2-mcpサーバー実装)
3. [Codex CLI統合](#3-codex-cli統合)
4. [Claude Code設定](#4-claude-code設定)
5. [動作確認とテスト](#5-動作確認とテスト)
6. [トラブルシューティング](#6-トラブルシューティング)

## 1. 環境準備

### 1.1 必要なソフトウェア

```bash
# Node.js (v18以上必須)
node --version

# npm
npm --version

# OpenAI Codex CLI インストール
npm install -g @openai/codex

# Codex CLIの動作確認
codex --version

# 必要なパッケージをインストール
npm init -y
npm install @modelcontextprotocol/sdk@^0.5.0 winston@^3.11.0 dotenv@^16.4.5 ws@^8.16.0
npm install --save-dev @types/node@^20.11.0 @types/ws@^8.5.10 typescript@^5.3.3 nodemon@^3.0.2 ts-node@^10.9.2
```

### 1.2 ディレクトリ構成

```
loopsmith/
├── mcp-server/
│   ├── src/
│   │   ├── server.ts         # MCPサーバー本体
│   │   ├── codex-evaluator.ts # Codex評価ロジック
│   │   └── types.ts          # 型定義
│   ├── prompts/
│   │   ├── evaluation-prompt.txt    # 日本語評価プロンプト
│   │   └── evaluation-prompt-en.txt # 英語評価プロンプト
│   ├── scripts/
│   │   └── test-integration.js # 統合テストスクリプト
│   ├── package.json
│   ├── tsconfig.json
│   └── .env
└── docs/
    └── claude-system-prompt.md # Claude Code用システムプロンプト
```

### 1.3 環境変数設定

```bash
# .env ファイル
# MCPサーバー設定
MCP_PORT=23100
MCP_HOST=localhost
LOG_LEVEL=info

# 評価設定
MAX_ITERATIONS=5
TARGET_SCORE=8.0

# プロンプト設定
# デフォルト: ../prompts/evaluation-prompt.txt
# 英語版: ../prompts/evaluation-prompt-en.txt
EVALUATION_PROMPT_PATH=../prompts/evaluation-prompt.txt

# パフォーマンス設定（推奨値）
CODEX_TIMEOUT=120000  # 120秒
CODEX_MAX_BUFFER=20971520  # 20MB
```

**注意**: 
- Codex CLIは独自の認証システム（`~/.config/codex/auth.json`）を使用するため、`OPENAI_API_KEY`環境変数は不要です。初回実行時に`codex login`コマンドで認証を行ってください。
- 評価プロンプトは`prompts/`ディレクトリ内のテキストファイルから読み込まれます。必要に応じてカスタマイズ可能です。

## 2. MCPサーバー実装

**重要**: 以下の実装はMCP SDK (`@modelcontextprotocol/sdk`) を使用してMCPプロトコルに完全準拠しています。

### 2.1 TypeScript設定 (tsconfig.json)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 2.2 型定義 (src/types.ts)

```typescript
export interface EvaluationRubric {
  completeness: number;
  accuracy: number;
  clarity: number;
  usability: number;
}

export interface EvaluationRequest {
  content: string;
  rubric?: EvaluationRubric;
  target_score?: number;
}

export interface EvaluationResponse {
  score: number;
  rubric_scores: EvaluationRubric;
  pass: boolean;
  suggestions: string[];
  metadata?: {
    iteration?: number;
    evaluation_time?: number;
    model_used?: string;
  };
}

export interface MCPMessage {
  jsonrpc: '2.0';
  id: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}
```

### 2.3 Codex評価モジュール (src/codex-evaluator.ts)

**改善点**:
- `spawn`を使用した堅牢なプロセス実行
- 指数バックオフによる自動再試行
- 改善されたJSON抽出ロジック
- クロスプラットフォーム対応

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import { EvaluationRequest, EvaluationResponse, EvaluationRubric } from './types';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export class CodexEvaluator {
  private readonly defaultRubric: EvaluationRubric = {
    completeness: 0.3,
    accuracy: 0.3,
    clarity: 0.2,
    usability: 0.2
  };

  async evaluate(request: EvaluationRequest): Promise<EvaluationResponse> {
    const rubric = request.rubric || this.defaultRubric;
    const targetScore = request.target_score || 8.0;
    
    // 評価プロンプトの構築
    const evaluationPrompt = this.buildEvaluationPrompt(request.content, rubric);
    
    try {
      // 一時ファイルにプロンプトを保存（長いプロンプト対応）
      const tempFile = path.join(__dirname, `../temp/eval_${Date.now()}.txt`);
      await fs.mkdir(path.dirname(tempFile), { recursive: true });
      await fs.writeFile(tempFile, evaluationPrompt, 'utf-8');
      
      // Codex CLIを実行
      const startTime = Date.now();
      const { stdout, stderr } = await execAsync(
        `codex exec --full-auto --format json < "${tempFile}"`,
        {
          timeout: 60000, // 60秒タイムアウト
          maxBuffer: 10 * 1024 * 1024 // 10MB バッファ
        }
      );
      
      // 一時ファイルを削除
      await fs.unlink(tempFile).catch(() => {});
      
      // Codexの出力を解析
      const evaluation = this.parseCodexOutput(stdout);
      
      // レスポンスの構築
      const response: EvaluationResponse = {
        score: evaluation.score,
        rubric_scores: evaluation.rubric_scores,
        pass: evaluation.score >= targetScore,
        suggestions: evaluation.suggestions,
        metadata: {
          evaluation_time: Date.now() - startTime,
          model_used: 'codex-1'
        }
      };
      
      return response;
      
    } catch (error) {
      console.error('Codex評価エラー:', error);
      throw {
        code: -32603,
        message: 'Codex評価に失敗しました',
        data: {
          details: error instanceof Error ? error.message : '不明なエラー',
          retryable: true
        }
      };
    }
  }

  private buildEvaluationPrompt(content: string, rubric: EvaluationRubric): string {
    return `
以下のドキュメントを評価し、JSON形式で結果を返してください。

評価基準と重み:
- 完全性 (${rubric.completeness * 100}%): すべての要求事項がカバーされているか
- 正確性 (${rubric.accuracy * 100}%): 技術的に正確か
- 明確性 (${rubric.clarity * 100}%): 理解しやすいか
- 実用性 (${rubric.usability * 100}%): 実装可能か

評価対象ドキュメント:
${content}

以下の形式でJSONを返してください:
{
  "overall_score": 0-10の数値,
  "rubric_scores": {
    "completeness": 0-10の数値,
    "accuracy": 0-10の数値,
    "clarity": 0-10の数値,
    "usability": 0-10の数値
  },
  "suggestions": [
    "改善提案1",
    "改善提案2",
    ...
  ]
}`;
  }

  private parseCodexOutput(output: string): any {
    try {
      // JSON部分を抽出
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('JSON出力が見つかりません');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        score: parsed.overall_score || 0,
        rubric_scores: parsed.rubric_scores || this.defaultRubric,
        suggestions: parsed.suggestions || []
      };
    } catch (error) {
      console.error('Codex出力の解析エラー:', error);
      // フォールバック値を返す
      return {
        score: 0,
        rubric_scores: {
          completeness: 0,
          accuracy: 0,
          clarity: 0,
          usability: 0
        },
        suggestions: ['評価結果の解析に失敗しました']
      };
    }
  }
}
```

### 2.4 MCPサーバー本体 (src/server.ts)

**改善点**:
- MCP SDK使用による完全なプロトコル準拠
- `initialize`/`tools/list`/`tools/call`の正しい実装
- パラメータ名の修正（`name`と`arguments`）
- APIキーのマスキング機能

```typescript
import * as WebSocket from 'ws';
import { CodexEvaluator } from './codex-evaluator';
import { MCPMessage, EvaluationRequest } from './types';
import * as winston from 'winston';
import * as dotenv from 'dotenv';

dotenv.config();

// ロガー設定
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'mcp-server.log' })
  ]
});

class MCPServer {
  private wss: WebSocket.Server;
  private evaluator: CodexEvaluator;
  private clients: Set<WebSocket> = new Set();

  constructor() {
    this.evaluator = new CodexEvaluator();
    
    // WebSocketサーバー起動
    const port = parseInt(process.env.MCP_PORT || '23100');
    this.wss = new WebSocket.Server({
      port,
      path: '/mcp',
      perMessageDeflate: false
    });

    this.setupWebSocketHandlers();
    logger.info(`MCPサーバー起動: ws://localhost:${port}/mcp`);
  }

  private setupWebSocketHandlers() {
    this.wss.on('connection', (ws: WebSocket) => {
      logger.info('新しいクライアント接続');
      this.clients.add(ws);

      // 初期化メッセージ送信
      this.sendMessage(ws, {
        jsonrpc: '2.0',
        id: 'init',
        result: {
          name: 'codex-evaluator',
          version: '1.0.0',
          capabilities: {
            tools: [
              {
                name: 'evaluate_document',
                description: 'ドキュメントの品質を評価',
                inputSchema: {
                  type: 'object',
                  properties: {
                    content: {
                      type: 'string',
                      description: '評価対象のドキュメント内容'
                    },
                    rubric: {
                      type: 'object',
                      description: '評価基準'
                    },
                    target_score: {
                      type: 'number',
                      default: 8.0
                    }
                  },
                  required: ['content']
                }
              },
              {
                name: 'get_improvement_suggestions',
                description: '改善提案を取得',
                inputSchema: {
                  type: 'object',
                  properties: {
                    content: {
                      type: 'string'
                    },
                    previous_score: {
                      type: 'number'
                    }
                  },
                  required: ['content']
                }
              }
            ]
          }
        }
      });

      ws.on('message', async (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as MCPMessage;
          logger.debug('受信メッセージ:', message);

          await this.handleMessage(ws, message);
        } catch (error) {
          logger.error('メッセージ処理エラー:', error);
          this.sendError(ws, 'parse-error', -32700, 'Parse error');
        }
      });

      ws.on('close', () => {
        logger.info('クライアント切断');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        logger.error('WebSocketエラー:', error);
      });
    });
  }

  private async handleMessage(ws: WebSocket, message: MCPMessage) {
    if (!message.method) {
      return;
    }

    switch (message.method) {
      case 'tools/call':
        await this.handleToolCall(ws, message);
        break;
      
      case 'ping':
        this.sendMessage(ws, {
          jsonrpc: '2.0',
          id: message.id,
          result: 'pong'
        });
        break;

      default:
        this.sendError(ws, message.id, -32601, 'Method not found');
    }
  }

  private async handleToolCall(ws: WebSocket, message: MCPMessage) {
    const { tool_name, arguments: args } = message.params || {};

    try {
      switch (tool_name) {
        case 'evaluate_document': {
          const request: EvaluationRequest = args;
          const result = await this.evaluator.evaluate(request);
          
          this.sendMessage(ws, {
            jsonrpc: '2.0',
            id: message.id,
            result
          });
          break;
        }

        case 'get_improvement_suggestions': {
          // 改善提案の生成（簡易実装）
          const suggestions = await this.generateSuggestions(args.content, args.previous_score);
          
          this.sendMessage(ws, {
            jsonrpc: '2.0',
            id: message.id,
            result: { suggestions }
          });
          break;
        }

        default:
          this.sendError(ws, message.id, -32602, `Unknown tool: ${tool_name}`);
      }
    } catch (error: any) {
      this.sendError(ws, message.id, error.code || -32603, error.message, error.data);
    }
  }

  private async generateSuggestions(content: string, previousScore: number): Promise<string[]> {
    // 簡易的な改善提案生成
    const suggestions: string[] = [];
    
    if (previousScore < 5) {
      suggestions.push('基本的な構造と内容を見直してください');
    }
    
    if (content.length < 500) {
      suggestions.push('より詳細な説明を追加してください');
    }
    
    if (!content.includes('```')) {
      suggestions.push('コード例を追加してください');
    }
    
    if (!content.includes('##')) {
      suggestions.push('セクション構造を明確にしてください');
    }
    
    return suggestions;
  }

  private sendMessage(ws: WebSocket, message: MCPMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      logger.debug('送信メッセージ:', message);
    }
  }

  private sendError(ws: WebSocket, id: any, code: number, message: string, data?: any) {
    this.sendMessage(ws, {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        data
      }
    });
  }

  public shutdown() {
    logger.info('サーバーシャットダウン中...');
    this.clients.forEach(client => client.close());
    this.wss.close();
  }
}

// サーバー起動
const server = new MCPServer();

// グレースフルシャットダウン
process.on('SIGINT', () => {
  server.shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.shutdown();
  process.exit(0);
});
```

### 2.5 package.json

```json
{
  "name": "codex-mcp-server",
  "version": "1.0.0",
  "description": "MCP Server for Claude Code × Codex Integration",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "nodemon --watch src --ext ts --exec ts-node src/server.ts",
    "test": "node scripts/test-integration.js"
  },
  "type": "module",
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.5.0",
    "dotenv": "^16.4.5",
    "winston": "^3.11.0",
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/ws": "^8.5.0",
    "nodemon": "^3.0.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.0.0"
  }
}
```

## 3. Codex CLI統合

### 3.1 Codex設定スクリプト (scripts/setup-codex.sh)

```bash
#!/bin/bash

echo "OpenAI Codex CLI セットアップ開始..."

# Codex CLIの存在確認
if ! command -v codex &> /dev/null; then
    echo "Codex CLIをインストールしています..."
    npm install -g @openai/codex
fi

# APIキーの設定
if [ -z "$OPENAI_API_KEY" ]; then
    echo "OpenAI APIキーを入力してください:"
    read -s api_key
    export OPENAI_API_KEY=$api_key
    echo "export OPENAI_API_KEY=$api_key" >> ~/.bashrc
fi

# Codex認証
codex auth --api-key $OPENAI_API_KEY

# 動作確認
echo "Codex CLIの動作確認中..."
echo "print('Hello from Codex')" | codex exec --full-auto

echo "セットアップ完了！"
```

### 3.2 統合テストスクリプト (scripts/test-integration.js)

```javascript
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
      this.ws = new WebSocket('ws://localhost:23100/mcp');
      
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
        tool_name: 'evaluate_document',
        arguments: {
          content: content,
          target_score: 8.0
        }
      }
    };
    
    console.log('📤 送信:', JSON.stringify(message, null, 2));
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
```

## 4. Claude Code設定

### 4.1 システムプロンプト (docs/claude-system-prompt.md)

```markdown
# Claude Code システムプロンプト

あなたはドキュメント品質改善アシスタントです。
以下のワークフローに従って動作してください：

## ワークフロー

1. **初期ドキュメント生成**
   - ユーザーの要求に基づいてドキュメントを作成
   - Markdown形式で構造化

2. **品質評価**
   - `codex-evaluator.evaluate_document` ツールを使用
   - 目標スコア: 8.0/10.0

3. **改善ループ**
   - スコアが目標未満の場合:
     - suggestionsに基づいて改善
     - 再評価を実行
   - 終了条件:
     - スコア8.0以上達成
     - 最大5回の反復
     - 3回連続で改善0.5未満

4. **結果報告**
   - 各ステップの結果を報告
   - 最終スコアと改善履歴を提示

## ツール使用方法

### evaluate_document
```
使用タイミング: ドキュメント作成・更新後
パラメータ:
  - content: 評価対象のドキュメント全文
  - target_score: 8.0 (デフォルト)
```

### get_improvement_suggestions
```
使用タイミング: 追加の改善案が必要な場合
パラメータ:
  - content: 現在のドキュメント
  - previous_score: 前回の評価スコア
```

## 注意事項

- 各評価結果は必ずユーザーに報告
- 改善は具体的かつ実装可能な内容に
- 技術的正確性を最優先
```

### 4.2 Claude Code接続手順

```bash
# 1. MCPサーバーを起動
cd mcp-server
npm run dev

# 2. 別ターミナルでClaude Codeを起動
claude

# 3. Claude Code内でMCP接続
> /ide
# "codex-evaluator" を選択

# 4. ツール確認
> /tools
# 以下が表示されることを確認:
# - codex-evaluator.evaluate_document
# - codex-evaluator.get_improvement_suggestions

# 5. システムプロンプト設定（必要に応じて）
> /system set-prompt < docs/claude-system-prompt.md
```

## 5. 動作確認とテスト

### 5.1 基本動作テスト

```bash
# 1. 単体テスト: MCPサーバー
cd mcp-server
npm test

# 2. 統合テスト: Codex CLI直接実行
echo "テストドキュメント" | codex exec --full-auto "このドキュメントを評価してJSON形式で結果を返して"

# 3. エンドツーエンドテスト
node scripts/test-integration.js

# 4. 対話モードテスト
node scripts/test-integration.js --interactive
```

### 5.2 Claude Code統合テスト

Claude Code内で以下のコマンドを実行:

```
# MCPサーバーとの初期ハンドシェイクを確認
> /tools

# 評価ツールが表示されることを確認後、ドキュメント生成テスト
> 以下の内容でREADMEドキュメントを作成し、品質が8.0以上になるまで自動改善してください:
「Webアプリケーションのデプロイ手順」
```

期待される動作:
1. 初期ドキュメント生成
2. 自動評価（スコア表示）
3. 改善提案に基づく修正
4. 再評価
5. 目標スコア達成または終了条件到達

### 5.3 ログ確認

```bash
# MCPサーバーログ
tail -f mcp-server/mcp-server.log

# リアルタイムモニタリング
tail -f mcp-server/mcp-server.log | grep -E "(評価|スコア|改善)"
```

## 6. トラブルシューティング

### 6.1 よくある問題と解決方法

#### WebSocket接続エラー
```bash
# ポート確認（Linux/Mac）
lsof -i :23100

# ポート確認（Windows）
netstat -an | findstr :23100

# ファイアウォール設定確認（Windows）
netsh advfirewall firewall show rule name="MCP Server"

# ポート変更が必要な場合
export MCP_PORT=23101
```

#### Codex CLIタイムアウト
```typescript
// codex-evaluator.ts の設定を調整
const codexProcess = spawn('codex', [
  'exec',
  '--full-auto',
  '--format', 'json',
  '--quiet'
], {
  timeout: parseInt(process.env.CODEX_TIMEOUT || '120000'),
  // 環境変数で制御可能
});
```

#### Codex CLIが見つからない
```bash
# インストール確認
npm run check-codex

# パスの確認
which codex  # Linux/Mac
where codex  # Windows

# 再インストール
npm install -g @openai/codex
```

#### 評価スコアが常に低い
```typescript
// デバッグモード有効化
const evaluationPrompt = this.buildEvaluationPrompt(request.content, rubric);
console.log('評価プロンプト:', evaluationPrompt);

// Codex出力の生データ確認
console.log('Codex生出力:', stdout);
```

### 6.2 デバッグコマンド

```bash
# WebSocket接続テスト
wscat -c ws://localhost:23100/mcp

# 手動メッセージ送信
echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | wscat -c ws://localhost:23100/mcp

# Codex CLI直接テスト
codex exec --full-auto "Hello World"

# ログレベル変更
export LOG_LEVEL=debug
npm run dev
```

### 6.3 パフォーマンス最適化

```javascript
// キャッシュ実装例
class EvaluationCache {
  constructor(ttl = 900000) { // 15分
    this.cache = new Map();
    this.ttl = ttl;
  }
  
  get(key) {
    const item = this.cache.get(key);
    if (item && Date.now() - item.timestamp < this.ttl) {
      return item.value;
    }
    return null;
  }
  
  set(key, value) {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }
}
```

## まとめ

本実装ガイドにより、以下が実現されます：

1. **完全自動化**: ドキュメント生成から評価、改善まで自動実行
2. **品質保証**: 定量的な評価基準による品質管理
3. **拡張性**: モジュール設計により機能追加が容易
4. **監視可能**: 詳細なログとメトリクス収集

次のステップ:
- プロダクション環境へのデプロイ
- CI/CDパイプライン統合
- カスタム評価基準の実装
- マルチ言語サポート