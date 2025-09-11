# LoopSmith - Claude Code × Codex 自動評価システム

Claude CodeとOpenAI Codexを連携させた自動ドキュメント評価・改善ループシステム

## 概要

LoopSmithは、Claude Codeが生成したドキュメントをCodex CLIで自動評価し、品質が目標スコアに達するまで自動的に改善を繰り返すシステムです。MCP (Model Context Protocol) プロトコル準拠の独自WebSocketサーバーを実装し、Claude CodeとCodexを統合しています。

**重要**: 本リポジトリは評価API（MCPツール）を提供します。自動改善ループの制御はClaude Code側のシステムプロンプトと会話フローで実行されます。

## 特徴

- 🔄 **自動改善ループ**: Claude Code側で目標スコア（デフォルト8.0/10）達成まで自動的に改善を制御
- 📊 **カスタマイズ可能な評価基準**: 完全性、正確性、明確性、実用性の4つの観点で評価
- 🔧 **プロンプトカスタマイズ**: 評価プロンプトを外部ファイルから読み込み可能
- 🌐 **WebSocket通信**: MCPプロトコル準拠の独自実装によるWebSocketサーバー
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

### 1. MCPサーバーの起動

```bash
cd mcp-server
npm run build
npm start
```

### 2. Claude CodeへのMCPサーバー登録

プロジェクトディレクトリで以下のコマンドを実行:

```bash
# ローカルスコープで登録（推奨）
claude mcp add codex-evaluator --env MCP_PORT=23100 -- node mcp-server/dist/server.js

# または、プロジェクトスコープで登録（チーム共有用）
claude mcp add --scope project codex-evaluator --env MCP_PORT=23100 -- node mcp-server/dist/server.js
```

### 3. 接続確認

```bash
# 登録済みMCPサーバーの確認
claude mcp list

# Claude Code内で確認
> /mcp
# codex-evaluatorが表示されることを確認

> /tools
# evaluate_documentツールが利用可能なことを確認
```

### 4. 自動評価の実行

```
> 以下の内容でドキュメントを作成し、スコア8.0以上になるまで自動改善してください:
「APIリファレンスドキュメント」
```

**注意**: 評価結果には`pass`フィールドは含まれません。合格判定は `score >= target_score` で行ってください。

### 5. ダッシュボード監視（オプション）

リアルタイムで評価状況を監視したい場合：

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

### 環境変数 (.env)

| 変数名 | 説明 | デフォルト値 | 備考 |
|--------|------|--------------|------|
| `MCP_PORT` | MCPサーバーのポート | 23100 | |
| `LOG_LEVEL` | ログレベル | info | |
| `MAX_ITERATIONS` | 最大改善回数 | 5 | **現在サーバー側未使用**（将来拡張用） |
| `USE_MOCK_EVALUATOR` | モック評価器を使用 | false | |
| `TARGET_SCORE` | 目標スコア | 8.0 | |
| `EVALUATION_PROMPT_PATH` | 評価プロンプトファイルパス | ../prompts/evaluation-prompt.txt | |
| `CODEX_TIMEOUT` | Codexタイムアウト時間（ミリ秒） | 300000 | 5分（最大30分まで設定可能） |
| `CODEX_MAX_BUFFER` | Codex出力バッファサイズ | 20971520 | |
| `CODEX_SUPPORTS_JSON_FORMAT` | --format jsonオプションのサポート | true | .env.exampleでは互換性のためfalse推奨 |
| `DASHBOARD_PORT` | ダッシュボードのポート | 3000 | start:integrated使用時 |

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
├── mcp-server/              # MCPサーバー実装
│   ├── src/                # TypeScriptソースコード
│   │   ├── server.ts       # MCPサーバー本体
│   │   ├── server-with-dashboard.ts # 統合サーバー（MCP + ダッシュボード）
│   │   ├── dashboard.ts    # ダッシュボードサーバー
│   │   ├── codex-evaluator.ts      # Codex評価器
│   │   └── codex-evaluator-mock.ts # モック評価器
│   ├── public/             # ダッシュボードWeb UI
│   ├── prompts/            # 評価プロンプトテンプレート（ルートに移動）
│   ├── scripts/            # テスト/セットアップスクリプト
│   └── dist/               # ビルド出力 (ギット無視)
├── prompts/                # 評価プロンプトテンプレート
├── docs/                   # ドキュメント
│   └── architecture.md     # アーキテクチャ設計書
├── README.md               # このファイル
└── LICENSE                 # MITライセンス
```

**注意**: 本プロジェクトはCommonJS形式で実装されています。

## アーキテクチャ

詳細なアーキテクチャ図とシーケンス図は[docs/architecture.md](docs/architecture.md)を参照してください。

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