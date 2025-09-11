# LoopSmith シーケンス図

## 基本的な評価フロー

```mermaid
sequenceDiagram
    participant U as ユーザー
    participant CC as Claude Code
    participant WS as MCP Server<br/>(WebSocket)
    participant EV as Evaluator
    participant CX as Codex CLI
    participant PT as Prompt<br/>Template
    
    U->>CC: プロンプト入力<br/>"APIドキュメントを作成"
    activate CC
    CC->>CC: ドキュメント生成
    CC->>WS: WebSocket接続<br/>ws://localhost:23100/mcp
    activate WS
    
    rect rgb(240, 248, 255)
        Note over WS: 初期化フェーズ
        CC->>WS: initialize
        WS-->>CC: serverInfo & capabilities
        CC->>WS: tools/list
        WS-->>CC: available tools
    end
    
    rect rgb(255, 245, 238)
        Note over CC,CX: 評価ループ (最大5回)
        loop while score < 8.0 && iteration < 5
            CC->>WS: tools/call<br/>evaluate_document
            WS->>EV: 評価要求
            activate EV
            
            alt 本番モード (USE_MOCK_EVALUATOR=false)
                EV->>PT: テンプレート読込
                PT-->>EV: プロンプトテンプレート
                EV->>EV: 変数置換<br/>(重み、内容)
                EV->>CX: spawn process<br/>codex exec --full-auto
                activate CX
                CX->>CX: ドキュメント評価
                CX-->>EV: JSON結果
                deactivate CX
            else モックモード (USE_MOCK_EVALUATOR=true)
                EV->>EV: 簡易評価ロジック
            end
            
            EV-->>WS: 評価結果<br/>(score, suggestions)
            deactivate EV
            WS-->>CC: MCP Response
            
            alt スコア < 8.0
                CC->>CC: 改善提案を適用
                CC->>CC: ドキュメント更新
            else スコア >= 8.0
                Note over CC: 目標達成！
            end
        end
    end
    
    CC->>WS: WebSocket切断
    deactivate WS
    CC-->>U: 最終ドキュメント<br/>& 評価結果
    deactivate CC
```

## エラーハンドリングフロー

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant WS as MCP Server
    participant EV as Evaluator
    participant CX as Codex CLI
    
    CC->>WS: tools/call<br/>evaluate_document
    WS->>EV: 評価要求
    activate EV
    
    rect rgb(255, 235, 238)
        Note over EV,CX: エラー処理と再試行
        loop 最大3回試行
            EV->>CX: spawn process
            activate CX
            
            alt 正常終了
                CX-->>EV: JSON結果
                deactivate CX
                Note over EV: 成功 - ループ終了
            else タイムアウト (120秒)
                CX--xEV: タイムアウト
                deactivate CX
                EV->>EV: 指数バックオフ<br/>(1秒, 2秒, 4秒)
            else プロセスエラー
                CX--xEV: エラー終了
                alt retryable = true
                    EV->>EV: 再試行準備
                else retryable = false
                    Note over EV: 即座に失敗
                end
            end
        end
    end
    
    alt 全試行失敗
        EV-->>WS: エラーレスポンス<br/>code: -32603
        WS-->>CC: エラー通知
        CC->>CC: フォールバック処理
    else 成功
        EV-->>WS: 評価結果
        deactivate EV
        WS-->>CC: 正常レスポンス
    end
```

## プロンプトテンプレート処理

```mermaid
sequenceDiagram
    participant EV as Evaluator
    participant FS as File System
    participant ENV as Environment
    participant CX as Codex CLI
    
    EV->>ENV: EVALUATION_PROMPT_PATH取得
    
    alt カスタムパス指定
        ENV-->>EV: カスタムパス
        EV->>FS: readFile(カスタムパス)
        
        alt ファイル存在
            FS-->>EV: テンプレート内容
            EV->>EV: キャッシュに保存
        else ファイル不在
            FS--xEV: ファイルなし
            EV->>EV: デフォルトテンプレート使用
        end
    else デフォルト
        ENV-->>EV: null
        EV->>FS: readFile(../prompts/evaluation-prompt.txt)
        FS-->>EV: テンプレート内容
    end
    
    EV->>EV: プレースホルダー置換<br/>{{completeness_weight}}<br/>{{accuracy_weight}}<br/>{{clarity_weight}}<br/>{{usability_weight}}<br/>{{document_content}}
    
    EV->>CX: 完成したプロンプト送信
```

## WebSocket通信詳細

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant WS as WebSocket Server
    participant H as MCP Handler
    participant EV as Evaluator
    
    CC->>WS: 接続要求<br/>ws://localhost:23100/mcp
    WS->>WS: 新規クライアント登録
    WS-->>CC: 接続確立
    
    rect rgb(245, 245, 245)
        Note over CC,H: JSON-RPC 2.0メッセージ
        
        CC->>WS: {"jsonrpc":"2.0",<br/>"id":1,<br/>"method":"initialize"}
        WS->>H: メッセージパース
        H->>H: initializeハンドラー
        H-->>WS: 初期化レスポンス
        WS-->>CC: {"jsonrpc":"2.0",<br/>"id":1,<br/>"result":{...}}
        
        CC->>WS: {"jsonrpc":"2.0",<br/>"id":2,<br/>"method":"tools/list"}
        WS->>H: メッセージパース
        H-->>WS: ツール一覧
        WS-->>CC: {"jsonrpc":"2.0",<br/>"id":2,<br/>"result":{"tools":[...]}}
        
        CC->>WS: {"jsonrpc":"2.0",<br/>"id":3,<br/>"method":"tools/call",<br/>"params":{"name":"evaluate_document",...}}
        WS->>H: メッセージパース
        H->>EV: 評価実行
        EV-->>H: 評価結果
        H-->>WS: ツール実行結果
        WS-->>CC: {"jsonrpc":"2.0",<br/>"id":3,<br/>"result":{"content":[...]}}
    end
    
    CC->>WS: 切断要求
    WS->>WS: クライアント削除
    WS-->>CC: 切断確認
```

## 状態遷移図

```mermaid
stateDiagram-v2
    [*] --> 待機中: サーバー起動
    
    待機中 --> 接続中: WebSocket接続
    接続中 --> 初期化済み: initialize完了
    
    初期化済み --> ツール実行中: tools/call
    ツール実行中 --> 評価中: evaluate_document
    
    評価中 --> Codex実行中: spawn process
    Codex実行中 --> JSON解析中: 出力受信
    JSON解析中 --> スコア計算中: パース成功
    
    スコア計算中 --> 改善必要: score < 8.0
    スコア計算中 --> 完了: score >= 8.0
    
    改善必要 --> 改善提案生成: suggestions作成
    改善提案生成 --> 初期化済み: 次の反復
    
    完了 --> 待機中: セッション終了
    
    評価中 --> エラー処理: タイムアウト/エラー
    エラー処理 --> 再試行中: retryable=true
    エラー処理 --> 失敗: retryable=false
    再試行中 --> 評価中: バックオフ後
    
    失敗 --> 待機中: エラー応答
```

## データ構造

### 評価要求 (EvaluationRequest)
```typescript
{
  content: string,           // 評価対象ドキュメント
  rubric?: {                // 評価基準（オプション）
    completeness: number,    // 完全性の重み
    accuracy: number,        // 正確性の重み
    clarity: number,         // 明確性の重み
    usability: number        // 実用性の重み
  },
  target_score?: number      // 目標スコア
}
```

### 評価結果 (EvaluationResponse)
```typescript
{
  score: number,             // 総合スコア (0-10)
  rubric_scores: {           // 各基準のスコア
    completeness: number,
    accuracy: number,
    clarity: number,
    usability: number
  },
  pass: boolean,             // 合格判定
  suggestions: string[],     // 改善提案
  metadata?: {               // メタデータ
    iteration?: number,      // 反復回数
    evaluation_time?: number,// 評価時間(ms)
    model_used?: string      // 使用モデル
  }
}
```

### MCPメッセージ形式
```typescript
{
  jsonrpc: "2.0",           // プロトコルバージョン
  id: number | string,      // リクエストID
  method?: string,          // メソッド名
  params?: any,             // パラメータ
  result?: any,             // 成功結果
  error?: {                 // エラー情報
    code: number,           // エラーコード
    message: string,        // エラーメッセージ
    data?: any              // 追加情報
  }
}
```