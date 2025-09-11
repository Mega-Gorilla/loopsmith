# Codexの自動化とGitHub Actions連携ガイド

## 目次
1. [OpenAI Codexとは](#openai-codexとは)
2. [2025年の最新アップデート](#2025年の最新アップデート)
3. [Codexの自動化方法](#codexの自動化方法)
4. [GitHub Actionsとの連携](#github-actionsとの連携)
5. [実装例](#実装例)
6. [ベストプラクティス](#ベストプラクティス)

## OpenAI Codexとは

OpenAI Codexは、ソフトウェアエンジニアリングタスクを自動化するAIエージェントです。2025年現在、従来のプロンプト入力による対話型インターフェースから、より高度な自動化機能を持つクラウドベースのエージェントへと進化しています。

### 主な特徴
- **並列タスク処理**: 複数のタスクを同時に実行可能
- **言語サポート**: Python、JavaScript、TypeScript、Go、Ruby、Rustなど12以上の言語に対応
- **統合開発環境**: VS Code、ターミナル、GitHub との直接統合

## 2025年の最新アップデート

### Codex-1の導入
- OpenAI o3をソフトウェアエンジニアリング向けに最適化したcodex-1を搭載
- GPT-5のエージェント的コーディング機能を活用
- 非同期実行とステート管理の改善

### 利用可能プラン
- ChatGPT Plus、Pro、Business、Enterprise、Eduユーザー向けに提供
- 2025年6月よりPlusユーザーにも開放

## Codexの自動化方法

### 1. Codex CLI（コマンドラインインターフェース）

#### インストール方法
```bash
# npmを使用したグローバルインストール
npm install -g @openai/codex

# または、GitHubリリースからバイナリをダウンロード
```

#### 基本的な使用方法
```bash
# プロジェクトディレクトリで実行
codex init

# 対話モードでタスクを実行
codex "リファクタリングタスクを実行"

# 完全自動モードでタスクを実行
codex exec --full-auto "テストを作成"

# 承認モードの選択
codex --approve=suggest  # 提案モード
codex --approve=auto     # 自動編集モード
codex exec --full-auto    # フルオートモード
```

### 2. プログラマティックな自動化

#### Python例
```python
import subprocess
import json

def execute_codex_task(task_description, project_path):
    """Codexタスクを自動実行する関数"""
    cmd = [
        "codex",
        "exec",
        "--full-auto",  # 完全自動モード
        "--json",  # JSON形式で結果を出力
        f"--project={project_path}",
        task_description
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(result.stdout)

# 使用例
task = "すべてのテストファイルにドキュメントを追加"
result = execute_codex_task(task, "/path/to/project")
```

#### JavaScript/Node.js例
```javascript
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function runCodexTask(task, options = {}) {
    const command = `codex exec --full-auto "${task}" ${options.verbose ? '--verbose' : ''}`;
    
    try {
        const { stdout, stderr } = await execPromise(command);
        return { success: true, output: stdout };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// 使用例
(async () => {
    const result = await runCodexTask("バグを修正してPRを作成");
    console.log(result);
})();
```

## GitHub Actionsとの連携

### 1. 基本的なワークフロー設定

`.github/workflows/codex-automation.yml`:

```yaml
name: Codex自動化ワークフロー

on:
  # 手動トリガー
  workflow_dispatch:
    inputs:
      task:
        description: '実行するCodexタスク'
        required: true
        type: string
  
  # PRへのコメントでトリガー
  issue_comment:
    types: [created]
  
  # 定期実行
  schedule:
    - cron: '0 2 * * *'  # 毎日午前2時

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  codex-task:
    runs-on: ubuntu-latest
    
    steps:
      - name: リポジトリをチェックアウト
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Node.jsセットアップ
        uses: actions/setup-node@v4
        with:
          node-version: '22'
      
      - name: Codex CLIインストール
        run: npm install -g @openai/codex
      
      - name: Codex認証
        env:
          CODEX_API_KEY: ${{ secrets.CODEX_API_KEY }}
        run: |
          codex auth --api-key $CODEX_API_KEY
      
      - name: Codexタスク実行
        id: codex-run
        run: |
          if [[ "${{ github.event_name }}" == "workflow_dispatch" ]]; then
            codex exec --full-auto "${{ github.event.inputs.task }}"
          elif [[ "${{ github.event_name }}" == "issue_comment" ]]; then
            # @codexメンションをチェック
            if [[ "${{ github.event.comment.body }}" == *"@codex"* ]]; then
              TASK=$(echo "${{ github.event.comment.body }}" | sed 's/@codex //')
              codex exec --full-auto "$TASK"
            fi
          else
            # 定期実行タスク
            codex exec --full-auto "コードベースの品質チェックと改善提案"
          fi
      
      - name: PR作成
        if: success()
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          git config user.name "Codex Bot"
          git config user.email "codex@example.com"
          
          BRANCH="codex-updates-$(date +%Y%m%d-%H%M%S)"
          git checkout -b $BRANCH
          git add .
          git commit -m "Codex: 自動改善とリファクタリング"
          git push origin $BRANCH
          
          gh pr create \
            --title "🤖 Codex: 自動改善" \
            --body "Codexによる自動改善が実行されました。" \
            --base main
```

### 2. Jira連携の自動化例

```yaml
name: Jira-GitHub-Codex統合

on:
  workflow_dispatch:
    inputs:
      jira_key:
        description: 'JIRAイシューキー (例: PROJ-123)'
        required: true
      jira_summary:
        description: 'イシューの概要'
        required: true
      jira_description:
        description: 'イシューの詳細'
        required: true

jobs:
  create-pr-from-jira:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Codexセットアップ
        run: |
          npm install -g @openai/codex
          codex auth --api-key ${{ secrets.CODEX_API_KEY }}
      
      - name: ブランチ作成
        run: |
          git checkout -b feature/${{ github.event.inputs.jira_key }}
      
      - name: Codexでコード生成
        run: |
          codex exec --full-auto "以下の要件に基づいて実装を作成: 
            タイトル: ${{ github.event.inputs.jira_summary }}
            詳細: ${{ github.event.inputs.jira_description }}"
      
      - name: テスト実行
        run: |
          codex exec --full-auto "作成したコードのテストを書いて実行"
      
      - name: コミットとPR作成
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          git add .
          git commit -m "${{ github.event.inputs.jira_key }}: ${{ github.event.inputs.jira_summary }}"
          git push origin feature/${{ github.event.inputs.jira_key }}
          
          gh pr create \
            --title "${{ github.event.inputs.jira_key }}: ${{ github.event.inputs.jira_summary }}" \
            --body "## 概要\n${{ github.event.inputs.jira_description }}\n\n## JIRAリンク\n[JIRA Issue](${{ github.event.inputs.jira_key }})"
```

## 実装例

### 1. コードレビュー自動化

```yaml
name: 自動コードレビュー

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  code-review:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Codexレビュー実行
        id: review
        run: |
          npm install -g @openai/codex
          codex auth --api-key ${{ secrets.CODEX_API_KEY }}
          
          REVIEW_OUTPUT=$(codex review --pr ${{ github.event.pull_request.number }})
          echo "review_output<<EOF" >> $GITHUB_OUTPUT
          echo "$REVIEW_OUTPUT" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT
      
      - name: レビューコメント投稿
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## 🤖 Codex自動レビュー\n\n${{ steps.review.outputs.review_output }}`
            })
```

### 2. 定期的なコード品質改善

```yaml
name: 週次コード品質改善

on:
  schedule:
    - cron: '0 9 * * 1'  # 毎週月曜日午前9時

jobs:
  quality-improvement:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Codex品質改善
        run: |
          npm install -g @openai/codex
          codex auth --api-key ${{ secrets.CODEX_API_KEY }}
          
          # 複数のタスクを順次実行
          codex exec --full-auto "未使用のインポートを削除"
          codex exec --full-auto "複雑な関数をリファクタリング"
          codex exec --full-auto "不足しているテストを追加"
          codex exec --full-auto "ドキュメントを更新"
      
      - name: 結果をPRとして提出
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          BRANCH="weekly-improvements-$(date +%Y%m%d)"
          git checkout -b $BRANCH
          git add .
          git commit -m "週次: コード品質改善"
          git push origin $BRANCH
          
          gh pr create \
            --title "📈 週次コード品質改善" \
            --body "Codexによる自動品質改善が実行されました。" \
            --label "automation,enhancement"
```

### 3. イシュートリガー自動修正

```yaml
name: イシュー自動修正

on:
  issues:
    types: [labeled]

jobs:
  auto-fix:
    if: github.event.label.name == 'auto-fix'
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: イシュー内容取得と修正
        env:
          ISSUE_TITLE: ${{ github.event.issue.title }}
          ISSUE_BODY: ${{ github.event.issue.body }}
        run: |
          npm install -g @openai/codex
          codex auth --api-key ${{ secrets.CODEX_API_KEY }}
          
          codex exec --full-auto "次のイシューを解決: 
            タイトル: $ISSUE_TITLE
            詳細: $ISSUE_BODY"
      
      - name: 修正をコミット
        run: |
          git checkout -b fix-issue-${{ github.event.issue.number }}
          git add .
          git commit -m "Fix #${{ github.event.issue.number }}: ${{ github.event.issue.title }}"
          git push origin fix-issue-${{ github.event.issue.number }}
```

## ベストプラクティス

### 1. セキュリティ

- **APIキーの管理**: 必ずGitHub Secretsを使用
- **権限の最小化**: 必要最小限の権限のみ付与
- **監査ログ**: すべての自動化アクションをログに記録

```yaml
# セキュアな設定例
env:
  CODEX_API_KEY: ${{ secrets.CODEX_API_KEY }}
  # APIキーを直接記載しない
```

### 2. エラーハンドリング

```yaml
- name: Codexタスク実行（エラー処理付き）
  id: codex-task
  continue-on-error: true
  run: |
    codex exec --full-auto "${{ github.event.inputs.task }}" || echo "::error::Codexタスクが失敗しました"
    
- name: エラー通知
  if: failure()
  uses: actions/github-script@v7
  with:
    script: |
      github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: '❌ Codexタスクの実行に失敗しました。ログを確認してください。'
      })
```

### 3. パフォーマンス最適化

- **並列実行**: 複数のタスクを並列で実行
- **キャッシュ活用**: 依存関係のキャッシュ
- **条件付き実行**: 必要な場合のみタスクを実行

```yaml
# 並列実行例
jobs:
  parallel-tasks:
    strategy:
      matrix:
        task:
          - "テストを作成"
          - "ドキュメントを更新"
          - "リファクタリング"
    
    runs-on: ubuntu-latest
    
    steps:
      - name: タスク実行
        run: codex exec --full-auto "${{ matrix.task }}"
```

### 4. モニタリングとログ

```yaml
- name: Codex実行ログ
  run: |
    codex exec --full-auto "$TASK" --verbose --log-file=codex.log
    
- name: ログアーカイブ
  uses: actions/upload-artifact@v3
  with:
    name: codex-logs
    path: codex.log
    retention-days: 30
```

## まとめ

OpenAI Codexの自動化により、以下のメリットが得られます：

1. **開発効率の向上**: 反復的なタスクの自動化
2. **品質の一貫性**: 自動レビューとリファクタリング
3. **継続的改善**: 定期的なコード品質チェック
4. **チーム協働**: GitHub統合による透明性の確保

GitHub Actionsとの連携により、プロンプト入力を完全に自動化し、CI/CDパイプラインに組み込むことが可能です。適切な設定とセキュリティ対策を行うことで、安全かつ効率的な自動化ワークフローを構築できます。

## 参考リンク

- [OpenAI Codex公式ドキュメント](https://platform.openai.com/docs/codex)
- [GitHub Actions公式ドキュメント](https://docs.github.com/actions)
- [Codex CLI GitHubリポジトリ](https://github.com/openai/codex)