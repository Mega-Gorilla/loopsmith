export interface EvaluationRubric {
  completeness: number;
  accuracy: number;
  clarity: number;
  usability: number;
}

export interface EvaluationRequest {
  content: string;
  target_score?: number;
  project_path?: string;  // Path to the project directory for context-aware evaluation
  evaluation_mode?: 'flexible' | 'strict';  // 評価モード（デフォルト: flexible）
}

export interface EvaluationResponse {
  // 必須フィールド
  ready_for_implementation: boolean;  // 実装に移れるか
  score: number;  // 総合評価スコア
  
  // 柔軟なフィールド（Codexの自由な出力を受け入れる）
  conclusion?: string;  // 結論
  rationale?: string;   // 根拠
  analysis?: any;       // 詳細分析（構造は自由）
  recommendations?: any; // 推奨事項（構造は自由）
  blockers?: any;       // 実装を妨げる問題（文字列配列または構造化データ）
  improvements?: any;   // 改善提案
  technical_notes?: any; // 技術的な注記
  
  // 後方互換性のためのフィールド
  rubric_scores?: EvaluationRubric;
  pass?: boolean;
  suggestions?: string[];
  recommended_approach?: string;
  
  // メタデータ
  metadata?: {
    iteration?: number;
    evaluation_time?: number;
    model_used?: string;
    parsing_method?: 'json' | 'structured_text' | 'hybrid';
  };
  
  // その他の任意フィールドを許可
  [key: string]: any;
}

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