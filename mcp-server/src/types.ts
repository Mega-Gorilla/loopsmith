export interface EvaluationRubric {
  completeness: number;
  accuracy: number;
  clarity: number;
  usability: number;
}

export interface EvaluationRequest {
  content: string;
  rubric?: EvaluationRubric;
  target_score?: number;
}

export interface EvaluationResponse {
  score: number;
  rubric_scores: EvaluationRubric;
  pass: boolean;
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