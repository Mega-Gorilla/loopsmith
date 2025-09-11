# ダッシュボード監視機能

## 概要
LoopSmithにリアルタイム監視ダッシュボードを実装しました。この機能により、Codex評価プロセスをブラウザから視覚的に監視できます。

## 主な機能

### 1. リアルタイム監視
- **評価進捗表示**: 現在実行中の評価の進捗をリアルタイムで表示
- **ログストリーミング**: MCPサーバーとCodexからのログをリアルタイム表示
- **WebSocket通信**: Socket.IOを使用した双方向通信

### 2. 評価履歴管理
- **履歴テーブル**: 過去の評価結果を時系列で表示
- **詳細表示**: 各評価の詳細情報をモーダルで確認可能
- **統計情報**: 成功率、平均スコア、平均処理時間を自動計算

### 3. UI機能
- **自動スクロール**: 新しいログを自動的に表示
- **フィルタリング**: ログレベルによるフィルタリング
- **レスポンシブデザイン**: 様々な画面サイズに対応

## アーキテクチャ

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Web Browser   │────>│  Dashboard Server │────>│  MCP Server │
│  (localhost:3001)│<────│   (Express.js)    │<────│ (WebSocket) │
└─────────────────┘     └──────────────────┘     └─────────────┘
        │                        │                       │
        │                        │                       │
        └── Socket.IO ───────────┴───────────────────────┘
                                                         │
                                                         ▼
                                                   ┌───────────┐
                                                   │   Codex   │
                                                   │    CLI    │
                                                   └───────────┘
```

## 使用方法

### 1. 統合サーバーの起動（推奨）
```bash
# MCPサーバーとダッシュボードを同時に起動
cd mcp-server
npm run build
npx cross-env USE_MOCK_EVALUATOR=true MCP_PORT=23110 DASHBOARD_PORT=3001 npm run start:integrated
```

### 2. 個別起動
```bash
# ダッシュボードのみ起動
npm run dashboard

# MCPサーバーのみ起動  
npm start
```

### 3. ブラウザでアクセス
```
http://localhost:3001
```

## 環境変数

| 変数名 | 説明 | デフォルト値 |
|--------|------|------------|
| DASHBOARD_PORT | ダッシュボードのポート番号 | 3000 |
| MCP_PORT | MCPサーバーのポート番号 | 23100 |
| USE_MOCK_EVALUATOR | モック評価器の使用 | false |

## 実装詳細

### ファイル構成
```
mcp-server/
├── src/
│   ├── dashboard.ts          # ダッシュボードサーバー
│   ├── server-with-dashboard.ts # 統合サーバー
│   └── server.ts             # MCPサーバー
├── public/
│   ├── index.html            # ダッシュボードUI
│   ├── app.js               # クライアントサイドJS
│   └── style.css            # スタイルシート
└── scripts/
    └── test-dashboard-integration.js # 統合テスト
```

### イベント通信

#### サーバー → クライアント
- `initial:data` - 初期データ送信
- `log:new` - 新規ログ
- `evaluation:started` - 評価開始
- `evaluation:progress` - 進捗更新  
- `evaluation:completed` - 評価完了
- `evaluation:error` - エラー発生

#### クライアント → サーバー
- `logs:filter` - ログフィルタリング
- `history:detail` - 履歴詳細要求

## テスト

### 統合テストの実行
```bash
cd mcp-server
node scripts/test-dashboard-integration.js
```

## トラブルシューティング

### ポート競合エラー
```
Error: listen EADDRINUSE: address already in use :::3001
```
解決方法:
- 別のポート番号を指定: `DASHBOARD_PORT=3002`
- 既存プロセスを停止: `taskkill /F /IM node.exe`

### WebSocket接続エラー
- ファイアウォール設定を確認
- ブラウザの開発者ツールでコンソールログを確認

## 今後の拡張案

1. **認証機能**: アクセス制御の追加
2. **データ永続化**: 評価履歴のデータベース保存
3. **アラート機能**: 閾値設定による通知
4. **エクスポート機能**: CSV/JSONでのデータ出力
5. **複数サーバー監視**: 複数のMCPサーバーの統合監視

## まとめ
このダッシュボード機能により、LoopSmithの評価プロセスがより透明で管理しやすくなりました。リアルタイムでの監視により、問題の早期発見と対応が可能になります。