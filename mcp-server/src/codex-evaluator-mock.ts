import { EvaluationRequest, EvaluationResponse, EvaluationRubric } from './types';

export class CodexEvaluatorMock {
  private readonly defaultRubric: EvaluationRubric = {
    completeness: 0.3,
    accuracy: 0.3,
    clarity: 0.2,
    usability: 0.2
  };

  async evaluate(request: EvaluationRequest): Promise<EvaluationResponse> {
    const targetScore = request.target_score || 8.0;
    
    // ファイルパスからモックコンテンツを生成
    const content = `[Document from ${request.document_path}]`;
    
    // シンプルなモック評価ロジック
    const contentLength = content.length;
    const hasTitle = content.includes('#');
    const hasCode = content.includes('```');
    const hasList = content.includes('-') || content.includes('*');
    
    // スコア計算
    const completeness = Math.min(10, contentLength / 100);
    const accuracy = hasCode ? 8 : 5;
    const clarity = hasTitle && hasList ? 7 : 4;
    const usability = hasCode ? 7 : 5;
    
    const weightedScore = 
      completeness * this.defaultRubric.completeness +
      accuracy * this.defaultRubric.accuracy +
      clarity * this.defaultRubric.clarity +
      usability * this.defaultRubric.usability;
    
    const suggestions = [];
    if (contentLength < 500) {
      suggestions.push('より詳細な説明を追加してください');
    }
    if (!hasCode) {
      suggestions.push('コード例を追加してください');
    }
    if (!hasTitle) {
      suggestions.push('セクション構造を明確にしてください');
    }
    
    return {
      ready_for_implementation: weightedScore >= targetScore,
      score: Number(weightedScore.toFixed(1)),
      rubric_scores: {
        completeness,
        accuracy,
        clarity,
        usability
      },
      pass: weightedScore >= targetScore,
      suggestions,
      metadata: {
        evaluation_time: 100,
        model_used: 'mock-evaluator'
      }
    };
  }
}