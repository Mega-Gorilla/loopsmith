import { EvaluationResponse } from './types';

/**
 * 評価結果をMarkdownまたはJSON形式にフォーマットするクラス
 */
export class ResultFormatter {
  private outputFormat: 'markdown' | 'json';
  
  constructor(format?: string) {
    // 環境変数を尊重しつつ、デフォルトはMarkdown
    this.outputFormat = (format === 'json') ? 'json' : 'markdown';
  }
  
  /**
   * 評価結果をフォーマット
   */
  formatEvaluationResult(result: EvaluationResponse): string {
    if (this.outputFormat === 'json') {
      return JSON.stringify(result, null, 2);
    }
    return this.toMarkdown(result);
  }
  
  /**
   * 評価結果をMarkdown形式に変換
   */
  private toMarkdown(result: EvaluationResponse): string {
    let markdown = '# 📊 ドキュメント評価結果\n\n';
    
    // キャッシュ情報
    if (result.metadata?.model_used === 'cache') {
      markdown += '⚡ **キャッシュから取得** *(評価時間: 0ms)*\n\n';
    }
    
    // ステータスと合否
    const statusText = this.getStatusText(result.status);
    const passEmoji = result.pass ? '✅' : '❌';
    markdown += `## 評価: ${passEmoji} ${result.pass ? '合格' : '不合格'} (${statusText})\n\n`;
    
    // スコア
    markdown += `**スコア: ${result.score}/10.0**`;
    if (!result.pass) {
      // target_scoreを探す（metadataまたは他の場所から）
      const targetScore = result.target_score || 8.0;
      markdown += ` (目標: ${targetScore})`;
    }
    markdown += '\n\n';
    
    // 総評
    if (result.summary) {
      markdown += `**総評:** ${result.summary}\n\n`;
    }
    
    markdown += '---\n\n';
    
    // 詳細情報
    if (result.details) {
      // 強み
      if (result.details.strengths && result.details.strengths.length > 0) {
        markdown += '## ✨ 強み\n';
        result.details.strengths.forEach((s: string) => {
          markdown += `- ${s}\n`;
        });
        markdown += '\n';
      }
      
      // 問題点
      if (result.details.issues && result.details.issues.length > 0) {
        markdown += '## ⚠️ 問題点・課題\n';
        result.details.issues.forEach((i: string) => {
          markdown += `- ${i}\n`;
        });
        markdown += '\n';
      }
      
      // 改善提案
      if (result.details.improvements && result.details.improvements.length > 0) {
        markdown += '## 💡 改善提案\n';
        result.details.improvements.forEach((imp: string) => {
          markdown += `- ${imp}\n`;
        });
        markdown += '\n';
      }
      
      // コンテキスト固有情報
      if (result.details.context_specific && 
          Object.keys(result.details.context_specific).length > 0) {
        markdown += '## 📌 追加情報\n';
        markdown += '```json\n';
        markdown += JSON.stringify(result.details.context_specific, null, 2);
        markdown += '\n```\n\n';
      }
    }
    
    // 次のステップセクション
    markdown += '---\n\n';
    markdown += '## 🎯 次のステップ\n\n';
    
    if (result.pass) {
      markdown += '🎉 **素晴らしいです！** ドキュメントが目標品質に達しました。\n';
      markdown += '指摘された問題点について修正した後、評価結果をユーザーに報告し、次のアクションを確認してください。\n';
    } else {
      markdown += '⚠️ **修正・改善が必要です**\n';
      markdown += '- 上記評価に基づいて熟考しつつドキュメンテーションを修正しましょう！\n';
      markdown += '- ドキュメンテーションを修正後、必ずMCPを用いて再評価を行いましょう！\n';
      markdown += '- 修正を重ねることで、必ず目標品質に到達できます。頑張りましょう！\n';
    }
    
    return markdown;
  }
  
  /**
   * ステータステキストを取得
   */
  private getStatusText(status?: string): string {
    switch(status) {
      case 'excellent': return 'Excellent';
      case 'good': return 'Good';
      case 'needs_improvement': return 'Needs Improvement';
      case 'poor': return 'Poor';
      default: return 'Unknown';
    }
  }
  
  /**
   * エラーをMarkdown形式にフォーマット
   */
  formatError(error: Error & { code?: string }): string {
    if (this.outputFormat === 'json') {
      return JSON.stringify({
        error: true,
        message: error.message,
        code: error.code
      }, null, 2);
    }
    
    let markdown = '# ⚠️ 評価エラー\n\n';
    markdown += '## エラー概要\n';
    markdown += 'ドキュメントの評価中にエラーが発生しました。\n\n';
    
    if (error.code) {
      markdown += `**エラーコード**: \`${error.code}\`\n\n`;
    }
    
    markdown += '---\n\n';
    markdown += '## 詳細情報\n\n';
    markdown += '### エラーメッセージ\n';
    markdown += '```\n';
    markdown += error.message;
    markdown += '\n```\n\n';
    
    markdown += '### 推奨される対処法\n\n';
    
    // エラーコードに応じた対処法
    if (error.code === 'EVAL_TIMEOUT') {
      markdown += '1. **ドキュメントの分割**\n';
      markdown += '   大きなドキュメントを章ごとに分割してください\n\n';
      markdown += '2. **タイムアウト設定の調整**\n';
      markdown += '   ```bash\n';
      markdown += '   export CODEX_TIMEOUT=60000  # 60秒に延長\n';
      markdown += '   ```\n\n';
    } else if (error.code === 'CODEX_NOT_FOUND') {
      markdown += '1. **Codex CLIのインストール確認**\n';
      markdown += '   ```bash\n';
      markdown += '   codex --version\n';
      markdown += '   ```\n\n';
      markdown += '2. **パスの設定**\n';
      markdown += '   ```bash\n';
      markdown += '   export CODEX_PATH=/path/to/codex\n';
      markdown += '   ```\n\n';
    }
    
    markdown += '3. **リトライ**\n';
    markdown += '   しばらく待ってから再度実行してください\n';
    
    return markdown;
  }
}