import { spawn } from 'child_process';
import { EvaluationRequest, EvaluationResponse, EvaluationRubric } from './types';
import * as path from 'path';
import * as fs from 'fs';

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
    // weightsが指定されている場合は使用、そうでなければrubricまたはデフォルトを使用
    let rubric: EvaluationRubric;
    if (request.weights) {
      // weightsを正規化（%表記から小数へ）
      const total = request.weights.completeness + request.weights.accuracy + 
                   request.weights.clarity + request.weights.usability;
      rubric = {
        completeness: request.weights.completeness / total,
        accuracy: request.weights.accuracy / total,
        clarity: request.weights.clarity / total,
        usability: request.weights.usability / total
      };
    } else {
      rubric = request.rubric || this.defaultRubric;
    }
    
    const targetScore = request.target_score || this.targetScore;
    
    // 評価プロンプトの構築
    const evaluationPrompt = this.buildEvaluationPrompt(request.content, rubric);
    
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
        timeout: this.codexTimeout,  // 環境変数から設定
        env: codexEnv,
        cwd: workingDirectory  // 指定されたプロジェクトパスで実行
      });
      
      let stdout = '';
      let stderr = '';
      
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
            score: evaluation.score,
            rubric_scores: evaluation.rubric_scores,
            pass: evaluation.score >= targetScore,
            suggestions: evaluation.suggestions,
            metadata: {
              evaluation_time: executionTime,
              model_used: 'codex-1'
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
    return `以下のドキュメントを評価し、JSON形式で結果を返してください。

評価基準と重み:
- 完全性 ({{completeness_weight}}%): すべての要求事項がカバーされているか
- 正確性 ({{accuracy_weight}}%): 技術的に正確か
- 明確性 ({{clarity_weight}}%): 理解しやすいか
- 実用性 ({{usability_weight}}%): 実装可能か

評価対象ドキュメント:
{{document_content}}

以下の形式でJSONを返してください:
{
  "overall_score": 0-10の数値,
  "rubric_scores": {
    "completeness": 0-10の数値,
    "accuracy": 0-10の数値,
    "clarity": 0-10の数値,
    "usability": 0-10の数値
  },
  "suggestions": [
    "改善提案1",
    "改善提案2",
    ...
  ]
}`;
  }

  private buildEvaluationPrompt(content: string, rubric: EvaluationRubric): string {
    // プロンプトテンプレートを読み込み
    let template = this.loadPromptTemplate();
    
    // テンプレート変数を置換
    template = template
      .replace(/\{\{completeness_weight\}\}/g, String(rubric.completeness * 100))
      .replace(/\{\{accuracy_weight\}\}/g, String(rubric.accuracy * 100))
      .replace(/\{\{clarity_weight\}\}/g, String(rubric.clarity * 100))
      .replace(/\{\{usability_weight\}\}/g, String(rubric.usability * 100))
      .replace(/\{\{document_content\}\}/g, content);
    
    return template;
  }

  private parseCodexOutput(output: string): any {
    try {
      // Codexの出力から必要な情報を抽出
      console.log('Codex出力解析中...');
      
      // 1. Codexのメタデータ行を除去（[timestamp]で始まる行）
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
      
      const cleanOutput = contentLines.join('\n').trim();
      
      // 2. JSON部分を抽出
      let jsonStr: string | null = null;
      
      // 最後の "codex" マーカー以降のコンテンツを探す
      const codexMarkerIndex = output.lastIndexOf('] codex\n');
      if (codexMarkerIndex !== -1) {
        const afterCodex = output.substring(codexMarkerIndex + 8); // "] codex\n" の長さ
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
        throw new Error('有効なJSON出力が見つかりません');
      }
      
      // JSONパース
      const parsed = JSON.parse(jsonStr);
      
      // 結果の正規化（フィールド名の違いに対応）
      return {
        score: parsed.score ?? parsed.overall_score ?? 5.0,
        rubric_scores: parsed.rubric_scores || {
          completeness: parsed.completeness ?? 5.0,
          accuracy: parsed.accuracy ?? 5.0,
          clarity: parsed.clarity ?? 5.0,
          usability: parsed.usability ?? 5.0
        },
        suggestions: parsed.suggestions || parsed.recommendations || parsed.reasons || []
      };
    } catch (error) {
      console.error('Codex出力の解析エラー:', error);
      console.error('生の出力（最初の500文字）:', output.substring(0, 500));
      
      // エラーを再スロー（呼び出し元で処理）
      throw error;
    }
  }
}