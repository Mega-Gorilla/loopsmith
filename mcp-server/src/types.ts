export interface EvaluationRubric {
  completeness: number;
  accuracy: number;
  clarity: number;
  usability: number;
}

export interface EvaluationRequest {
  content: string;
  rubric?: EvaluationRubric;  // Deprecated - use weights instead
  weights?: {
    completeness: number;
    accuracy: number;
    clarity: number;
    usability: number;
  };
  target_score?: number;
  project_path?: string;  // Path to the project directory for context-aware evaluation
}

export interface EvaluationResponse {
  score: number;
  rubric_scores: EvaluationRubric;
  pass?: boolean;  // Optional - client determines based on score >= target_score
  suggestions: string[];
  metadata?: {
    iteration?: number;
    evaluation_time?: number;
    model_used?: string;
  };
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