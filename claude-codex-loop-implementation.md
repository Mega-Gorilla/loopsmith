# Claude Code × OpenAI Codex 自動評価改善ループ アーキテクチャ設計書 v3

## 1. 概要

### 1.1 目的
ユーザーのプロンプト入力に基づいてClaude Code (CLI)がドキュメントを生成し、OpenAI Codex CLIを活用した評価システムによる自動評価を経て、評価基準を満たすまで改善を繰り返すシステムの構築。

### 1.2 期待される効果
- **品質の自動保証**: 定量的評価基準による品質管理
- **効率化**: 手動レビュー・修正サイクルの削減
- **客観性**: AIベースの一貫した品質評価
- **反復改善**: スコアベースの自動改善ループ

### 1.3 前提条件
- **Claude Code**: Anthropic公式CLIツール（ターミナルベースのAIアシスタント）
- **MCP (Model Context Protocol)**: 外部ツール統合の標準プロトコル
- **OpenAI Codex CLI**: OpenAI提供のローカルコーディングエージェント（`@openai/codex`）

## 2. システムアーキテクチャ

### 2.1 全体構成

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   ユーザー    │────>│ Claude Code  │<───>│ Codex MCP    │
│  (プロンプト) │     │  (CLI Tool)  │ WS  │   Server     │
└──────────────┘     └──────────────┘     └──────────────┘
                             ↑                     │
                             │                     ↓
                             │              ┌──────────────┐
                             └──────────────│ OpenAI Codex │
                              評価結果       │    (CLI)     │
                                            └──────────────┘
```

### 2.2 コンポーネント詳細

#### 2.2.1 Claude Code
- **役割**: ターミナルベースのAIアシスタント、ドキュメント生成、MCPクライアント
- **MCP接続**: WebSocket経由でMCPサーバーと通信
- **制御**: システムプロンプトによる評価ループ指示
- **実行環境**: ターミナル/コマンドライン

#### 2.2.2 Codex MCP Server
- **役割**: Claude CodeとOpenAI Codex CLIの仲介
- **実装**: Node.js/TypeScriptによるMCPサーバー
- **トランスポート**: WebSocket (第一選択)、HTTP/SSE (オプション)
- **ツール提供**: evaluate_document, get_improvement_suggestions

#### 2.2.3 OpenAI Codex CLI
- **役割**: コード生成・分析エンジン
- **実行**: ローカル環境で動作（プライバシー保護）
- **インストール**: `npm install -g @openai/codex`
- **モデル**: デフォルトGPT-5、o3/o4-mini選択可能

## 3. MCP統合設計

### 3.1 WebSocketトランスポート設定

#### MCPサーバー起動
```javascript
// mcp-server.js
const WebSocket = require('ws');
const { MCPServer } = require('@modelcontextprotocol/server');

const server = new MCPServer({
  name: 'codex-evaluator',
  version: '1.0.0',
  transport: 'websocket'
});

// WebSocketサーバー起動
const wss = new WebSocket.Server({ 
  port: 23100,
  path: '/mcp'
});

wss.on('connection', (ws) => {
  console.log('Claude Code connected via WebSocket');
  server.handleConnection(ws);
});

console.log('MCP Server running on ws://localhost:23100/mcp');
```

#### Claude Code接続手順
```bash
# 1. MCPサーバーを起動
node mcp-server.js

# 2. Claude Codeを起動
claude

# 3. Claude Code内でMCPサーバーを選択
/ide
# または自動検出されたサーバーリストから選択

# 4. ツール確認
/tools
# codex-evaluator.evaluate_document が表示されることを確認
```

### 3.2 MCPツール定義

#### evaluate_document
```typescript
{
  name: "evaluate_document",
  description: "ドキュメントの品質を評価",
  inputSchema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "評価対象のドキュメント内容"
      },
      rubric: {
        type: "object",
        description: "評価基準",
        properties: {
          completeness: { type: "number", default: 0.3 },
          accuracy: { type: "number", default: 0.3 },
          clarity: { type: "number", default: 0.2 },
          usability: { type: "number", default: 0.2 }
        }
      },
      target_score: {
        type: "number",
        default: 8.0,
        description: "目標スコア"
      }
    },
    required: ["content"]
  }
}

// レスポンス形式
{
  score: 7.5,
  rubric_scores: {
    completeness: 8.0,
    accuracy: 7.0,
    clarity: 8.0,
    usability: 7.0
  },
  pass: false,
  suggestions: [
    "サンプルコードを追加してください",
    "エラーハンドリングの説明を充実させてください"
  ]
}
```

### 3.3 エラーハンドリング（JSON-RPC形式）

```typescript
// 成功時
{
  jsonrpc: "2.0",
  id: 1,
  result: {
    score: 8.5,
    pass: true,
    suggestions: []
  }
}

// エラー時
{
  jsonrpc: "2.0",
  id: 1,
  error: {
    code: -32603,
    message: "評価実行中にエラーが発生しました",
    data: {
      details: "Codex CLIがタイムアウトしました",
      retryable: true
    }
  }
}
```

## 4. OpenAI Codex CLI統合

### 4.1 Codex CLIの実際の使用方法

```javascript
// MCPサーバー内でのCodex呼び出し
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function evaluateWithCodex(document) {
  // Codexに評価タスクを依頼
  const prompt = `
    以下のドキュメントを分析し、品質評価を行ってください。
    
    評価基準:
    - 完全性: すべての要求事項がカバーされているか
    - 正確性: 技術的に正確か
    - 明確性: 理解しやすいか
    - 実用性: 実装可能か
    
    0-10のスコアと改善提案を提供してください。
    
    ドキュメント:
    ${document}
  `;
  
  try {
    // Codex CLIを実行（-m オプションでモデル指定可能）
    const { stdout } = await execPromise(
      `echo "${prompt}" | codex --approve auto --format json`
    );
    
    // Codexの出力を解析して標準化
    return parseCodexOutput(stdout);
  } catch (error) {
    console.error('Codex実行エラー:', error);
    throw {
      code: -32603,
      message: 'Codex実行失敗',
      data: { details: error.message }
    };
  }
}

function parseCodexOutput(output) {
  // Codexの出力から評価情報を抽出
  // 実装はCodexの実際の出力形式に応じて調整
  return {
    score: extractScore(output),
    rubric_scores: extractRubricScores(output),
    suggestions: extractSuggestions(output),
    pass: extractScore(output) >= 8.0
  };
}
```

### 4.2 Codex CLIの制約事項

- **プラットフォーム**: macOS/Linux公式サポート、Windows実験的（WSL推奨）
- **承認モード**: `auto`モードで作業ディレクトリ内の自動実行
- **モデル選択**: デフォルトGPT-5、`-m o3`でモデル変更可能
- **ローカル実行**: ソースコードは環境外に送信されない

## 5. 評価ループ制御

### 5.1 システムプロンプトによる制御

```markdown
# Claude Codeへのシステム指示

あなたはドキュメント品質改善アシスタントです。
以下のワークフローに従ってください：

1. ユーザーの要求に基づいてドキュメントを生成
2. codex-evaluator.evaluate_document ツールで品質評価を実行
3. スコアが8.0未満の場合:
   - suggestionsに基づいてドキュメントを改善
   - 再度評価を実行
4. 以下の条件で終了:
   - スコアが8.0以上に到達
   - 最大5回の反復
   - 3回連続で改善が0.5未満

必ず各ステップの結果をユーザーに報告してください。
```

### 5.2 ループ制御パラメータ

```javascript
const loopConfig = {
  maxIterations: 5,
  targetScore: 8.0,
  minImprovement: 0.5,
  stagnantThreshold: 3,
  timeoutMs: 60000
};
```

## 6. セキュリティとプライバシー

### 6.1 認証とアクセス制御

```javascript
// 環境変数による設定（OAuth強制なし）
const config = {
  // OpenAI API（Codex用）
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  
  // MCPサーバー設定
  MCP_PORT: process.env.MCP_PORT || 23100,
  MCP_HOST: process.env.MCP_HOST || 'localhost',
  
  // ローカル専用（外部アクセス禁止）
  BIND_ADDRESS: '127.0.0.1'
};

// 秘密情報のログ除外
function sanitizeLog(data) {
  const sanitized = { ...data };
  if (sanitized.OPENAI_API_KEY) sanitized.OPENAI_API_KEY = '[REDACTED]';
  return sanitized;
}
```

### 6.2 ローカル実行の保証

- MCPサーバーは`localhost`のみでリッスン
- Codex CLIはローカル実行（コードは外部送信されない）
- WebSocketは認証不要（ローカル接続前提）

## 7. 実装ロードマップ

### Phase 1: 基礎実装（1週間）
1. OpenAI Codex CLIのインストールと動作確認
2. MCPサーバーのWebSocket実装
3. evaluate_documentツールの基本実装

### Phase 2: 統合テスト（1週間）
1. Claude CodeとMCPサーバーの接続テスト
2. Codex CLI呼び出しの統合
3. エラーハンドリングの実装

### Phase 3: ループ制御（1週間）
1. 評価ループロジックの実装
2. 終了条件の実装
3. パフォーマンス最適化

## 8. テスト手順

### 8.1 接続確認
```bash
# 1. MCPサーバー起動
node mcp-server.js

# 2. WebSocket接続確認
wscat -c ws://localhost:23100/mcp

# 3. Claude Code起動・接続
claude
> /ide
> Select: codex-evaluator
```

### 8.2 ツール動作確認
```javascript
// テスト用ダミードキュメント
const testDoc = "# Test Document\nThis is a test.";

// evaluate_document呼び出し
const result = await mcp.call('evaluate_document', {
  content: testDoc,
  target_score: 8.0
});

// 期待される結果
assert(result.score >= 0 && result.score <= 10);
assert(result.pass === (result.score >= 8.0));
assert(Array.isArray(result.suggestions));
```

## 9. 運用とモニタリング

### 9.1 ログ管理
```javascript
// MCPサーバーログ
const winston = require('winston');
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'mcp-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'mcp-combined.log' })
  ]
});

// リクエスト/レスポンスログ（秘密情報除外）
logger.info('Request received', sanitizeLog(request));
logger.info('Response sent', { score: result.score, pass: result.pass });
```

### 9.2 メトリクス収集
```javascript
const metrics = {
  evaluationTime: [],      // 評価時間
  iterationCount: [],      // 反復回数
  finalScores: [],         // 最終スコア
  improvementRates: []     // 改善率
};
```

## 10. まとめ

本設計書は、Claude CodeとOpenAI Codex CLIをMCP (WebSocket)で統合した自動評価改善ループシステムを定義しました。

**主要なポイント：**
1. **WebSocketファースト**: リアルタイム通信と自動検出
2. **ローカル実行**: プライバシー保護とセキュリティ
3. **プロンプト制御**: Hookではなくシステム指示による制御
4. **標準準拠**: JSON-RPCエラーハンドリング

この設計により、開発者フレンドリーで安全な自動品質改善システムを実現します。