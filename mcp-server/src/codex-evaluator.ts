import { spawn } from 'child_process';
import { EvaluationRequest, EvaluationResponse, SimplifiedEvaluationResponse, AnyEvaluationResponse } from './types';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { createHash } from 'crypto';
import { performance } from 'perf_hooks';

// .env ファイルを読み込み
dotenv.config();

export class CodexEvaluator {
  private maxRetries = 2;
  private retryDelay = 1000; // 初期遅延1秒
  private promptTemplate: string | null = null;
  private codexTimeout: number;
  private codexMaxBuffer: number;
  private targetScore: number;
  
  // キャッシュ機構
  private cache = new Map<string, { result: EvaluationResponse; timestamp: number }>();
  private cacheTTL = parseInt(process.env.CODEX_CACHE_TTL || '3600000'); // デフォルト1時間
  private cacheEnabled = process.env.CODEX_CACHE_ENABLED === 'true'; // デフォルト無効

  constructor() {
    // 環境変数から設定を読み込み
    // タイムアウト: デフォルト5分（300000ms）、最大30分（1800000ms）
    const timeoutValue = parseInt(process.env.CODEX_TIMEOUT || '300000');
    this.codexTimeout = Math.min(timeoutValue, 1800000); // 最大30分に制限
    
    if (timeoutValue > 1800000) {
      console.warn(`⚠️ CODEX_TIMEOUT (${timeoutValue}ms) が最大値30分を超えています。30分に制限されます。`);
    }
    
    this.codexMaxBuffer = parseInt(process.env.CODEX_MAX_BUFFER || '20971520');
    this.targetScore = parseFloat(process.env.TARGET_SCORE || '8.0');
  }

  private generateCacheKey(request: EvaluationRequest): string {
    try {
      const fileContent = fs.readFileSync(request.document_path, 'utf8');
      const hash = createHash('sha256');
      hash.update(fileContent);
      hash.update(request.target_score?.toString() || '8');
      hash.update(this.codexTimeout.toString());
      hash.update(this.promptTemplate || 'default');
      return hash.digest('hex');
    } catch (error) {
      // ファイルが読めない場合はキャッシュを使用しない
      return '';
    }
  }

  async evaluate(request: EvaluationRequest): Promise<EvaluationResponse> {
    const startTotalTime = performance.now();
    const targetScore = request.target_score || this.targetScore;
    
    // キャッシュチェック
    let cacheKey = '';
    if (this.cacheEnabled) {
      cacheKey = this.generateCacheKey(request);
      if (cacheKey && this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey)!;
        const now = Date.now();
        if (now - cached.timestamp < this.cacheTTL) {
          if (process.env.NODE_ENV !== 'production') {
            console.log('Returning cached result');
          }
          // キャッシュヒット時のメタデータを更新
          const result: EvaluationResponse = {
            ...cached.result,
            metadata: {
              ...cached.result.metadata,
              evaluation_time: 0,  // キャッシュヒットなので0
              model_used: 'cache'
            }
          };
          return result;
        } else {
          // 期限切れキャッシュを削除
          this.cache.delete(cacheKey);
        }
      }
    }
    
    // ファイルパスを使用して評価プロンプトを構築
    if (process.env.NODE_ENV !== 'production') {
      console.log(`Using file path mode: ${request.document_path}`);
    }
    const evaluationPrompt = this.buildEvaluationPromptWithPath(request.document_path);
    
    // 再試行ロジック付き実行
    let lastError: any;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // 指数バックオフ
        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        console.log(`Retrying ${attempt}/${this.maxRetries}...`);
      }
      
      try {
        const result = await this.executeCodex(evaluationPrompt, targetScore, request.project_path);
        
        // キャッシュに保存
        if (this.cacheEnabled && cacheKey) {
          this.cache.set(cacheKey, {
            result,
            timestamp: Date.now()
          });
          
          // キャッシュサイズ制限（最大100エントリ）
          if (this.cache.size > 100) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) {
              this.cache.delete(firstKey);
            }
          }
        }
        
        // 総処理時間をメタデータに追加（評価時間として記録）
        if (!result.metadata) {
          result.metadata = {};
        }
        if (!result.metadata.evaluation_time) {
          result.metadata.evaluation_time = performance.now() - startTotalTime;
        }
        
        return result;
      } catch (error) {
        lastError = error;
        console.error(`Codex execution failed (attempt ${attempt + 1}):`, error);
        if (error && typeof error === 'object' && 'data' in error) {
          console.error('Error details:', JSON.stringify(error.data, null, 2));
        }
        
        // 再試行不可能なエラーの場合は即座に失敗
        if (error && typeof error === 'object' && 'retryable' in error && error.retryable === false) {
          throw error;
        }
      }
    }
    
    // すべての再試行が失敗
    const errorData: any = {
      details: lastError instanceof Error ? lastError.message : 'Unknown error',
      retryable: false,
      attempts: this.maxRetries + 1
    };
    
    // lastErrorが詳細情報を持っている場合は追加
    if (lastError && typeof lastError === 'object' && 'data' in lastError) {
      errorData.lastErrorData = lastError.data;
    }
    
    throw {
      code: -32603,
      message: 'Codex evaluation failed (after retries)',
      data: errorData
    };
  }

  private async executeCodex(evaluationPrompt: string, targetScore: number, projectPath?: string): Promise<EvaluationResponse> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      console.log(`Starting Codex evaluation - timeout: ${this.codexTimeout}ms (${this.codexTimeout / 1000}s)`);
      
      // spawnを使用してより堅牢な実行（Windows対応）
      const isWindows = process.platform === 'win32';
      const codexCommand = isWindows ? 'codex.cmd' : 'codex';
      
      // Codex CLIの最新形式に対応
      const codexArgs = [
        'exec',
        '--dangerously-bypass-approvals-and-sandbox',  // 承認とサンドボックスをバイパス（ファイル読み取り可能）
        '--skip-git-repo-check'  // Gitリポジトリチェックをスキップ
      ];
      
      // 注: --format jsonオプションは存在しないため削除
      // Codex CLIはデフォルトでテキスト出力を返す
      
      // 作業ディレクトリを設定（project_pathが指定されている場合はそれを使用）
      const workingDirectory = projectPath || process.cwd();
      if (process.env.NODE_ENV !== 'production') {
        console.log(`Codex working directory: ${workingDirectory}`);
      }
      
      // Codexの環境変数を設定
      // 注: CODEX_SANDBOX_MODEは実際にはCodex CLIで制御されない可能性があります
      // Codexは常にworkspace-writeモードで動作し、--full-autoオプションで制御されます
      const codexEnv = {
        ...process.env,
        CODEX_WORKSPACE_PATH: workingDirectory
      };
      
      const codexProcess = spawn(codexCommand, codexArgs, {
        shell: isWindows, // Windowsではshellをtrueに
        windowsHide: true,
        env: codexEnv,
        cwd: workingDirectory,  // 指定されたプロジェクトパスで実行
        // WindowsでのUTF-8サポート
        windowsVerbatimArguments: true
      });
      
      let stdout = '';
      let stderr = '';
      let processKilled = false;
      
      // タイムアウト処理を手動で実装
      const timeoutId = setTimeout(() => {
        if (!processKilled) {
          processKilled = true;
          console.error(`Codex process timed out (${this.codexTimeout}ms)`);
          
          // Windowsでのプロセス終了
          if (isWindows && codexProcess.pid) {
            // Windowsではtaskkillを使用
            spawn('taskkill', ['/F', '/T', '/PID', codexProcess.pid.toString()], { shell: true });
          } else if (codexProcess.pid) {
            codexProcess.kill('SIGTERM');
            // Unix系でも強制終了を保証
            setTimeout(() => {
              if (!codexProcess.killed) {
                codexProcess.kill('SIGKILL');
              }
            }, 5000);
          }
          
          reject({
            code: -32603,
            message: `Codex evaluation timed out (${this.codexTimeout / 1000}s)`,
            data: {
              details: `Processing time exceeded limit of ${this.codexTimeout}ms`,
              timeout: this.codexTimeout,
              retryable: true
            }
          });
        }
      }, this.codexTimeout);
      
      // ストリームのエンコーディングを設定（バッファ変換オーバーヘッドを削減）
      codexProcess.stdout.setEncoding('utf8');
      codexProcess.stderr.setEncoding('utf8');
      
      // WindowsでのプロセスIDをログ
      if (process.env.NODE_ENV !== 'production') {
        console.log(`Codex process started: PID=${codexProcess.pid}`);
      }
      
      // 標準出力を収集（バッファサイズ制限付き）
      codexProcess.stdout.on('data', (chunk) => {
        // setEncodingによりchunkは既に文字列
        if (stdout.length + chunk.length <= this.codexMaxBuffer) {
          stdout += chunk;
        } else {
          console.warn('Output buffer reached maximum size');
        }
      });
      
      // エラー出力を収集
      codexProcess.stderr.on('data', (chunk) => {
        stderr += chunk;  // setEncodingにより既に文字列
        // リアルタイムでstderrを出力（デバッグ用）
        if (process.env.NODE_ENV !== 'production') {
          console.error('Codex stderr:', chunk);
        }
      });
      
      // プロンプトを標準入力に書き込み（UTF-8でエンコード）
      codexProcess.stdin.setDefaultEncoding('utf8');
      codexProcess.stdin.write(evaluationPrompt, 'utf8');
      codexProcess.stdin.end();
      
      // プロセス終了時の処理
      codexProcess.on('close', (code) => {
        clearTimeout(timeoutId);  // タイムアウトをクリア
        
        if (processKilled) {
          return;  // タイムアウトで既に処理済み
        }
        
        // デバッグ情報を出力
        if (process.env.NODE_ENV !== 'production') {
          console.log(`Codex process exited: code=${code}`);
          if (stdout) console.log('Codex stdout length:', stdout.length);
          if (stderr) console.log('Codex stderr length:', stderr.length);
        }
        
        const executionTime = Date.now() - startTime;
        
        if (code !== 0) {
          const error = stderr || stdout || 'No error details';
          reject({
            code: -32603,
            message: `Codex CLI exited with error code ${code}`,
            data: {
              details: error,
              exitCode: code,
              stderr: stderr.substring(0, 1000), // 最初の1000文字のみ
              stdout: stdout.substring(0, 500),  // 最初の500文字のみ
              retryable: true
            }
          });
          return;
        }
        
        try {
          // Codexの出力を解析
          const evaluation = this.parseCodexOutput(stdout);
          
          // Check if it's simplified format
          const evaluationFormat = process.env.EVALUATION_FORMAT || 'traditional';
          
          if (evaluationFormat === 'simplified' && 'confidence' in evaluation) {
            // For simplified format, convert to traditional response for compatibility
            const simplified = evaluation as SimplifiedEvaluationResponse;
            const response: EvaluationResponse = {
              // Convert simplified to traditional
              score: simplified.pass ? 9.0 : 5.0,  // Temporary score mapping
              pass: simplified.pass,
              summary: simplified.context.split('\n')[0].replace(/^## Summary\s*/, ''),
              status: simplified.pass ? 'excellent' : 'needs_improvement',
              details: {
                strengths: [],
                issues: [],
                improvements: [],
                context_specific: {
                  confidence: simplified.confidence,
                  full_context: simplified.context
                }
              },
              metadata: {
                evaluation_time: executionTime,
                model_used: 'codex-1',
                format_version: 'simplified',
                parsing_method: simplified.metadata?.parsing_method || 'json',
                schema_version: 'v3'
              }
            };
            resolve(response);
          } else {
            // Traditional format response
            const response: EvaluationResponse = {
              // 必須フィールド
              score: evaluation.score ?? 5.0,
              pass: evaluation.pass ?? (evaluation.score >= targetScore),
              
              // コアフィールド
              summary: evaluation.summary ?? '',
              status: evaluation.status ?? this.getStatusFromScore(evaluation.score),
              details: evaluation.details ?? {
                strengths: [],
                issues: [],
                improvements: [],
                context_specific: {}
              },
              
              // メタデータ
              metadata: {
                evaluation_time: executionTime,
                model_used: 'codex-1',
                parsing_method: evaluation.metadata?.parsing_method,
                schema_version: 'v3'
              }
            };
            
            resolve(response);
          }
        } catch (parseError) {
          reject({
            code: -32603,
            message: 'Failed to parse Codex output',
            data: {
              details: parseError instanceof Error ? parseError.message : 'Parsing error',
              rawOutput: stdout.substring(0, 500), // デバッグ用に最初の500文字
              retryable: true
            }
          });
        }
      });
      
      // エラーハンドリング
      codexProcess.on('error', (error) => {
        clearTimeout(timeoutId);  // タイムアウトをクリア
        processKilled = true;
        
        if (error.message.includes('ENOENT')) {
          reject({
            code: -32603,
            message: 'Codex CLI not found',
            data: {
              details: 'Please install by running: npm install -g @openai/codex',
              retryable: false
            }
          });
        } else {
          reject({
            code: -32603,
            message: 'Codex CLI execution error',
            data: {
              details: error.message,
              retryable: true
            }
          });
        }
      });
    });
  }

  private loadPromptTemplate(): string {
    // Get prompt file path from environment (default to English)
    const language = process.env.EVALUATION_LANGUAGE || 'en';
    const defaultPromptFile = language === 'en' 
      ? 'evaluation-prompt-filepath-en.txt'
      : 'evaluation-prompt-filepath.txt';
    const promptPath = process.env.EVALUATION_PROMPT_PATH || 
                      path.join(__dirname, '../prompts', defaultPromptFile);
    
    try {
      // プロンプトテンプレートをキャッシュから使用またはファイルから読み込み
      if (!this.promptTemplate) {
        if (fs.existsSync(promptPath)) {
          this.promptTemplate = fs.readFileSync(promptPath, 'utf-8');
          console.log(`Loaded prompt template: ${promptPath}`);
        } else {
          console.warn(`Prompt file not found: ${promptPath}. Using default prompt.`);
        }
      }
      return this.promptTemplate || this.getDefaultPromptTemplate();
    } catch (error) {
      console.error('Error loading prompt template:', error);
      return this.getDefaultPromptTemplate();
    }
  }

  private getDefaultPromptTemplate(): string {
    return `<task>
Evaluate the technical document.

<context>
Determine if the content has sufficient quality for implementation readiness.
</context>

<constraints>
- Read-only access (no modifications, creation, or deletion allowed)
- Ignore character encoding warnings or display issues
</constraints>

<process>
1. Understand the document type and purpose
2. Collect external information as needed (web search, official documentation, etc.)
3. Set appropriate evaluation criteria based on content and analyze
</process>

<evaluation_criteria>
Evaluate at least the following aspects:
- Implementation feasibility: Can it be realistically implemented?
- Technical validity: Is the approach appropriate?
- Information completeness: Are necessary details provided?

Autonomously add important evaluation criteria based on the document's nature.
(Examples: API design, security, performance, comparison of multiple approaches, etc.)
</evaluation_criteria>

<output_format>
{
  "score": number,
  "pass": boolean,
  "summary": string,
  "status": string,
  "details": {
    "strengths": array,
    "issues": array,
    "improvements": array,
    "context_specific": object
  }
}
</output_format>

Evaluation target:
{{document_content}}
</task>`;
  }

  private buildEvaluationPromptWithPath(filePath: string): string {
    // Load prompt template for file path evaluation
    // Default to simplified format for better performance
    const format = process.env.EVALUATION_FORMAT || 'simplified';
    const language = process.env.EVALUATION_LANGUAGE || 'en';
    
    let templateFile: string;
    if (format === 'simplified') {
      // Use simplified format
      templateFile = language === 'en' 
        ? 'evaluation-prompt-simplified-en.txt'
        : 'evaluation-prompt-simplified-ja.txt';  // Japanese version if needed
    } else {
      // Use traditional format
      templateFile = language === 'en' 
        ? 'evaluation-prompt-filepath-en.txt'
        : 'evaluation-prompt-filepath.txt';
    }
    
    const templatePath = path.join(__dirname, '..', 'prompts', templateFile);
    let template: string;
    
    if (fs.existsSync(templatePath)) {
      template = fs.readFileSync(templatePath, 'utf-8');
      console.log(`Loaded file path prompt template: ${templatePath}`);
    } else {
      // Fallback: modify default template
      template = this.loadPromptTemplate();
      template = template.replace('Target file:', `Target file: ${filePath}\n\nPlease read and evaluate this file.`);
      console.log('File path template not found, using modified default');
    }
    
    // Replace template variables
    template = template.replace(/\{\{document_path\}\}/g, filePath);
    
    return template;
  }

  private parseCodexOutput(output: string): any {
    try {
      console.log('Parsing Codex output...');
      
      // Check evaluation format first
      // Default to simplified format for better performance
      const evaluationFormat = process.env.EVALUATION_FORMAT || 'simplified';
      
      // メタデータを除去
      const cleanOutput = this.removeMetadata(output);
      
      if (evaluationFormat === 'simplified') {
        // Parse simplified format
        return this.parseSimplifiedFormat(cleanOutput);
      } else {
        // Traditional format parsing
        const evaluationMode = process.env.EVALUATION_MODE || 'flexible';
        
        // 柔軟なパース戦略
        if (evaluationMode === 'flexible') {
          return this.flexibleParse(output, cleanOutput);
        } else {
          // strictモード（従来のJSON厳密パース）
          return this.strictJSONParse(output, cleanOutput);
        }
      }
    } catch (error) {
      console.error('Error parsing Codex output:', error);
      console.error('Raw output (first 500 chars):', output.substring(0, 500));
      throw error;
    }
  }

  private getStatusFromScore(score: number): string {
    if (score >= 8) return 'excellent';
    if (score >= 6) return 'good';
    if (score >= 4) return 'needs_improvement';
    return 'poor';
  }

  private parseSimplifiedFormat(output: string): SimplifiedEvaluationResponse {
    try {
      // Try to find the last valid JSON object in the output
      // This handles cases where the prompt or metadata might contain JSON-like text
      let lastValidJson = null;
      let lastValidJsonString = '';

      // Find all potential JSON objects
      const jsonPattern = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
      const matches = output.match(jsonPattern);

      if (!matches) {
        throw new Error('No JSON found in output');
      }

      // Try to parse each match, keeping the last valid one
      for (const match of matches) {
        try {
          const parsed = JSON.parse(match);
          // Check if it looks like our expected format
          if ('pass' in parsed && 'context' in parsed) {
            lastValidJson = parsed;
            lastValidJsonString = match;
          }
        } catch {
          // Ignore invalid JSON and continue
        }
      }

      if (!lastValidJson) {
        throw new Error('No valid evaluation JSON found in output');
      }

      const parsed = lastValidJson;

      // Validate required fields
      if (typeof parsed.pass !== 'boolean') {
        throw new Error('Missing or invalid "pass" field');
      }

      // Set confidence with default if not provided
      const confidence = parsed.confidence || 'medium';
      if (!['high', 'medium', 'low'].includes(confidence)) {
        console.warn(`Invalid confidence value: ${confidence}, using 'medium'`);
        parsed.confidence = 'medium';
      }

      // Ensure context is a string
      if (typeof parsed.context !== 'string') {
        throw new Error('Missing or invalid "context" field');
      }

      // Return simplified response
      return {
        pass: parsed.pass,
        confidence: parsed.confidence,
        context: parsed.context,
        metadata: {
          format_version: 'simplified',
          parsing_method: 'json'
        }
      };
    } catch (error) {
      console.error('Failed to parse simplified format:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Fallback response
      return {
        pass: false,
        confidence: 'low',
        context: `## Summary\nFailed to parse evaluation result.\n\n## Error\n${errorMessage}\n\n## Raw Output\n\`\`\`\n${output.substring(0, 500)}\n\`\`\``,
        metadata: {
          format_version: 'simplified',
          parsing_method: 'fallback'
        }
      };
    }
  }

  private removeMetadata(output: string): string {
    const lines = output.split('\n');
    const contentLines = lines.filter(line => 
      !line.startsWith('[20') && // タイムスタンプ
      !line.startsWith('--------') &&
      !line.startsWith('workdir:') &&
      !line.startsWith('model:') &&
      !line.startsWith('provider:') &&
      !line.startsWith('approval:') &&
      !line.startsWith('sandbox:') &&
      !line.startsWith('reasoning') &&
      !line.startsWith('User instructions:') &&
      !line.startsWith('thinking') &&
      !line.startsWith('**') &&
      !line.startsWith('tokens used:') &&
      !line.startsWith('Reading prompt')
    );
    
    return contentLines.join('\n').trim();
  }

  private flexibleParse(rawOutput: string, cleanOutput: string): any {
    let result: any = {
      metadata: { parsing_method: 'flexible' }
    };

    // Step 1: JSON部分を探して必須フィールドを抽出
    const jsonData = this.extractJSONFromOutput(rawOutput, cleanOutput);
    if (jsonData) {
      // 新形式のフィールドを優先
      result.score = jsonData.score ?? 5.0;
      result.pass = jsonData.pass ?? (jsonData.score >= 8);
      result.summary = jsonData.summary ?? jsonData.conclusion ?? '';
      result.status = jsonData.status ?? this.getStatusFromScore(jsonData.score);
      result.details = jsonData.details ?? {
        strengths: [],
        issues: [],
        improvements: [],
        context_specific: {}
      };
      
      // その他のJSONフィールドをマージ
      Object.assign(result, jsonData);
      result.metadata.parsing_method = 'json';
    }

    // Step 2: 構造化テキストから追加情報を抽出
    const structuredData = this.parseStructuredText(cleanOutput);
    
    // JSONで取得できなかったフィールドを補完
    if (result.score === undefined && structuredData.score !== undefined) {
      result.score = structuredData.score;
    }
    if (result.pass === undefined && result.score !== undefined) {
      result.pass = result.score >= 8;  // デフォルトは8以上で合格
    }
    if (!result.summary && structuredData.summary !== undefined) {
      result.summary = structuredData.summary;
    }
    
    // 構造化データをマージ（既存フィールドは上書きしない）
    for (const [key, value] of Object.entries(structuredData)) {
      if (!(key in result) && value !== undefined) {
        result[key] = value;
      }
    }
    
    // 必須フィールドのデフォルト値
    if (result.score === undefined) {
      result.score = 5.0;
      console.warn('scoreが見つからないため、5.0に設定');
    }
    if (result.pass === undefined) {
      result.pass = result.score >= 8;
    }
    if (result.status === undefined) {
      result.status = this.getStatusFromScore(result.score);
    }
    if (result.summary === undefined) {
      result.summary = '評価が完了しました。';
    }
    if (result.details === undefined) {
      result.details = {
        strengths: [],
        issues: [],
        improvements: [],
        context_specific: {}
      };
    }
    
    return result;
  }

  private parseStructuredText(text: string): any {
    const result: any = {};
    
    // セクションベースの解析
    const sections = this.extractSections(text);
    
    // 「結論」セクションを探す
    if (sections['結論'] || sections['conclusion']) {
      result.conclusion = sections['結論'] || sections['conclusion'];
    }
    
    // 「根拠」セクションを探す
    if (sections['根拠'] || sections['rationale']) {
      result.rationale = sections['根拠'] || sections['rationale'];
    }
    
    // 「分析」「現状」セクション
    if (sections['分析'] || sections['analysis'] || sections['現状分析']) {
      result.analysis = sections['分析'] || sections['analysis'] || sections['現状分析'];
    }
    
    // 「推奨事項」「改善提案」セクション
    if (sections['推奨事項'] || sections['recommendations'] || sections['改善提案']) {
      result.recommendations = sections['推奨事項'] || sections['recommendations'] || sections['改善提案'];
    }
    
    // 実装可否の判定を探す
    const implPatterns = [
      /実装に移れ(る|ます)/,
      /実装可能/,
      /ready\s+for\s+implementation/i,
      /can\s+proceed\s+with\s+implementation/i
    ];
    
    for (const pattern of implPatterns) {
      const match = text.match(pattern);
      if (match) {
        result.ready_for_implementation = true;
        break;
      }
    }
    
    // スコアを探す
    const scorePatterns = [
      /(?:総合)?(?:評価)?スコア[：:]\s*(\d+(?:\.\d+)?)/,
      /score[：:]\s*(\d+(?:\.\d+)?)/i,
      /(\d+(?:\.\d+)?)\s*\/\s*10/
    ];
    
    for (const pattern of scorePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        result.score = parseFloat(match[1]);
        break;
      }
    }
    
    return result;
  }

  private extractSections(text: string): { [key: string]: string } {
    const sections: { [key: string]: string } = {};
    
    // セクションヘッダーのパターン
    const sectionPattern = /^([^：:\n]+)[：:]\s*$/gm;
    const matches = Array.from(text.matchAll(sectionPattern));
    
    for (let i = 0; i < matches.length; i++) {
      const sectionName = matches[i][1].trim();
      const startIdx = matches[i].index! + matches[i][0].length;
      const endIdx = (i < matches.length - 1) ? matches[i + 1].index! : text.length;
      
      sections[sectionName] = text.substring(startIdx, endIdx).trim();
    }
    
    // 箇条書きセクションも抽出
    const bulletPattern = /^[-・■□◆◇*]\s*([^：:]+)[：:]\s*(.+)$/gm;
    const bulletMatches = Array.from(text.matchAll(bulletPattern));
    
    for (const match of bulletMatches) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (!sections[key]) {
        sections[key] = value;
      }
    }
    
    return sections;
  }

  private extractJSONFromOutput(rawOutput: string, cleanOutput: string): any | null {
    let jsonStr: string | null = null;
    
    // 最後の "codex" マーカー以降のコンテンツを探す
    const codexMarkerIndex = rawOutput.lastIndexOf('] codex\n');
    if (codexMarkerIndex !== -1) {
      const afterCodex = rawOutput.substring(codexMarkerIndex + 8); // "] codex\n" の長さ
        const jsonStart = afterCodex.indexOf('{');
        if (jsonStart !== -1) {
          // JSON終了位置を見つける
          let depth = 0;
          let endIdx = -1;
          let inString = false;
          let escapeNext = false;
          
          for (let i = jsonStart; i < afterCodex.length; i++) {
            const char = afterCodex[i];
            
            if (escapeNext) {
              escapeNext = false;
              continue;
            }
            
            if (char === '\\') {
              escapeNext = true;
              continue;
            }
            
            if (char === '"' && !escapeNext) {
              inString = !inString;
              continue;
            }
            
            if (!inString) {
              if (char === '{') depth++;
              if (char === '}') {
                depth--;
                if (depth === 0) {
                  endIdx = i;
                  break;
                }
              }
            }
          }
          
          if (endIdx !== -1) {
            jsonStr = afterCodex.substring(jsonStart, endIdx + 1);
          }
        }
      }
      
      // フォールバック: 全体から最初のJSONを探す
      if (!jsonStr) {
        const jsonStart = cleanOutput.indexOf('{');
        if (jsonStart !== -1) {
          let depth = 0;
          let endIdx = -1;
          let inString = false;
          let escapeNext = false;
          
          for (let i = jsonStart; i < cleanOutput.length; i++) {
            const char = cleanOutput[i];
            
            if (escapeNext) {
              escapeNext = false;
              continue;
            }
            
            if (char === '\\') {
              escapeNext = true;
              continue;
            }
            
            if (char === '"' && !escapeNext) {
              inString = !inString;
              continue;
            }
            
            if (!inString) {
              if (char === '{') depth++;
              if (char === '}') {
                depth--;
                if (depth === 0) {
                  endIdx = i;
                  break;
                }
              }
            }
          }
          
          if (endIdx !== -1) {
            jsonStr = cleanOutput.substring(jsonStart, endIdx + 1);
          }
        }
      }
    
    if (!jsonStr) {
      return null;  // JSONが見つからない場合はnullを返す
    }
    
    try {
      const parsed = JSON.parse(jsonStr);
      return parsed;
    } catch (error) {
      console.warn('JSON解析エラー:', error);
      return null;
    }
  }

  private strictJSONParse(rawOutput: string, cleanOutput: string): any {
    // JSON厳密パース
    const jsonData = this.extractJSONFromOutput(rawOutput, cleanOutput);
    
    if (!jsonData) {
      throw new Error('有効なJSON出力が見つかりません');
    }
    
    // 結果の正規化
    const result: any = {
      score: jsonData.score ?? 5.0,
      pass: jsonData.pass,
      summary: jsonData.summary,
      status: jsonData.status,
      details: jsonData.details ?? {
        strengths: [],
        issues: [],
        improvements: [],
        context_specific: {}
      },
      metadata: { parsing_method: 'json' }
    };

    return result;
  }
}