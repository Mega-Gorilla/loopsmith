# MCP実装分析と改善提案

## エグゼクティブサマリー

現在のLoopSmith MCPサーバー実装は、独自のWebSocketサーバーを使用していますが、MCP標準ではstdioトランスポートを使用し、クライアント（Claude Code）がサブプロセスとして自動起動する設計が推奨されています。本ドキュメントでは、Serena MCPなどの成功事例を参考に、標準準拠の実装への移行を提案します。

## 1. 現状分析

### 1.1 現在の実装アーキテクチャ

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Claude Code    │────>│  WebSocket       │────>│  Codex CLI  │
│                 │<────│  Server          │<────│             │
└─────────────────┘     └──────────────────┘     └─────────────┘
        │                  ws://localhost:23100
        │
        └── 手動で接続する必要がある
```

### 1.2 問題点の詳細

| 問題カテゴリ | 現在の実装 | 影響 |
|------------|----------|------|
| **トランスポート** | WebSocketサーバー（ws://） | MCP標準から逸脱、複雑性増加 |
| **起動方法** | 手動でサーバー起動が必要 | ユーザビリティ低下、エラー prone |
| **プロセス管理** | ユーザーが管理 | サーバーの停止忘れ、ポート競合 |
| **SDK活用** | 独自JSON-RPC実装 | メンテナンス負荷、互換性リスク |
| **設定方法** | 複雑な手順 | 導入障壁が高い |

## 2. MCP標準実装の理解

### 2.1 MCP (Model Context Protocol) とは

MCPは、AIアシスタントと外部ツール間の通信を標準化するオープンソースプロトコルです。

**主要な特徴：**
- **Stdioトランスポート**: 標準入出力を使用した通信（デフォルト）
- **自動起動**: クライアントがサーバーをサブプロセスとして管理
- **JSON-RPC 2.0**: 標準化されたメッセージフォーマット
- **ツール公開**: 動的なツール発見と実行

### 2.2 Serena MCPの成功要因

Serena MCPは、以下の設計により広く採用されています：

1. **シンプルなインストール**
   ```bash
   claude mcp add serena -- uvx --from git+https://github.com/oraios/serena serena-mcp-server
   ```

2. **自動起動**: Claude Code起動時に自動的にサーバーも起動
3. **標準準拠**: MCP SDKを完全活用
4. **拡張性**: 多言語対応、豊富なツール

## 3. 実装比較

### 3.1 詳細比較表

| 項目 | 現在の実装 | MCP標準実装 | 改善効果 |
|------|-----------|------------|---------|
| **通信方式** | WebSocket (ws://) | Stdio (標準入出力) | シンプル化 |
| **サーバー起動** | `npm start`を手動実行 | Claude Codeが自動起動 | UX向上 |
| **登録方法** | 複雑な設定 | `claude mcp add`一発 | 導入容易化 |
| **プロセス管理** | 手動 | 自動（クライアント管理） | 安定性向上 |
| **ポート管理** | 必要（23100番など） | 不要 | 競合回避 |
| **環境変数** | .envファイル | 登録時に指定 | 設定集約 |
| **SDK使用** | 部分的 | フル活用 | 保守性向上 |
| **デバッグ** | 別プロセスで困難 | 統合ログで容易 | 開発効率向上 |

### 3.2 コード比較

#### 現在の実装（WebSocket）
```typescript
// server.ts
import { Server as WebSocketServer } from 'ws';

class CodexMCPServer {
  private wss: WebSocketServer;
  
  constructor() {
    this.wss = new WebSocketServer({
      port: 23100,
      path: '/mcp'
    });
    // 独自のメッセージハンドリング
  }
}
```

#### 標準実装（Stdio）
```typescript
// index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server({
  name: 'codex-evaluator',
  version: '2.0.0'
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

## 4. 移行計画

### 4.1 フェーズ1: 準備（Week 1）

1. **新しいブランチ作成**
   ```bash
   git checkout -b feature/mcp-stdio-migration
   ```

2. **依存関係の整理**
   - 不要なパッケージ削除: `ws`, `express`, `socket.io`
   - MCP SDK のバージョン確認

3. **ドキュメント準備**
   - 移行ガイド作成
   - READMEの下書き

### 4.2 フェーズ2: 実装（Week 2-3）

1. **新しいエントリーポイント作成**
   ```
   src/
   ├── index.ts         # 新しいMCPサーバー
   ├── tools/
   │   └── evaluator.ts # ツール実装
   └── legacy/          # 旧実装を一時保存
   ```

2. **Stdioサーバー実装**
   - MCP SDKを使用した標準実装
   - 既存のCodex評価ロジックを移植

3. **package.json更新**
   ```json
   {
     "bin": {
       "loopsmith-mcp": "./dist/index.js"
     }
   }
   ```

### 4.3 フェーズ3: テスト（Week 4）

1. **ローカルテスト**
   ```bash
   # ビルド
   npm run build
   
   # テスト実行
   echo '{"jsonrpc":"2.0","method":"initialize","id":1}' | node dist/index.js
   ```

2. **Claude Code統合テスト**
   ```bash
   claude mcp add codex-evaluator-test -- node /path/to/dist/index.js
   ```

3. **互換性テスト**
   - 既存機能の動作確認
   - エラーハンドリング確認

### 4.4 フェーズ4: 移行（Week 5）

1. **段階的移行**
   - 両方の実装を一時的に共存
   - ユーザーに選択肢を提供

2. **ドキュメント更新**
   - README.md の全面改訂
   - 移行ガイドの公開

3. **サポート体制**
   - FAQの準備
   - Issue対応体制

## 5. 技術的詳細

### 5.1 Stdioトランスポートの仕組み

```
Claude Code (親プロセス)
    │
    ├─ stdin  ──> MCPサーバー
    ├─ stdout <── MCPサーバー  
    └─ stderr <── MCPサーバー（エラー/ログ）
```

**メッセージフロー：**
1. Claude Codeがstdinにリクエストを送信
2. MCPサーバーが処理
3. stdoutにレスポンスを返却

### 5.2 環境変数の扱い

**現在の方法（.envファイル）：**
```bash
# .env
CODEX_TIMEOUT=300000
USE_MOCK_EVALUATOR=false
```

**新しい方法（登録時指定）：**
```bash
claude mcp add codex-evaluator \
  --env CODEX_TIMEOUT=300000 \
  --env USE_MOCK_EVALUATOR=false \
  -- node dist/index.js
```

### 5.3 エラーハンドリング

**標準エラー出力の活用：**
```typescript
// ログはstderrに出力（stdoutと混在しない）
console.error('[INFO]', 'Server started');
console.error('[ERROR]', error.message);
```

## 6. 期待される成果

### 6.1 ユーザー体験の向上

| 指標 | 現在 | 改善後 | 改善率 |
|------|------|--------|--------|
| セットアップ時間 | 5-10分 | 1分以内 | 80-90%削減 |
| 必要なコマンド数 | 5個以上 | 1個 | 80%削減 |
| エラー発生率 | 高（ポート競合等） | 低 | 推定70%削減 |
| 学習曲線 | 急 | 緩やか | - |

### 6.2 技術的メリット

1. **保守性向上**
   - コードベース30-40%削減
   - 依存関係の簡素化
   - テストの容易化

2. **互換性向上**
   - MCP標準準拠
   - 他のMCPクライアント対応
   - 将来の拡張性確保

3. **安定性向上**
   - プロセス管理の自動化
   - リソースリークの防止
   - エラー処理の標準化

## 7. リスクと対策

### 7.1 移行リスク

| リスク | 発生確率 | 影響度 | 対策 |
|--------|---------|--------|------|
| 既存ユーザーの混乱 | 中 | 高 | 段階的移行、十分な告知 |
| 機能の一時的低下 | 低 | 中 | 徹底的なテスト |
| ダッシュボード機能の分離 | 高 | 低 | 別プロジェクト化 |
| Windows互換性問題 | 中 | 中 | 早期テスト、回避策準備 |

### 7.2 リスク軽減策

1. **並行運用期間の設定**
   - 1ヶ月間は両方式をサポート
   - 段階的な移行を促進

2. **充実したドキュメント**
   - ステップバイステップガイド
   - トラブルシューティング
   - 動画チュートリアル

3. **コミュニティサポート**
   - Discordチャンネル開設
   - FAQ の充実
   - サンプルコード提供

## 8. 実装例

### 8.1 最小限のMCPサーバー実装

```typescript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

async function main() {
  const server = new Server({
    name: 'codex-evaluator',
    version: '2.0.0'
  });

  // ツールの登録
  server.setRequestHandler('tools/list', async () => ({
    tools: [{
      name: 'evaluate_document',
      description: 'Evaluate document with Codex',
      inputSchema: {
        type: 'object',
        properties: {
          content: { 
            type: 'string',
            description: 'Document to evaluate'
          }
        },
        required: ['content']
      }
    }]
  }));

  // ツールの実行
  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;
    
    if (name === 'evaluate_document') {
      // Codex評価ロジック
      const result = await evaluateWithCodex(args.content);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result)
        }]
      };
    }
    
    throw new Error(`Unknown tool: ${name}`);
  });

  // Stdioトランスポートで起動
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('MCP Server started (stdio mode)');
}

main().catch(console.error);
```

### 8.2 Claude Code登録スクリプト

```bash
#!/bin/bash
# install-mcp.sh

echo "Installing LoopSmith MCP Server..."

# ビルド
cd mcp-server
npm install
npm run build

# Claude Codeに登録
claude mcp add codex-evaluator \
  --env CODEX_TIMEOUT=300000 \
  --env USE_MOCK_EVALUATOR=false \
  --env TARGET_SCORE=8.0 \
  -- node "$(pwd)/dist/index.js"

echo "Installation complete!"
echo "Restart Claude Code to use the codex-evaluator tools."
```

## 9. 結論

### 9.1 推奨事項

1. **即座に着手すべきこと**
   - 新規ブランチでのプロトタイプ開発
   - MCP SDKの詳細調査
   - テスト環境の準備

2. **中期的な目標**
   - 2-3週間での実装完了
   - 1ヶ月での完全移行

3. **長期的なビジョン**
   - npmパッケージとしての公開
   - コミュニティへの貢献
   - 他ツールとの連携拡大

### 9.2 まとめ

現在のWebSocketベースの実装から、MCP標準のstdioトランスポートへの移行は、技術的に正しい方向性であり、ユーザー体験の大幅な改善が期待できます。Serena MCPの成功事例が示すように、標準準拠の実装は採用率向上にも寄与します。

段階的な移行計画により、リスクを最小限に抑えながら、より優れたMCPサーバーの実現が可能です。

## 付録A: 参考資料

- [MCP公式ドキュメント](https://modelcontextprotocol.io)
- [Serena MCP](https://github.com/oraios/serena)
- [Claude Code MCP設定ガイド](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)

## 付録B: 用語集

| 用語 | 説明 |
|------|------|
| **MCP** | Model Context Protocol - AIとツール間の標準プロトコル |
| **Stdio** | Standard I/O - 標準入出力を使った通信方式 |
| **JSON-RPC** | JSON形式のRemote Procedure Call プロトコル |
| **トランスポート** | 通信の物理層/転送方式 |
| **サブプロセス** | 親プロセスから起動される子プロセス |

---

*作成日: 2025年1月*  
*バージョン: 1.0*