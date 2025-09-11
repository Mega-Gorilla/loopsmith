# LoopSmith - Claude Code × Codex 自動評価システム

Claude CodeとOpenAI Codexを連携させた自動ドキュメント評価・改善ループシステム

## 概要

LoopSmithは、Claude Codeが生成したドキュメントをCodex CLIで自動評価し、品質が目標スコアに達するまで自動的に改善を繰り返すシステムです。MCP (Model Context Protocol) プロトコル準拠のstdioサーバーを実装し、Claude CodeとCodexを統合しています。

**重要**: 本リポジトリは評価API（MCPツール）を提供します。自動改善ループの制御はClaude Code側のシステムプロンプトと会話フローで実行されます。

## 特徴

- 🔄 **自動改善ループ**: Claude Code側で目標スコア（デフォルト8.0/10）達成まで自動的に改善を制御
- 📊 **カスタマイズ可能な評価基準**: 完全性、正確性、明確性、実用性の4つの観点で評価
- 🔧 **プロンプトカスタマイズ**: 評価プロンプトを外部ファイルから読み込み可能
- 📁 **コンテキスト認識評価**: project_pathでプロジェクトファイルを参照した正確な評価
- 🚀 **標準MCPプロトコル準拠**: stdio通信による標準実装
- 🔒 **セキュアな認証**: Codex CLIの独自認証システムを使用
- 📈 **リアルタイム監視**: ダッシュボード機能でブラウザから評価状況を監視可能（MCP起動時に自動起動）

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

# Codex CLIの認証（初回のみ、必要に応じて）
codex login
```

## 使用方法

### クイックスタート（推奨：標準MCPサーバー）

#### 1. セットアップ

```bash
cd mcp-server
npm install

# ダッシュボード機能を使用する場合のみ必要
npm run build
```

**注意**: 
- server-stdio.js自体はJavaScriptファイルのため、基本機能はビルド不要
- ダッシュボード機能（ENABLE_DASHBOARD=true）を使用する場合は、dashboard.tsのビルドが必要

#### 2. Claude CodeへのMCPサーバー登録

**macOS/Linux** (リポジトリルートから実行):

```bash
# 最小設定（絶対パス使用）
claude mcp add loopsmith -- node "$(pwd)/mcp-server/src/server-stdio.js"

# 推奨設定（環境変数込み、ダッシュボード付き）
claude mcp add loopsmith \
  --env USE_MOCK_EVALUATOR=false \
  --env TARGET_SCORE=8.0 \
  --env CODEX_TIMEOUT=300000 \
  --env CODEX_SUPPORTS_JSON_FORMAT=false \
  --env EVALUATION_MODE=flexible \
  --env ENABLE_DASHBOARD=true \
  --env DASHBOARD_PORT=3000 \
  --env AUTO_OPEN_BROWSER=true \
  -- node "$(pwd)/mcp-server/src/server-stdio.js"
```

**Windows PowerShell** (リポジトリルートから実行):

```powershell
# 最小設定（絶対パス使用）
claude mcp add loopsmith -- node "$PWD\mcp-server\src\server-stdio.js"

# 推奨設定（環境変数込み、ダッシュボード付き）
claude mcp add loopsmith `
  --env USE_MOCK_EVALUATOR=false `
  --env TARGET_SCORE=8.0 `
  --env CODEX_TIMEOUT=300000 `
  --env CODEX_SUPPORTS_JSON_FORMAT=false `
  --env EVALUATION_MODE=flexible `
  --env ENABLE_DASHBOARD=true `
  --env DASHBOARD_PORT=3000 `
  --env AUTO_OPEN_BROWSER=true `
  -- node "$PWD\mcp-server\src\server-stdio.js"
```

**注意**: 
- src/server-stdio.jsを直接使用（stdioサーバーはビルド不要）
- ダッシュボード機能を使用する場合は事前にビルドが必要：`npm run build`
- 相対パスではなく絶対パスの使用を推奨します
- `EVALUATION_MODE=flexible`で柔軟な評価モードを有効化
- ダッシュボードはClaude Code起動時に自動的にブラウザで開きます

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

**project_pathパラメータの活用**:
```javascript
// Claude Codeが自動的に現在のプロジェクトパスを渡す場合
evaluate_document({
  content: "ドキュメント内容",
  project_path: process.cwd()  // 自動で設定される
})

// または、特定のプロジェクトを明示的に指定
evaluate_document({
  content: "ドキュメント内容",
  project_path: "/path/to/target/project"
})
```
※ project_path未指定時は、MCPサーバー起動時のカレントディレクトリが使用されます。

**評価パラメータ** (evaluate_documentツール):
- `content` (必須): 評価対象のドキュメント
- `target_score`: 目標スコア (デフォルト: 8.0)
- `project_path`: プロジェクトディレクトリパス（Codexが読み取り専用でアクセス。未指定時はMCPプロセスのCWDを使用）
- `evaluation_mode`: 評価モード ('flexible' | 'strict', デフォルト: 'flexible')
- `weights` (非推奨): 評価基準の重み（0-100の配点）
  - `completeness`: 完全性 (デフォルト: 30)
  - `accuracy`: 正確性 (デフォルト: 30)
  - `clarity`: 明確性 (デフォルト: 20)
  - `usability`: 実用性 (デフォルト: 20)

**評価レスポンス** (柔軟な形式):
必須フィールド:
- `ready_for_implementation`: 実装に移れるか（true/false）
- `score`: 総合評価スコア（0-10）

Codexが自由に追加する可能性のあるフィールド:
- `conclusion`: 結論の詳細説明
- `rationale`: 評価の根拠
- `analysis`: 詳細な分析内容
- `recommendations`: 改善提案や推奨事項
- `blockers`: 実装を妨げる問題
- `technical_notes`: 技術的な注記
- その他、評価内容に応じた情報

**評価モード**:
- **flexible** (推奨): Codexの自然な出力形式を受け入れ、詳細な分析を保持
- **strict**: JSON形式を厳密に要求（後方互換性用）

### ダッシュボード監視

#### 自動起動（デフォルト）

MCPサーバー起動時にダッシュボードが自動的に起動し、ブラウザが開きます：

```bash
# Claude Code登録時にダッシュボード設定を含める
claude mcp add loopsmith \
  --env ENABLE_DASHBOARD=true \
  --env DASHBOARD_PORT=3000 \
  --env AUTO_OPEN_BROWSER=true \
  -- node "$(pwd)/mcp-server/src/server-stdio.js"
```

- **ENABLE_DASHBOARD**: ダッシュボードの自動起動（デフォルト: true）
- **DASHBOARD_PORT**: ダッシュボードのポート（デフォルト: 3000）
- **AUTO_OPEN_BROWSER**: ブラウザの自動起動（デフォルト: true）

ダッシュボードを無効にする場合：
```bash
claude mcp add loopsmith \
  --env ENABLE_DASHBOARD=false \
  -- node "$(pwd)/mcp-server/src/server-stdio.js"
```

#### 手動起動（スタンドアロン）

ダッシュボードのみを起動したい場合：

```bash
cd mcp-server
npm run build
npm run dashboard

# ブラウザでアクセス
# http://localhost:3000
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
| `EVALUATION_MODE` | 評価モード | flexible | flexible: 柔軟な形式, strict: JSON厳密 |
| `EVALUATION_PROMPT_PATH` | 評価プロンプトファイルパス | （未指定） | 未指定時は mcp-server/prompts/evaluation-prompt.txt を自動参照 |
| `CODEX_TIMEOUT` | Codexタイムアウト時間（ミリ秒） | 300000 | 5分（最大30分まで設定可能） |
| `CODEX_MAX_BUFFER` | Codex出力バッファサイズ | 20971520 | |
| `CODEX_SUPPORTS_JSON_FORMAT` | --format jsonオプションのサポート | true | .env.exampleでは互換性のためfalse推奨 |
| `ENABLE_DASHBOARD` | ダッシュボード自動起動 | true | MCPサーバー起動時にダッシュボードを起動 |
| `DASHBOARD_PORT` | ダッシュボードのポート | 3000 | |
| `AUTO_OPEN_BROWSER` | ブラウザ自動起動 | true | ダッシュボード起動時にブラウザを開く |

### プロンプトのカスタマイズ

評価プロンプトは `mcp-server/prompts/evaluation-prompt.txt` を使用します。

プロンプト内では以下の変数が使用可能:
- `{{document_content}}`: 評価対象のドキュメント

柔軟な評価モード（デフォルト）では、Codexが自然な形式で以下を返します:
- 必須: `ready_for_implementation` (実装可否) と `score` (評価スコア)
- 任意: 結論、根拠、分析、推奨事項など、評価に必要と判断した情報

カスタムプロンプトを使用する場合は、`EVALUATION_PROMPT_PATH`環境変数で指定してください。

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