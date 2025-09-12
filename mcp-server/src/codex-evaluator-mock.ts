import { EvaluationRequest, EvaluationResponse } from './types';

export class CodexEvaluatorMock {
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
    const score = Math.min(10, contentLength / 50 + (hasTitle ? 2 : 0) + (hasCode ? 2 : 0) + (hasList ? 1 : 0));
    
    const strengths = [];
    const issues = [];
    const improvements = [];
    
    if (hasTitle) {
      strengths.push('明確なセクション構造がある');
    }
    if (hasCode) {
      strengths.push('コード例が含まれている');
    }
    
    if (contentLength < 500) {
      issues.push('内容が不十分');
      improvements.push('より詳細な説明を追加してください');
    }
    if (!hasCode) {
      issues.push('コード例が不足');
      improvements.push('実装例を追加してください');
    }
    if (!hasTitle) {
      issues.push('構造が不明確');
      improvements.push('セクション構造を明確にしてください');
    }
    
    return {
      score: Number(score.toFixed(1)),
      pass: score >= targetScore,
      summary: `モック評価が完了しました。スコア: ${score.toFixed(1)}/10`,
      status: score >= 8 ? 'excellent' : score >= 6 ? 'good' : score >= 4 ? 'needs_improvement' : 'poor',
      details: {
        strengths,
        issues,
        improvements,
        context_specific: {
          mock_evaluation: true,
          content_length: contentLength
        }
      },
      metadata: {
        evaluation_time: 100,
        model_used: 'mock-evaluator',
        schema_version: 'v3'
      }
    };
  }
}