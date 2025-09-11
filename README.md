# LoopSmith - Claude Code × Codex 自動評価システム

Claude CodeとOpenAI Codexを連携させた自動ドキュメント評価・改善ループシステム

## 概要

LoopSmithは、Claude Codeが生成したドキュメントをCodex CLIで自動評価し、品質が目標スコアに達するまで自動的に改善を繰り返すシステムです。MCP (Model Context Protocol) を使用してClaude CodeとCodexを統合しています。

## 特徴

- 🔄 **自動改善ループ**: 目標スコア（デフォルト8.0/10）達成まで自動的に改善
- 📊 **カスタマイズ可能な評価基準**: 完全性、正確性、明確性、実用性の4つの観点で評価
- 🔧 **プロンプトカスタマイズ**: 評価プロンプトを外部ファイルから読み込み可能
- 🌐 **WebSocket通信**: MCPプロトコル準拠のWebSocketサーバー
- 🔒 **セキュアな認証**: Codex CLIの独自認証システムを使用

## 必要要件

- Node.js v18以上
- npm
- OpenAI Codex CLI (`npm install -g @openai/codex`)
- Claude Code

## インストール

```bash
# リポジトリのクローン
git clone https://github.com/yourusername/loopsmith.git
cd loopsmith

# 依存関係のインストール
cd mcp-server
npm install

# 環境設定ファイルの作成
cp .env.example .env
# .envファイルを編集して設定を調整

# Codex CLIの認証（初回のみ）
codex login
```

## 使用方法

### 1. MCPサーバーの起動

```bash
cd mcp-server
npm run build
npm start
```

### 2. Claude Codeでの接続

Claude Code内で以下のコマンドを実行:

```
> /ide
# "codex-evaluator" を選択

> /tools
# evaluate_documentツールが利用可能なことを確認
```

### 3. 自動評価の実行

```
> 以下の内容でドキュメントを作成し、スコア8.0以上になるまで自動改善してください:
「APIリファレンスドキュメント」
```

## 設定

### 環境変数 (.env)

| 変数名 | 説明 | デフォルト値 |
|--------|------|--------------|
| `MCP_PORT` | MCPサーバーのポート | 23100 |
| `LOG_LEVEL` | ログレベル | info |
| `MAX_ITERATIONS` | 最大改善回数 | 5 |
| `TARGET_SCORE` | 目標スコア | 8.0 |
| `EVALUATION_PROMPT_PATH` | 評価プロンプトファイルパス | ../prompts/evaluation-prompt.txt |
| `CODEX_TIMEOUT` | Codexタイムアウト時間（ミリ秒） | 120000 |

### プロンプトのカスタマイズ

評価プロンプトは `mcp-server/prompts/` ディレクトリ内のテキストファイルで管理されています:

- `evaluation-prompt.txt`: 日本語プロンプト
- `evaluation-prompt-en.txt`: 英語プロンプト

プロンプト内では以下の変数が使用可能:
- `{{completeness_weight}}`: 完全性の重み（%）
- `{{accuracy_weight}}`: 正確性の重み（%）
- `{{clarity_weight}}`: 明確性の重み（%）
- `{{usability_weight}}`: 実用性の重み（%）
- `{{document_content}}`: 評価対象のドキュメント

## 開発

### ビルド

```bash
cd mcp-server
npm run build
```

### 開発モード

```bash
cd mcp-server
npm run dev
```

### テスト

```bash
cd mcp-server
npm test
```

### 統合テスト

```bash
cd mcp-server
node scripts/test-integration.js
```

## プロジェクト構造

```
loopsmith/
├── mcp-server/           # MCPサーバー実装
│   ├── src/             # TypeScriptソースコード
│   ├── prompts/         # 評価プロンプトテンプレート
│   ├── scripts/         # テストスクリプト
│   └── dist/            # ビルド出力
├── docs/                # ドキュメント
└── implementation-guide.md # 実装ガイド
```

## トラブルシューティング

### Codex CLIが見つからない

```bash
npm install -g @openai/codex
codex --version
```

### ポートが使用中

`.env`ファイルで`MCP_PORT`を変更:

```
MCP_PORT=23101
```

### 認証エラー

Codex CLIの再認証:

```bash
codex logout
codex login
```

## ライセンス

MIT License

## 貢献

プルリクエストを歓迎します。大きな変更の場合は、まずissueを開いて変更内容を議論してください。

## サポート

問題が発生した場合は、[Issues](https://github.com/yourusername/loopsmith/issues)でご報告ください。