import { EvaluationResponse } from './types';

/**
 * Class for formatting evaluation results to Markdown or JSON format
 */
export class ResultFormatter {
  private outputFormat: 'markdown' | 'json';
  
  constructor(format?: string) {
    // Respect environment variables while defaulting to Markdown
    this.outputFormat = (format === 'json') ? 'json' : 'markdown';
  }
  
  /**
   * Format evaluation result
   */
  formatEvaluationResult(result: EvaluationResponse): string {
    if (this.outputFormat === 'json') {
      return JSON.stringify(result, null, 2);
    }
    return this.toMarkdown(result);
  }
  
  /**
   * Convert evaluation result to Markdown format
   */
  private toMarkdown(result: EvaluationResponse): string {
    // Check if this is a simplified format result
    if (result.metadata?.format_version === 'simplified' && result.details?.context_specific?.full_context) {
      return this.toMarkdownSimplified(result);
    }
    
    let markdown = '# 📊 Document Evaluation Result\n\n';
    
    // Cache information
    if (result.metadata?.model_used === 'cache') {
      markdown += '⚡ **Retrieved from cache** *(evaluation time: 0ms)*\n\n';
    }
    
    // Status and pass/fail
    const statusText = this.getStatusText(result.status);
    const passEmoji = result.pass ? '✅' : '❌';
    markdown += `## Evaluation: ${passEmoji} ${result.pass ? 'Pass' : 'Fail'} (${statusText})\n\n`;
    
    // Score
    markdown += `**Score: ${result.score}/10.0**`;
    if (!result.pass) {
      // Find target_score (from metadata or elsewhere)
      const targetScore = result.target_score || 8.0;
      markdown += ` (target: ${targetScore})`;
    }
    markdown += '\n\n';
    
    // Summary
    if (result.summary) {
      markdown += `**Summary:** ${result.summary}\n\n`;
    }
    
    markdown += '---\n\n';
    
    // Detailed information
    if (result.details) {
      // Strengths
      if (result.details.strengths && result.details.strengths.length > 0) {
        markdown += '## ✨ Strengths\n';
        result.details.strengths.forEach((s: string) => {
          markdown += `- ${s}\n`;
        });
        markdown += '\n';
      }
      
      // Issues
      if (result.details.issues && result.details.issues.length > 0) {
        markdown += '## ⚠️ Issues\n';
        result.details.issues.forEach((i: string) => {
          markdown += `- ${i}\n`;
        });
        markdown += '\n';
      }
      
      // Improvement suggestions
      if (result.details.improvements && result.details.improvements.length > 0) {
        markdown += '## 💡 Improvements\n';
        result.details.improvements.forEach((imp: string) => {
          markdown += `- ${imp}\n`;
        });
        markdown += '\n';
      }
      
      // Context-specific information
      if (result.details.context_specific && 
          Object.keys(result.details.context_specific).length > 0) {
        markdown += '## 📌 Additional Information\n';
        markdown += '```json\n';
        markdown += JSON.stringify(result.details.context_specific, null, 2);
        markdown += '\n```\n\n';
      }
    }
    
    // Next steps section
    markdown += '---\n\n';
    markdown += '## 🎯 Next Steps\n\n';
    
    if (result.pass) {
      markdown += '🎉 **Excellent!** The document has reached the target quality.\n';
      markdown += 'After addressing any noted issues, report the evaluation results to the user and confirm next actions.\n';
    } else {
      markdown += '⚠️ **Corrections and improvements needed**\n';
      markdown += '- Carefully revise the documentation based on the above evaluation!\n';
      markdown += '- After revising the documentation, be sure to re-evaluate using MCP!\n';
      markdown += '- Through iterative improvements, you can definitely reach the target quality. Keep going!\n';
    }
    
    return markdown;
  }
  
  /**
   * Convert simplified evaluation result to Markdown format
   */
  private toMarkdownSimplified(result: EvaluationResponse): string {
    let markdown = '# 📊 Document Evaluation Result (Simplified)\n\n';
    
    // Cache information
    if (result.metadata?.model_used === 'cache') {
      markdown += '⚡ **Retrieved from cache** *(evaluation time: 0ms)*\n\n';
    }
    
    // Pass/Fail status with confidence
    const passEmoji = result.pass ? '✅' : '❌';
    const confidence = result.details?.context_specific?.confidence || 'medium';
    const confidenceEmoji = confidence === 'high' ? '🟢' : confidence === 'medium' ? '🟡' : '🔴';
    
    markdown += `## Evaluation: ${passEmoji} ${result.pass ? 'Ready for Implementation' : 'Not Ready'}\n`;
    markdown += `**Confidence:** ${confidenceEmoji} ${confidence.charAt(0).toUpperCase() + confidence.slice(1)}\n\n`;
    
    markdown += '---\n\n';
    
    // Display the full context from simplified format
    if (result.details?.context_specific?.full_context) {
      markdown += result.details.context_specific.full_context;
    } else {
      markdown += '## Summary\n';
      markdown += result.summary || 'No summary available.\n';
    }
    
    markdown += '\n---\n\n';
    markdown += '## 🎯 Next Steps\n\n';
    
    if (result.pass) {
      markdown += '🎉 **Great!** The document is ready for implementation.\n';
      markdown += 'You can proceed with development based on this document.\n';
    } else {
      markdown += '⚠️ **Improvements needed**\n';
      markdown += '- Review the evaluation above and address the identified issues\n';
      markdown += '- After making improvements, re-evaluate using MCP\n';
      markdown += '- Focus on the "Needs Attention" section for critical fixes\n';
    }
    
    return markdown;
  }
  
  /**
   * Get status text
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
   * Format error to Markdown format
   */
  formatError(error: Error & { code?: string }): string {
    if (this.outputFormat === 'json') {
      return JSON.stringify({
        error: true,
        message: error.message,
        code: error.code
      }, null, 2);
    }
    
    let markdown = '# ⚠️ Evaluation Error\n\n';
    markdown += '## Error Summary\n';
    markdown += 'An error occurred during document evaluation.\n\n';
    
    if (error.code) {
      markdown += `**Error Code**: \`${error.code}\`\n\n`;
    }
    
    markdown += '---\n\n';
    markdown += '## Detailed Information\n\n';
    markdown += '### Error Message\n';
    markdown += '```\n';
    markdown += error.message;
    markdown += '\n```\n\n';
    
    markdown += '### Recommended Solutions\n\n';
    
    // Solutions based on error code
    if (error.code === 'EVAL_TIMEOUT') {
      markdown += '1. **Split the document**\n';
      markdown += '   Split large documents into chapters\n\n';
      markdown += '2. **Adjust timeout settings**\n';
      markdown += '   ```bash\n';
      markdown += '   export CODEX_TIMEOUT=60000  # Extend to 60 seconds\n';
      markdown += '   ```\n\n';
    } else if (error.code === 'CODEX_NOT_FOUND') {
      markdown += '1. **Verify Codex CLI installation**\n';
      markdown += '   ```bash\n';
      markdown += '   codex --version\n';
      markdown += '   ```\n\n';
      markdown += '2. **Set the path**\n';
      markdown += '   ```bash\n';
      markdown += '   export CODEX_PATH=/path/to/codex\n';
      markdown += '   ```\n\n';
    }
    
    markdown += '3. **Retry**\n';
    markdown += '   Please wait a moment and try again\n';
    
    return markdown;
  }
}