import { spawn } from 'child_process';
import { EvaluationRequest, EvaluationResponse, EvaluationRubric } from './types';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// .env ファイルを読み込み
dotenv.config();

export class CodexEvaluator {
  private readonly defaultRubric: EvaluationRubric = {
    completeness: 0.3,
    accuracy: 0.3,
    clarity: 0.2,
    usability: 0.2
  };
  private maxRetries = 2;
  private retryDelay = 1000; // 初期遅延1秒
  private promptTemplate: string | null = null;
  private codexTimeout: number;
  private codexMaxBuffer: number;
  private targetScore: number;

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

  async evaluate(request: EvaluationRequest): Promise<EvaluationResponse> {
    const targetScore = request.target_score || this.targetScore;
    
    // 評価プロンプトの構築
    const evaluationPrompt = this.buildEvaluationPrompt(request.content);
    
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
        '--full-auto',  // フルオートモードで実行
        '--skip-git-repo-check'  // Gitリポジトリチェックをスキップ
      ];
      
      // --format jsonオプションが利用可能な場合は追加
      // （Codex CLIのバージョンによってはサポートされていない可能性がある）
      if (process.env.CODEX_SUPPORTS_JSON_FORMAT !== 'false') {
        codexArgs.push('--format', 'json');
      }
      
      // 作業ディレクトリを設定（project_pathが指定されている場合はそれを使用）
      const workingDirectory = projectPath || process.cwd();
      console.log(`Codex作業ディレクトリ: ${workingDirectory}`);
      
      // CodexにREAD-ONLYサンドボックスを設定するための環境変数
      const codexEnv = {
        ...process.env,
        CODEX_SANDBOX_MODE: 'workspace-read',  // 読み取り専用モードを示唆
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
      
      // 標準出力を収集（バッファサイズ制限付き）
      codexProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        if (stdout.length + chunk.length <= this.codexMaxBuffer) {
          stdout += chunk;
        } else {
          console.warn('出力バッファが上限に達しました');
        }
      });
      
      // エラー出力を収集
      codexProcess.stderr.on('data', (data) => {
        stderr += data.toString();
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
          
          // レスポンスの構築
          const response: EvaluationResponse = {
            ready_for_implementation: evaluation.ready_for_implementation ?? (evaluation.score >= targetScore),
            score: evaluation.score,
            rubric_scores: evaluation.rubric_scores,
            pass: evaluation.score >= targetScore,
            suggestions: evaluation.suggestions,
            // Codexの詳細分析を追加
            conclusion: evaluation.conclusion,
            rationale: evaluation.rationale,
            analysis: evaluation.analysis,
            recommendations: evaluation.recommendations,
            blockers: evaluation.blockers,
            metadata: {
              evaluation_time: executionTime,
              model_used: 'codex-1',
              parsing_method: evaluation.metadata?.parsing_method
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
    // 環境変数からプロンプトファイルパスを取得
    const promptPath = process.env.EVALUATION_PROMPT_PATH || 
                      path.join(__dirname, '../prompts/evaluation-prompt.txt');
    
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
    return `以下のドキュメント/実装プランを評価してください。

必須項目（JSONフォーマットで含めてください）:
{
  "ready_for_implementation": <実装に移れるか true/false>,
  "score": <総合評価スコア 0-10>
}

上記の必須項目以外は、評価内容に応じて適切な形式で分析結果を提供してください。

評価対象:
{{document_content}}`;
  }

  private buildEvaluationPrompt(content: string): string {
    // プロンプトテンプレートを読み込み
    let template = this.loadPromptTemplate();
    
    // テンプレート変数を置換
    template = template.replace(/\{\{document_content\}\}/g, content);
    
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
      // 必須フィールドを確認
      result.ready_for_implementation = jsonData.ready_for_implementation ?? false;
      result.score = jsonData.score ?? 5.0;
      
      // その他のJSONフィールドをマージ
      Object.assign(result, jsonData);
      result.metadata.parsing_method = 'json';
    }

    // Step 2: 構造化テキストから追加情報を抽出
    const structuredData = this.parseStructuredText(cleanOutput);
    
    // JSONで取得できなかったフィールドを補完
    if (!result.ready_for_implementation && structuredData.ready_for_implementation !== undefined) {
      result.ready_for_implementation = structuredData.ready_for_implementation;
    }
    if (!result.score && structuredData.score !== undefined) {
      result.score = structuredData.score;
    }
    
    // 構造化データをマージ（既存フィールドは上書きしない）
    for (const [key, value] of Object.entries(structuredData)) {
      if (!(key in result) && value !== undefined) {
        result[key] = value;
      }
    }
    
    // 必須フィールドのデフォルト値
    if (result.ready_for_implementation === undefined) {
      result.ready_for_implementation = false;
      console.warn('ready_for_implementationが見つからないため、falseに設定');
    }
    if (result.score === undefined) {
      result.score = 5.0;
      console.warn('scoreが見つからないため、5.0に設定');
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
    // 従来のJSON厳密パース
    const jsonData = this.extractJSONFromOutput(rawOutput, cleanOutput);
    
    if (!jsonData) {
      throw new Error('有効なJSON出力が見つかりません');
    }
    
    // 結果の正規化（新旧両方のフォーマットに対応）
    const result: any = {
      score: jsonData.score ?? jsonData.overall_score ?? 5.0,
      metadata: { parsing_method: 'json' }
    };

    // 新形式のフィールド
    if ('ready_for_implementation' in jsonData) {
      result.ready_for_implementation = jsonData.ready_for_implementation;
    }
    if (jsonData.blockers) {
      result.blockers = jsonData.blockers;
    }
    if (jsonData.recommended_approach) {
      result.recommended_approach = jsonData.recommended_approach;
    }

    // 旧形式のフィールド（後方互換性）
    if (jsonData.rubric_scores) {
      result.rubric_scores = jsonData.rubric_scores;
    } else if (jsonData.completeness || jsonData.accuracy || jsonData.clarity || jsonData.usability) {
      result.rubric_scores = {
        completeness: jsonData.completeness ?? 5.0,
        accuracy: jsonData.accuracy ?? 5.0,
        clarity: jsonData.clarity ?? 5.0,
        usability: jsonData.usability ?? 5.0
      };
    }
    
    if (jsonData.suggestions || jsonData.recommendations || jsonData.reasons) {
      result.suggestions = jsonData.suggestions || jsonData.recommendations || jsonData.reasons || [];
    }

    return result;
  }
}