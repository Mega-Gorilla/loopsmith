# WebSocketからstdioへの移行ガイド

## 概要

LoopSmith v2.0では、標準MCPプロトコルに準拠したstdio通信をサポートしました。このガイドでは、既存のWebSocketベースの実装から新しいstdio実装への移行方法を説明します。

## 移行のメリット

1. **自動起動**: Claude Codeがサーバーを自動的に起動・管理
2. **ポート競合なし**: stdioを使用するためポート管理が不要
3. **安定性向上**: プロセス管理がクライアント側で自動化
4. **標準準拠**: MCP公式仕様に完全準拠

## 移行手順

### ステップ1: 既存の登録を削除

```bash
# 既存のWebSocketサーバー登録を確認
claude mcp list

# 既存の登録を削除（名前が"loopsmith"の場合）
claude mcp remove loopsmith
```

### ステップ2: 最新コードを取得してビルド

```bash
# リポジトリを更新
git pull

# 依存関係を更新
cd mcp-server
npm install

# TypeScriptをビルド
npm run build
```

### ステップ3: 新しいstdioサーバーを登録

**macOS/Linux:**

```bash
# 標準実装で登録（絶対パス推奨）
claude mcp add loopsmith -- node "$(pwd)/mcp-server/dist/server-stdio.js"

# または、カスタム環境変数を指定
claude mcp add loopsmith \
  --env USE_MOCK_EVALUATOR=false \
  --env TARGET_SCORE=8.0 \
  --env CODEX_TIMEOUT=300000 \
  --env CODEX_SUPPORTS_JSON_FORMAT=false \
  -- node "$(pwd)/mcp-server/dist/server-stdio.js"
```

**Windows PowerShell:**

```powershell
# 標準実装で登録（絶対パス推奨）
claude mcp add loopsmith -- node "$PWD\mcp-server\dist\server-stdio.js"

# または、カスタム環境変数を指定
claude mcp add loopsmith `
  --env USE_MOCK_EVALUATOR=false `
  --env TARGET_SCORE=8.0 `
  --env CODEX_TIMEOUT=300000 `
  --env CODEX_SUPPORTS_JSON_FORMAT=false `
  -- node "$PWD\mcp-server\dist\server-stdio.js"
```

### ステップ4: 動作確認

Claude Code内で以下を実行:

```
> /mcp
# loopsmithが表示されることを確認

> /tools
# evaluate_documentツールが利用可能なことを確認
```

## project_pathパラメータの活用

v2.0では、評価時にプロジェクトディレクトリを指定できる`project_path`パラメータが追加されました。これにより、Codexが評価対象ドキュメントに関連するプロジェクトファイルを参照して、より正確な評価を行えるようになります。

### 使用方法

Claude Code内でevaluate_documentツールを使用する際:

```javascript
// 現在のプロジェクトディレクトリを指定
evaluate_document({
  content: "評価対象のドキュメント",
  project_path: process.cwd(),  // 現在の作業ディレクトリ
  weights: {
    completeness: 30,
    accuracy: 30,
    clarity: 20,
    usability: 20
  }
})

// または特定のプロジェクトパスを指定
evaluate_document({
  content: "APIドキュメント",
  project_path: "/path/to/your/project"
})
```

### 動作仕様

- **project_path未指定時**: MCPサーバー起動時のカレントディレクトリが使用されます
- **project_path指定時**: 指定されたディレクトリでCodexが実行され、そのディレクトリ内のファイルを読み取り専用で参照可能
- **セキュリティ**: Codexは指定されたディレクトリを読み取り専用でアクセス（`CODEX_SANDBOX_MODE: 'workspace-read'`）

### 移行時の注意点

旧WebSocket実装ではproject_pathパラメータがサポートされていません。この機能を利用するには、stdio実装への移行が必要です。

## 環境変数の移行

### 旧方式（.envファイル）

```bash
# .envファイルで設定
MCP_PORT=23100
USE_MOCK_EVALUATOR=false
TARGET_SCORE=8.0
```

### 新方式（登録時に指定）

```bash
# claude mcp addコマンドで直接指定（絶対パス推奨）
claude mcp add loopsmith \
  --env USE_MOCK_EVALUATOR=false \
  --env TARGET_SCORE=8.0 \
  --env CODEX_SUPPORTS_JSON_FORMAT=false \
  -- node "$(pwd)/mcp-server/dist/server-stdio.js"  # macOS/Linux
  
# Windows PowerShellの場合: -- node "$PWD\mcp-server\dist\server-stdio.js"
```

**注意**: `MCP_PORT`はstdio実装では不要になりました。

## トラブルシューティング

### Q: 旧サーバーが起動したままになっている

A: WebSocketサーバーのプロセスを終了してください:

```bash
# Windows
taskkill /F /IM node.exe

# macOS/Linux
pkill -f "server.js"
```

### Q: ツールが表示されない

A: サーバーが正しく登録されているか確認:

```bash
claude mcp list
# loopsmithが表示されるか確認

# 再登録が必要な場合
claude mcp remove loopsmith
claude mcp add loopsmith -- node "$(pwd)/mcp-server/dist/server-stdio.js"  # macOS/Linux
# Windows: claude mcp add loopsmith -- node "$PWD\mcp-server\dist\server-stdio.js"
```

### Q: エラー「Cannot find module」が発生

A: ビルドが完了しているか確認:

```bash
cd mcp-server
npm run build
```

## 後方互換性

既存のWebSocketサーバーも引き続き利用可能です:

```bash
# レガシー実装の使用（非推奨）
cd mcp-server
npm start  # WebSocketサーバーを起動

# 別ターミナルでClaude Codeを使用
```

ただし、新機能や改善は主にstdio実装に対して行われるため、早期の移行を推奨します。

## サポート

移行に関する問題が発生した場合は、[Issues](https://github.com/yourusername/loopsmith/issues)でご報告ください。