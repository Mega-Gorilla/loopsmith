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

  async evaluate(request: EvaluationRequest): Promise<EvaluationResponse> {
    const rubric = request.rubric || this.defaultRubric;
    const targetScore = request.target_score || 8.0;
    
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
        const result = await this.executeCodex(evaluationPrompt, targetScore);
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

  private async executeCodex(evaluationPrompt: string, targetScore: number): Promise<EvaluationResponse> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      // spawnを使用してより堅牢な実行（Windows対応）
      const isWindows = process.platform === 'win32';
      const codexCommand = isWindows ? 'codex.cmd' : 'codex';
      
      // Codex CLIの最新形式に対応
      const codexProcess = spawn(codexCommand, [
        'exec',
        '--full-auto',  // フルオートモードで実行
        '--skip-git-repo-check'  // Gitリポジトリチェックをスキップ
      ], {
        shell: isWindows, // Windowsではshellをtrueに
        windowsHide: true,
        timeout: 120000, // 120秒タイムアウト
        env: { ...process.env },
        cwd: process.cwd()  // 作業ディレクトリを明示的に設定
      });
      
      let stdout = '';
      let stderr = '';
      
      // 標準出力を収集
      codexProcess.stdout.on('data', (data) => {
        stdout += data.toString();
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
      // 改善されたJSON抽出ロジック
      // 1. 先頭の非JSON文字を除去
      const cleanOutput = output.trim();
      
      // 2. 複数のJSON抽出戦略を試行
      let jsonStr: string | null = null;
      
      // 戦略1: 完全なJSONブロックを探す（最初の{から対応する}まで）
      const startIdx = cleanOutput.indexOf('{');
      if (startIdx !== -1) {
        let depth = 0;
        let endIdx = -1;
        let inString = false;
        let escapeNext = false;
        
        for (let i = startIdx; i < cleanOutput.length; i++) {
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
          jsonStr = cleanOutput.substring(startIdx, endIdx + 1);
        }
      }
      
      // 戦略2: 正規表現によるフォールバック
      if (!jsonStr) {
        const jsonMatch = cleanOutput.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }
      }
      
      if (!jsonStr) {
        throw new Error('有効なJSON出力が見つかりません');
      }
      
      // JSONパース
      const parsed = JSON.parse(jsonStr);
      
      // 結果の正規化
      return {
        score: parsed.overall_score ?? parsed.score ?? 0,
        rubric_scores: parsed.rubric_scores || {
          completeness: parsed.completeness ?? 0,
          accuracy: parsed.accuracy ?? 0,
          clarity: parsed.clarity ?? 0,
          usability: parsed.usability ?? 0
        },
        suggestions: parsed.suggestions || parsed.improvements || []
      };
    } catch (error) {
      console.error('Codex出力の解析エラー:', error);
      console.error('生の出力（最初の200文字）:', output.substring(0, 200));
      
      // エラーを再スロー（呼び出し元で処理）
      throw error;
    }
  }
}