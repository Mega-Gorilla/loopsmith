export interface EvaluationDetails {
  strengths: string[];  // 良い点のリスト
  issues: string[];  // 問題点・誤りのリスト
  improvements: string[];  // 改善提案のリスト
  context_specific: any;  // 文脈に応じた追加評価
}

export interface EvaluationRequest {
  document_path: string;  // 評価対象ドキュメントのファイルパス
  target_score?: number;
  project_path?: string;  // Path to the project directory for context-aware evaluation
  evaluation_mode?: 'flexible' | 'strict';  // 評価モード（デフォルト: flexible）
}

export interface EvaluationResponse {
  // 必須フィールド
  score: number;  // 総合評価スコア (0-10)
  pass: boolean;  // target_score以上かどうか
  
  // コアフィールド
  summary?: string;  // 1-2文の総評
  status?: 'excellent' | 'good' | 'needs_improvement' | 'poor';  // スコアに基づくステータス
  details?: EvaluationDetails;  // 詳細評価
  
  // メタデータ
  metadata?: {
    iteration?: number;
    evaluation_time?: number;
    model_used?: string;
    parsing_method?: 'json' | 'structured_text' | 'hybrid' | 'flexible' | string;
    format_version?: 'traditional' | 'simplified';  // Format version
    schema_version?: 'v3';  // スキーマバージョン
  };
  
  // その他の任意フィールドを許可
  [key: string]: any;
}

// Simplified evaluation format for clearer pass/fail decisions
export interface SimplifiedEvaluationResponse {
  // Required fields
  pass: boolean;  // Whether the document is ready for implementation
  confidence: 'high' | 'medium' | 'low';  // Confidence level in the evaluation
  context: string;  // Markdown-formatted detailed evaluation
  
  // Optional metadata
  metadata?: {
    evaluation_time?: number;
    model_used?: string;
    format_version: 'simplified';  // Format identifier
    parsing_method?: string;
  };
}

// Union type for backward compatibility
export type AnyEvaluationResponse = EvaluationResponse | SimplifiedEvaluationResponse;

export interface MCPMessage {
  jsonrpc: '2.0';
  id: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}