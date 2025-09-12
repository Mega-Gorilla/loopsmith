import { spawn } from 'child_process';
import { EvaluationRequest, EvaluationResponse } from './types';
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
  private cacheEnabled = process.env.CODEX_CACHE_ENABLED !== 'false';

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
            console.log('キャッシュから結果を返却');
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
      console.log(`ファイルパスモード使用: ${request.document_path}`);
    }
    const evaluationPrompt = this.buildEvaluationPromptWithPath(request.document_path);
    
    // 再試行ロジック付き実行
    let lastError: any;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // 指数バックオフ
        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        console.log(`再試行 ${attempt}/${this.maxRetries}...`);
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
        console.error(`Codex実行失敗 (試行 ${attempt + 1}):`, error);
        
        // 再試行不可能なエラーの場合は即座に失敗
        if (error && typeof error === 'object' && 'retryable' in error && error.retryable === false) {
          throw error;
        }
      }
    }
    
    // すべての再試行が失敗
    throw {
      code: -32603,
      message: 'Codex評価に失敗しました（再試行後）',
      data: {
        details: lastError instanceof Error ? lastError.message : '不明なエラー',
        retryable: false,
        attempts: this.maxRetries + 1
      }
    };
  }

  private async executeCodex(evaluationPrompt: string, targetScore: number, projectPath?: string): Promise<EvaluationResponse> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      console.log(`Codex評価開始 - タイムアウト設定: ${this.codexTimeout}ms (${this.codexTimeout / 1000}秒)`);
      
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
        console.log(`Codex作業ディレクトリ: ${workingDirectory}`);
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
        cwd: workingDirectory  // 指定されたプロジェクトパスで実行
      });
      
      let stdout = '';
      let stderr = '';
      let processKilled = false;
      
      // タイムアウト処理を手動で実装
      const timeoutId = setTimeout(() => {
        if (!processKilled) {
          processKilled = true;
          console.error(`Codexプロセスがタイムアウトしました (${this.codexTimeout}ms)`);
          codexProcess.kill('SIGTERM');
          
          // Windowsの場合、SIGTERMが効かない場合があるので強制終了
          setTimeout(() => {
            if (!codexProcess.killed) {
              codexProcess.kill('SIGKILL');
            }
          }, 5000);
          
          reject({
            code: -32603,
            message: `Codex評価がタイムアウトしました (${this.codexTimeout / 1000}秒)`,
            data: {
              details: `処理時間が設定値 ${this.codexTimeout}ms を超過しました`,
              timeout: this.codexTimeout,
              retryable: true
            }
          });
        }
      }, this.codexTimeout);
      
      // ストリームのエンコーディングを設定（バッファ変換オーバーヘッドを削減）
      codexProcess.stdout.setEncoding('utf8');
      codexProcess.stderr.setEncoding('utf8');
      
      // 標準出力を収集（バッファサイズ制限付き）
      codexProcess.stdout.on('data', (chunk) => {
        // setEncodingによりchunkは既に文字列
        if (stdout.length + chunk.length <= this.codexMaxBuffer) {
          stdout += chunk;
        } else {
          console.warn('出力バッファが上限に達しました');
        }
      });
      
      // エラー出力を収集
      codexProcess.stderr.on('data', (chunk) => {
        stderr += chunk;  // setEncodingにより既に文字列
      });
      
      // プロンプトを標準入力に書き込み
      codexProcess.stdin.write(evaluationPrompt);
      codexProcess.stdin.end();
      
      // プロセス終了時の処理
      codexProcess.on('close', (code) => {
        clearTimeout(timeoutId);  // タイムアウトをクリア
        
        if (processKilled) {
          return;  // タイムアウトで既に処理済み
        }
        
        const executionTime = Date.now() - startTime;
        
        if (code !== 0) {
          reject({
            code: -32603,
            message: `Codex CLIがエラーコード ${code} で終了しました`,
            data: {
              details: stderr || 'エラー詳細なし',
              exitCode: code,
              retryable: true
            }
          });
          return;
        }
        
        try {
          // Codexの出力を解析
          const evaluation = this.parseCodexOutput(stdout);
          
          // レスポンスの構築（新形式を優先）
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
        } catch (parseError) {
          reject({
            code: -32603,
            message: 'Codex出力の解析に失敗しました',
            data: {
              details: parseError instanceof Error ? parseError.message : '解析エラー',
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
            message: 'Codex CLIが見つかりません',
            data: {
              details: 'npm install -g @openai/codex を実行してインストールしてください',
              retryable: false
            }
          });
        } else {
          reject({
            code: -32603,
            message: 'Codex CLI実行エラー',
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
    // 環境変数からプロンプトファイルパスを取得（デフォルトは新しいファイルパス形式）
    const promptPath = process.env.EVALUATION_PROMPT_PATH || 
                      path.join(__dirname, '../prompts/evaluation-prompt-filepath.txt');
    
    try {
      // プロンプトテンプレートをキャッシュから使用またはファイルから読み込み
      if (!this.promptTemplate) {
        if (fs.existsSync(promptPath)) {
          this.promptTemplate = fs.readFileSync(promptPath, 'utf-8');
          console.log(`プロンプトテンプレートを読み込みました: ${promptPath}`);
        } else {
          console.warn(`プロンプトファイルが見つかりません: ${promptPath}。デフォルトプロンプトを使用します。`);
        }
      }
      return this.promptTemplate || this.getDefaultPromptTemplate();
    } catch (error) {
      console.error('プロンプトテンプレート読み込みエラー:', error);
      return this.getDefaultPromptTemplate();
    }
  }

  private getDefaultPromptTemplate(): string {
    return `<task>
技術ドキュメントの評価を行います。

<context>
以下の内容が実装準備として十分な品質かを判定します。
</context>

<constraints>
- 読み取りのみ可能（修正・作成・削除は禁止）
- 文字エンコーディングの警告や表示上の文字化けは無視してください
</constraints>

<process>
1. ドキュメントの種類と目的を理解する
2. 必要に応じて外部情報を収集する（Web検索、公式ドキュメント等）
3. 内容に応じた適切な評価基準を設定し、分析する
</process>

<evaluation_criteria>
最低限、以下の観点を評価してください：
- 実装可能性：現実的に実装できるか
- 技術的妥当性：アプローチが適切か
- 情報の充足性：必要な詳細が記載されているか

ドキュメントの性質に応じて、重要な評価観点を自律的に追加してください。
（例：API設計、セキュリティ、パフォーマンス、複数案の比較など）
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

評価対象:
{{document_content}}
</task>`;
  }

  private buildEvaluationPromptWithPath(filePath: string): string {
    // ファイルパス用のプロンプトテンプレートを読み込み
    const templatePath = path.join(__dirname, '..', 'prompts', 'evaluation-prompt-filepath.txt');
    let template: string;
    
    if (fs.existsSync(templatePath)) {
      template = fs.readFileSync(templatePath, 'utf-8');
      console.log(`ファイルパス用プロンプトテンプレートを読み込みました: ${templatePath}`);
    } else {
      // フォールバック：デフォルトテンプレートを修正
      template = this.loadPromptTemplate();
      template = template.replace('評価対象:', `評価対象ファイル: ${filePath}\n\nこのファイルを読み込んで評価してください。`);
      console.log('ファイルパス用テンプレートが見つからないため、デフォルトを修正');
    }
    
    // テンプレート変数を置換
    template = template.replace(/\{\{document_path\}\}/g, filePath);
    
    return template;
  }

  private parseCodexOutput(output: string): any {
    try {
      console.log('Codex出力解析中...');
      
      // 評価モードを確認（デフォルト: flexible）
      const evaluationMode = process.env.EVALUATION_MODE || 'flexible';
      
      // メタデータを除去
      const cleanOutput = this.removeMetadata(output);
      
      // 柔軟なパース戦略
      if (evaluationMode === 'flexible') {
        return this.flexibleParse(output, cleanOutput);
      } else {
        // strictモード（従来のJSON厳密パース）
        return this.strictJSONParse(output, cleanOutput);
      }
    } catch (error) {
      console.error('Codex出力の解析エラー:', error);
      console.error('生の出力（最初の500文字）:', output.substring(0, 500));
      throw error;
    }
  }

  private getStatusFromScore(score: number): string {
    if (score >= 8) return 'excellent';
    if (score >= 6) return 'good';
    if (score >= 4) return 'needs_improvement';
    return 'poor';
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