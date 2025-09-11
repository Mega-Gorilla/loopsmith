# LoopSmith - Claude Code × Codex 自動評価システム

Claude CodeとOpenAI Codexを連携させた自動ドキュメント評価・改善ループシステム

## 概要

LoopSmithは、Claude Codeが生成したドキュメントをCodex CLIで自動評価し、品質が目標スコアに達するまで自動的に改善を繰り返すシステムです。MCP (Model Context Protocol) プロトコル準拠の独自WebSocketサーバーを実装し、Claude CodeとCodexを統合しています。

**重要**: 本リポジトリは評価API（MCPツール）を提供します。自動改善ループの制御はClaude Code側のシステムプロンプトと会話フローで実行されます。

## 特徴

- 🔄 **自動改善ループ**: Claude Code側で目標スコア（デフォルト8.0/10）達成まで自動的に改善を制御
- 📊 **カスタマイズ可能な評価基準**: 完全性、正確性、明確性、実用性の4つの観点で評価
- 🔧 **プロンプトカスタマイズ**: 評価プロンプトを外部ファイルから読み込み可能
- 🚀 **標準MCPプロトコル準拠**: stdio通信による標準実装（v2.0）
- 🌐 **レガシーWebSocket対応**: 後方互換性のためWebSocketサーバーも提供
- 🔒 **セキュアな認証**: Codex CLIの独自認証システムを使用
- 📈 **リアルタイム監視**: ダッシュボード機能でブラウザから評価状況を監視可能（オプション）

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
# Windows:
copy mcp-server\.env.example mcp-server\.env

# macOS/Linux:
cp mcp-server/.env.example mcp-server/.env

# .envファイルを編集して設定を調整

# Codex CLIの認証（初回のみ、必要に応じて）
codex login
```

## 使用方法

### クイックスタート（推奨：標準MCPサーバー）

#### 1. ビルドとセットアップ

```bash
cd mcp-server
npm install
npm run build
```

#### 2. Claude CodeへのMCPサーバー登録

**macOS/Linux** (リポジトリルートから実行):

```bash
# 最小設定（絶対パス使用）
claude mcp add loopsmith -- node "$(pwd)/mcp-server/dist/server-stdio.js"

# 推奨設定（環境変数込み）
claude mcp add loopsmith \
  --env USE_MOCK_EVALUATOR=false \
  --env TARGET_SCORE=8.0 \
  --env CODEX_TIMEOUT=300000 \
  --env CODEX_SUPPORTS_JSON_FORMAT=false \
  -- node "$(pwd)/mcp-server/dist/server-stdio.js"
```

**Windows PowerShell** (リポジトリルートから実行):

```powershell
# 最小設定（絶対パス使用）
claude mcp add loopsmith -- node "$PWD\mcp-server\dist\server-stdio.js"

# 推奨設定（環境変数込み）
claude mcp add loopsmith `
  --env USE_MOCK_EVALUATOR=false `
  --env TARGET_SCORE=8.0 `
  --env CODEX_TIMEOUT=300000 `
  --env CODEX_SUPPORTS_JSON_FORMAT=false `
  -- node "$PWD\mcp-server\dist\server-stdio.js"
```

**注意**: 
- ビルド（`npm run build`）実行後にdist/server-stdio.jsが生成されます
- 相対パスではなく絶対パスの使用を推奨します
- `CODEX_SUPPORTS_JSON_FORMAT=false`は互換性のため推奨

#### 3. 接続確認

```bash
# 登録済みMCPサーバーの確認
claude mcp list

# Claude Code内で確認
> /mcp
# loopsmithが表示されることを確認

> /tools
# evaluate_documentツールが利用可能なことを確認
```

#### 4. 自動評価の実行

Claude Code内で以下のコマンドを実行:

```
> 以下の内容でドキュメントを作成し、スコア8.0以上になるまで自動改善してください:
「APIリファレンスドキュメント」
```

**評価パラメータ** (evaluate_documentツール):
- `content` (必須): 評価対象のドキュメント
- `weights` (推奨): 評価基準の重み
  - `completeness`: 完全性の重み (0-100, デフォルト: 30)
  - `accuracy`: 正確性の重み (0-100, デフォルト: 30)
  - `clarity`: 明確性の重み (0-100, デフォルト: 20)
  - `usability`: 実用性の重み (0-100, デフォルト: 20)
- `target_score`: 目標スコア (デフォルト: 8.0)
- `rubric` (非推奨): 旧評価基準フォーマット

**注意**: 評価結果の`pass`フィールドはオプションです。合格判定は `score >= target_score` で行ってください。

### ダッシュボード監視（オプション）

リアルタイムで評価状況を監視したい場合（WebSocketサーバーとは独立動作）：

```bash
# 統合サーバーの起動（MCPサーバー + ダッシュボード）
cd mcp-server
npm run build
npm run start:integrated

# ブラウザでアクセス
# http://localhost:3000 （デフォルト）
# DASHBOARD_PORTで変更可能
```

## 設定

### 環境変数

環境変数はClaude Codeへの登録時に`--env`オプションで指定するか、`.env`ファイルで設定できます。

| 変数名 | 説明 | デフォルト値 | 備考 |
|--------|------|--------------|------|
| `MCP_PORT` | WebSocketサーバーのポート | 23100 | レガシー実装のみ |
| `LOG_LEVEL` | ログレベル | info | |
| `MAX_ITERATIONS` | 最大改善回数 | 5 | **現在サーバー側未使用**（将来拡張用） |
| `USE_MOCK_EVALUATOR` | モック評価器を使用 | false | |
| `TARGET_SCORE` | 目標スコア | 8.0 | |
| `EVALUATION_PROMPT_PATH` | 評価プロンプトファイルパス | （未指定） | 既定: mcp-server/prompts/evaluation-prompt.txt |
| `CODEX_TIMEOUT` | Codexタイムアウト時間（ミリ秒） | 300000 | 5分（最大30分まで設定可能） |
| `CODEX_MAX_BUFFER` | Codex出力バッファサイズ | 20971520 | |
| `CODEX_SUPPORTS_JSON_FORMAT` | --format jsonオプションのサポート | true | .env.exampleでは互換性のためfalse推奨 |
| `DASHBOARD_PORT` | ダッシュボードのポート | 3000 | start:integrated使用時 |

### プロンプトのカスタマイズ

評価プロンプトは既定で `mcp-server/prompts/` ディレクトリ内のテキストファイルを使用します。必要に応じて`EVALUATION_PROMPT_PATH`環境変数で上書き可能:

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
# 標準stdioサーバー開発モード
npm run dev:stdio

# レガシーWebSocketサーバー開発モード
npm run dev
```

### テスト

```bash
cd mcp-server
# stdioサーバーテスト
npm run test:stdio

# WebSocketサーバーテスト
npm test
```

## プロジェクト構造

```
loopsmith/
├── mcp-server/              # MCPサーバー実装
│   ├── src/                # TypeScriptソースコード
│   │   ├── server-stdio.js # 標準MCPサーバー（stdio、推奨）
│   │   ├── server.ts       # レガシーWebSocketサーバー
│   │   ├── server-with-dashboard.ts # 統合サーバー（MCP + ダッシュボード）
│   │   ├── dashboard.ts    # ダッシュボードサーバー
│   │   ├── codex-evaluator.ts      # Codex評価器
│   │   └── codex-evaluator-mock.ts # モック評価器
│   ├── public/             # ダッシュボードWeb UI
│   ├── prompts/            # 評価プロンプトテンプレート（デフォルト）
│   ├── scripts/            # テスト/セットアップスクリプト
│   └── dist/               # ビルド出力 (ギット無視)
├── prompts/                # 追加評価プロンプトテンプレート（任意）
├── docs/                   # ドキュメント
│   ├── architecture.md     # アーキテクチャ設計書
│   ├── mcp-implementation-analysis.md # MCP実装分析
│   ├── migration-guide.md  # 移行ガイド
│   └── esm-migration-guide.md # ESM移行ガイド
├── README.md               # このファイル
└── LICENSE                 # MITライセンス
```

**アーキテクチャ**:
- **v2.0**: 標準MCPプロトコル準拠のstdio実装（推奨）
- **v1.0**: WebSocketベースの独自実装（レガシー）
- 詳細は[docs/mcp-implementation-analysis.md](docs/mcp-implementation-analysis.md)を参照

## アーキテクチャ

詳細なアーキテクチャ図とシーケンス図は[docs/architecture.md](docs/architecture.md)を参照してください。

MCP実装の詳細分析は[docs/mcp-implementation-analysis.md](docs/mcp-implementation-analysis.md)を参照してください。

WebSocketからstdioへの移行ガイドは[docs/migration-guide.md](docs/migration-guide.md)を参照してください。

### 基本的な動作フロー

1. **ドキュメント生成**: Claude Codeがユーザーのプロンプトからドキュメントを生成
2. **評価要求**: MCPツール（evaluate_document）を通じて評価を要求
3. **Codex実行**: Codex CLIがドキュメントを評価し、スコアと改善提案を返却
4. **改善ループ**: スコアが目標値（8.0）未満の場合、自動的に改善を適用
5. **完了**: 目標達成または最大反復回数（5回）で終了

## トラブルシューティング

### Codex CLIが見つからない

```bash
npm install -g @openai/codex
codex --version
```

### ポートが使用中（レガシーWebSocket実装のみ）

`.env`ファイルで`MCP_PORT`を変更:

```
MCP_PORT=23101
```

**注意**: この問題は標準stdio実装では発生しません。

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