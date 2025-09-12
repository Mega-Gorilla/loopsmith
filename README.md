# LoopSmith - Claude Code × Codex 自動評価システム

Claude CodeとOpenAI Codexを連携させた自動ドキュメント評価・改善ループシステム

## 概要

LoopSmithは、Claude Codeが生成したドキュメントをCodex CLIで自動評価し、品質が目標スコアに達するまで自動的に改善を繰り返すシステムです。MCP (Model Context Protocol) プロトコル準拠のstdioサーバーを実装し、Claude CodeとCodexを統合しています。

**重要**: 本リポジトリは評価API（MCPツール）を提供します。自動改善ループの制御はClaude Code側のシステムプロンプトと会話フローで実行されます。

## 🚀 クイックスタート

### 基本的な使用例

Claude Code内で`evaluate_document`ツールを使用してドキュメントを評価:

```
# 基本的な評価
/tool evaluate_document document_path="/path/to/your/document.md" target_score=8.0
```

### プロジェクトコンテキスト付き評価

プロジェクト全体のコンテキストを考慮した高精度な評価:

```
# プロジェクトファイルを参照しながら評価
/tool evaluate_document document_path="/path/to/api-reference.md" project_path="/path/to/project" target_score=9.0
```

### 評価モードの指定

厳密なJSON形式での評価結果を要求:

```
# strict モードで評価（JSON形式を厳密に要求）
/tool evaluate_document document_path="/path/to/user-guide.md" evaluation_mode="strict"
```

### 自動改善ループの実行

Claude Codeに自動改善を依頼:

```
以下のドキュメントを評価し、スコア8.0以上になるまで改善してください:
/path/to/document.md
```

## 特徴

- 🔄 **自動改善ループ**: Claude Code側で目標スコア（デフォルト8.0/10）達成まで自動的に改善を制御
- 📊 **カスタマイズ可能な評価基準**: 完全性、正確性、明確性、実用性の4つの観点で評価
- 🔧 **プロンプトカスタマイズ**: 評価プロンプトを外部ファイルから読み込み可能
- 📁 **コンテキスト認識評価**: project_pathでプロジェクトファイルを参照した正確な評価
- 🚀 **標準MCPプロトコル準拠**: stdio通信による標準実装
- 🔒 **セキュアな認証**: Codex CLIの独自認証システムを使用
- 📈 **リアルタイム監視**: ダッシュボード機能でブラウザから評価状況を監視可能（MCP起動時に自動起動）

## 必要要件

- Node.js v18以上（推奨: v20.x LTS）
- npm v9以上
- OpenAI Codex CLI (`npm install -g @openai/codex`)
- Claude Code（デスクトップ版）

### Claude Codeのセットアップ

1. **Claude Codeのインストール**
   - [Claude Code公式サイト](https://claude.ai/code)からダウンロード
   - 対応OS: Windows 10+, macOS 12+, Ubuntu 20.04+

2. **MCPツールの有効化**
   - Claude Code起動後、設定でMCPを有効化
   - `claude_desktop_config.json`が自動生成される

## インストール

```bash
# リポジトリのクローン
git clone https://github.com/yourusername/loopsmith.git
cd loopsmith
# または、既存のローカルディレクトリを使用
# cd /path/to/loopsmith

# 依存関係のインストールとビルド
cd mcp-server
npm install
npm run build  # 重要：必須のビルドステップ

# Codex CLIの認証（初回のみ、必要に応じて）
codex login
```

## 使用方法

### クイックスタート（推奨：標準MCPサーバー）

#### 1. セットアップ

```bash
cd mcp-server
npm install

# 重要: 必ずビルドを実行してください
npm run build
```

**重要な注意事項**: 
- **ビルドは必須です**: server-stdio.jsは`dist/codex-evaluator.js`をrequireするため、ダッシュボードの使用有無にかかわらずビルドが必要
- ダッシュボード機能（ENABLE_DASHBOARD=true）を使用する場合は、`dist/dashboard.js`も必要
- ビルドを忘れると`Cannot find module '../dist/codex-evaluator'`エラーが発生します

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
  --env ENABLE_DASHBOARD=true `
  --env DASHBOARD_PORT=3000 `
  --env AUTO_OPEN_BROWSER=true `
  -- node "$PWD\mcp-server\src\server-stdio.js"
```

**注意**: 
- ビルドは必須です：`npm run build`（server-stdio.jsがdist/codex-evaluator.jsをrequireするため）
- 相対パスではなく絶対パスの使用を推奨します
- ダッシュボードはClaude Code起動時に自動的にブラウザで開きます
- ダッシュボードはDASHBOARD_PORTで指定したポートで自動的に起動します

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

Claude Code内での使用例:

```
# ドキュメントを評価
> /tool evaluate_document document_path="/path/to/your/document.md" target_score=8.0

# プロジェクトコンテキストを含めた評価
> /tool evaluate_document document_path="/path/to/doc.md" project_path="/path/to/project" target_score=8.0
```

または、自動改善ループの実行:

```
> 以下のドキュメントを評価し、スコア8.0以上になるまで改善してください:
/path/to/document.md
```

**project_pathパラメータの活用**:
```javascript
// Claude Codeが自動的に現在のプロジェクトパスを渡す場合
evaluate_document({
  document_path: "/path/to/document.md",
  project_path: process.cwd()  // 自動で設定される
})

// または、特定のプロジェクトを明示的に指定
evaluate_document({
  document_path: "/path/to/document.md",
  project_path: "/path/to/target/project"
})
```
※ project_path未指定時は、MCPサーバー起動時のカレントディレクトリが使用されます。

**評価パラメータ** (evaluate_documentツール):
- `document_path` (必須): 評価対象ドキュメントのファイルパス
- `target_score`: 目標スコア (デフォルト: 8.0)
- `project_path`: プロジェクトディレクトリパス（Codexが読み取り専用でアクセス。未指定時はMCPプロセスのCWDを使用）
- `evaluation_mode`: 評価モード ('flexible' | 'strict', デフォルト: 'flexible')

**評価レスポンス** (柔軟な形式):
必須フィールド:
- `score`: 総合評価スコア（0-10）
- `pass`: 目標スコアを達成したか（true/false）
- `summary`: 評価の要約
- `status`: 評価ステータス（excellent/good/needs_improvement/poor）

オプションフィールド:
- `details`: 詳細情報オブジェクト
  - `strengths`: 強み・良い点の配列
  - `issues`: 問題点・課題の配列
  - `improvements`: 改善提案の配列
  - `context_specific`: コンテキスト固有の情報

### 評価レスポンス例

**成功時のレスポンス例**:
```json
{
  "score": 8.4,
  "pass": true,
  "summary": "ドキュメントは実装着手に十分な品質です",
  "status": "excellent",
  "details": {
    "strengths": [
      "目的と範囲が明確",
      "セットアップ手順が具体的"
    ],
    "issues": [],
    "improvements": [
      "エラー処理の詳細を追加"
    ]
  }
}
```

**失敗時のレスポンス例**:
```json
{
  "score": 7.2,
  "pass": false,
  "summary": "重要な情報が不足しています",
  "status": "needs_improvement",
  "details": {
    "issues": [
      "認証手順が不明確",
      "エラー処理の記載なし"
    ],
    "improvements": [
      "認証フローの図を追加",
      "トラブルシューティングセクションを拡充"
    ]
  }
}
```

**評価モード**:
- **flexible** (推奨): Codexの自然な出力形式を受け入れ、詳細な分析を保持
- **strict**: JSON形式を厳密に要求（後方互換性用）

### ダッシュボード監視

#### 自動起動（デフォルト）

MCPサーバー起動時にダッシュボードが自動的に起動し、ブラウザが開きます：

**注意**: ダッシュボードは指定された`DASHBOARD_PORT`で動作します。ポートを変更した場合、ブラウザで正しいURLにアクセスしてください。

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
| **基本設定** | | | |
| `MCP_PORT` | WebSocketサーバーのポート | 23100 | stdioモードでは未使用 |
| `LOG_LEVEL` | ログレベル | info | debug, info, warn, error |
| `MCP_OUTPUT_FORMAT` | 出力フォーマット | markdown | markdown または json |
| **評価設定** | | | |
| `USE_MOCK_EVALUATOR` | モック評価器を使用 | false | テスト用 |
| `TARGET_SCORE` | 目標スコア | 8.0 | 1.0〜10.0 |
| `EVALUATION_MODE` | 評価モード | flexible | flexible または strict |
| `EVALUATION_PROMPT_PATH` | 評価プロンプトファイルパス | 自動検索 | カスタムプロンプト使用時に指定 |
| **Codex設定** | | | |
| `CODEX_TIMEOUT` | Codexタイムアウト時間（ミリ秒） | 300000 | 5分（最大30分: 1800000） |
| `CODEX_MAX_BUFFER` | Codex出力バッファサイズ（バイト） | 20971520 | 20MB |
| `CODEX_CACHE_ENABLED` | キャッシュ機能の有効化 | false | 明示的に有効化する場合のみtrue |
| `CODEX_CACHE_TTL` | キャッシュ有効期限（ミリ秒） | 3600000 | 1時間 |
| **ダッシュボード設定** | | | |
| `ENABLE_DASHBOARD` | ダッシュボード自動起動 | true | MCPサーバー起動時に起動 |
| `DASHBOARD_PORT` | ダッシュボードのポート | 3000 | |
| `AUTO_OPEN_BROWSER` | ブラウザ自動起動 | true | ダッシュボード起動時 |

### プロンプトのカスタマイズ

評価プロンプトは `mcp-server/prompts/evaluation-prompt-filepath.txt` を使用します。

プロンプト内では以下の変数が使用可能:
- `{{document_path}}`: 評価対象ドキュメントのファイルパス

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
│   └── architecture.md     # アーキテクチャ設計書
├── README.md               # このファイル
└── LICENSE                 # MITライセンス
```

**アーキテクチャ**:
- **v2.0**: 標準MCPプロトコル準拠のstdio実装（推奨）
- **v1.0**: WebSocketベースの独自実装（レガシー）

## アーキテクチャ

詳細なアーキテクチャ図とシーケンス図は[docs/architecture.md](docs/architecture.md)を参照してください。

### 基本的な動作フロー

1. **ドキュメント生成**: Claude Codeがユーザーのプロンプトからドキュメントを生成
2. **評価要求**: MCPツール（evaluate_document）を通じて評価を要求
3. **Codex実行**: Codex CLIがドキュメントを評価し、スコアと改善提案を返却
4. **改善ループ**: スコアが目標値（8.0）未満の場合、自動的に改善を適用
5. **完了**: 目標達成または最大反復回数（5回）で終了

## トラブルシューティング

### よくある問題と解決方法

#### ビルドエラー: `Cannot find module '../dist/codex-evaluator'`

```bash
cd mcp-server
npm run build  # 必須: distディレクトリを生成
```

#### Codex CLIが見つからない

```bash
# インストール確認
npm list -g @openai/codex

# 再インストール
npm install -g @openai/codex

# バージョン確認
codex --version

# 認証状態確認
codex whoami
```

#### 認証エラー

```bash
# 認証状態確認
codex whoami

# 再認証
codex logout
codex login
```

#### タイムアウトエラー

大きなドキュメントや複雑な評価の場合:

```bash
# タイムアウトを10分に延長
claude mcp add loopsmith \
  --env CODEX_TIMEOUT=600000 \
  -- node "$(pwd)/mcp-server/src/server-stdio.js"
```

#### バッファサイズ超過

大規模な出力の場合:

```bash
# バッファサイズを50MBに拡大
claude mcp add loopsmith \
  --env CODEX_MAX_BUFFER=52428800 \
  -- node "$(pwd)/mcp-server/src/server-stdio.js"
```

#### ダッシュボードが起動しない

```bash
# ダッシュボードのヘルスチェック
curl http://localhost:3000/health

# ポート競合の確認（Windows）
netstat -an | findstr 3000

# ポート競合の確認（macOS/Linux）
lsof -i :3000

# 別ポートで起動
claude mcp add loopsmith \
  --env DASHBOARD_PORT=3001 \
  -- node "$(pwd)/mcp-server/src/server-stdio.js"
```

#### Windows PowerShellの実行ポリシーエラー

```powershell
# 実行ポリシーの確認
Get-ExecutionPolicy

# 実行ポリシーの変更（管理者権限で実行）
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### ログファイルの確認

MCPサーバーのログは以下に出力されます:

```bash
# stdioサーバーのログ
tail -f mcp-server/mcp-server-stdio.log

# ダッシュボードのログ
tail -f mcp-server/dashboard.log
```

## ライセンス

MIT License

## 貢献

プルリクエストを歓迎します。大きな変更の場合は、まずissueを開いて変更内容を議論してください。

## サポート

問題が発生した場合は、[Issues](https://github.com/yourusername/loopsmith/issues)でご報告ください。

## 既知の制限事項

- **Codex CLIの`--dangerously-bypass-approvals-and-sandboxes`フラグ使用**: セキュリティ上の理由から、信頼できる環境でのみ使用してください
- **大規模ファイルの評価**: 20MBを超えるファイルはバッファサイズの調整が必要（`CODEX_MAX_BUFFER`環境変数）
- **Windows環境での注意**: PowerShellの実行ポリシー設定が必要な場合があります（`Set-ExecutionPolicy RemoteSigned`）