# LoopSmith APIドキュメント

## 概要
LoopSmithは、Claude CodeとCodexを統合した自動評価システムです。

## 主要機能
- ドキュメント自動評価
- 実装準備判定
- プロジェクトコンテキスト認識

## 使用方法
1. MCPサーバーをインストール
2. evaluate_documentツールを呼び出す
3. 評価結果を確認

## API
### evaluate_document
```javascript
evaluate_document({
  content: "評価対象のドキュメント",
  project_path: "/path/to/project"
})
```