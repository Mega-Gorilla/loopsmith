// 統合サーバー: MCPサーバー + ダッシュボード
import { CodexEvaluator as RealCodexEvaluator } from './codex-evaluator';
import { CodexEvaluatorMock } from './codex-evaluator-mock';
import { ResultFormatter } from './result-formatter';
import { EvaluationRequest, MCPMessage } from './types';
import * as winston from 'winston';
import * as dotenv from 'dotenv';
import * as WebSocket from 'ws';
import { DashboardServer } from './dashboard';

dotenv.config();

// USE_MOCK_EVALUATOR環境変数でモック/本番を切り替え
const useMock = process.env.USE_MOCK_EVALUATOR === 'true';
const CodexEvaluator = useMock ? CodexEvaluatorMock : RealCodexEvaluator;

if (useMock) {
  console.log('⚠️  モック評価器を使用しています (USE_MOCK_EVALUATOR=true)');
}

// ロガー設定
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      if (typeof message === 'string') {
        message = message.replace(/OPENAI_API_KEY=[\w-]+/g, 'OPENAI_API_KEY=[REDACTED]');
      }
      return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'mcp-server.log' })
  ]
});

class IntegratedServer {
  private wss!: WebSocket.Server;
  private evaluator: InstanceType<typeof CodexEvaluator>;
  private formatter: ResultFormatter;
  private clients: Map<WebSocket, any> = new Map();
  private dashboard: DashboardServer;
  private currentEvaluation: any = null;

  constructor() {
    this.evaluator = new CodexEvaluator();
    this.formatter = new ResultFormatter(process.env.MCP_OUTPUT_FORMAT);
    
    // ダッシュボードサーバー初期化
    const dashboardPort = parseInt(process.env.DASHBOARD_PORT || '3000');
    this.dashboard = new DashboardServer(dashboardPort);
    
    // ダッシュボードを起動
    this.dashboard.start();
    
    // MCPサーバーを起動
    this.startWebSocketServer();
  }

  private async handleMessage(ws: WebSocket, message: MCPMessage) {
    logger.debug('受信メッセージ:', message);
    
    // ダッシュボードにログ送信
    this.dashboard.logMessage('info', `MCPメッセージ受信: ${message.method || 'unknown'}`);

    if (!message.method) {
      return;
    }

    switch (message.method) {
      case 'initialize':
        this.sendMessage(ws, {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: {
              name: 'loopsmith-with-dashboard',
              version: '1.0.0'
            },
            capabilities: {
              tools: {
                listChanged: false
              }
            }
          }
        });
        break;

      case 'tools/list':
        this.sendMessage(ws, {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            tools: [
              {
                name: 'evaluate_document',
                description: 'ドキュメントの品質を評価',
                inputSchema: {
                  type: 'object',
                  properties: {
                    document_path: {
                      type: 'string',
                      description: '評価対象ドキュメントのファイルパス'
                    },
                    target_score: {
                      type: 'number',
                      default: 8.0,
                      description: '目標スコア'
                    },
                    project_path: {
                      type: 'string',
                      description: 'プロジェクトディレクトリパス（読み取り専用アクセス）'
                    }
                  },
                  required: ['document_path']
                }
              },
              {
                name: 'get_improvement_suggestions',
                description: '改善提案を取得',
                inputSchema: {
                  type: 'object',
                  properties: {
                    content: {
                      type: 'string',
                      description: '現在のドキュメント'
                    },
                    previous_score: {
                      type: 'number',
                      description: '前回の評価スコア'
                    }
                  },
                  required: ['content']
                }
              }
            ]
          }
        });
        break;

      case 'tools/call':
        await this.handleToolCall(ws, message);
        break;

      default:
        this.sendError(ws, message.id, -32601, 'Method not found');
    }
  }

  private async handleToolCall(ws: WebSocket, message: MCPMessage) {
    const { name, arguments: args } = message.params || {};
      
    logger.info(`ツール呼び出し: ${name}`);
    this.dashboard.logMessage('info', `ツール呼び出し: ${name}`);
    
    if (logger.level === 'debug') {
      logger.debug('引数:', args);
    }

    try {
      switch (name) {
        case 'evaluate_document': {
          const evalRequest: EvaluationRequest = args as EvaluationRequest;
          
          // ダッシュボードに評価開始を通知（適切なオブジェクト形式で）
          this.dashboard.startEvaluation({
            document: `File: ${evalRequest.document_path}`,
            projectPath: evalRequest.project_path,
            targetScore: evalRequest.target_score
          });
          
          // 進捗を定期的に更新
          let progress = 0;
          const progressInterval = setInterval(() => {
            progress += 10;
            if (progress <= 90) {
              this.dashboard.updateProgress(progress);
            }
          }, 2000);
          
          try {
            const result = await this.evaluator.evaluate(evalRequest);
            
            clearInterval(progressInterval);
            
            // ダッシュボードに評価完了を通知
            this.dashboard.completeEvaluation(result);
            
            logger.info(`評価完了: スコア=${result.score}, 合格=${result.pass}`);
            
            this.sendMessage(ws, {
              jsonrpc: '2.0',
              id: message.id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                  }
                ]
              }
            });
          } catch (error: any) {
            clearInterval(progressInterval);
            this.dashboard.errorEvaluation(error);
            throw error;
          }
          break;
        }

        case 'get_improvement_suggestions': {
          const suggestions = await this.generateSuggestions(
            args.content as string,
            args.previous_score as number
          );
          
          this.dashboard.logMessage('info', `改善提案生成完了: ${suggestions.length}件`);
          
          this.sendMessage(ws, {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ suggestions }, null, 2)
                }
              ]
            }
          });
          break;
        }

        default:
          this.sendError(ws, message.id, -32602, `Unknown tool: ${name}`);
      }
    } catch (error: any) {
      logger.error(`ツール実行エラー: ${error.message}`);
      this.dashboard.logMessage('error', `ツール実行エラー: ${error.message}`);
      
      // エラーもフォーマット
      const formattedError = this.formatter.formatError(error);
      
      // JSON-RPC準拠のエラーレスポンス
      this.sendError(
        ws, 
        message.id, 
        error.code || -32603, 
        error.message || 'ツール実行に失敗しました',
        { 
          formatted: formattedError,
          ...error.data 
        }
      );
    }
  }

  private sendMessage(ws: WebSocket, message: MCPMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      logger.debug('送信メッセージ:', message);
    }
  }

  private sendError(ws: WebSocket, id: any, code: number, message: string, data?: any) {
    this.sendMessage(ws, {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        data
      }
    });
  }

  private async startWebSocketServer() {
    const port = parseInt(process.env.MCP_PORT || '23100');
    
    // WebSocketサーバー作成
    this.wss = new WebSocket.Server({
      port,
      path: '/mcp'
    });

    this.wss.on('connection', (ws: WebSocket) => {
      logger.info('新しいクライアント接続');
      this.dashboard.logMessage('info', 'MCPクライアント接続');
      this.clients.set(ws, {});

      ws.on('message', async (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as MCPMessage;
          await this.handleMessage(ws, message);
        } catch (error: any) {
          logger.error('メッセージ処理エラー:', error);
          this.dashboard.logMessage('error', `メッセージ処理エラー: ${error.message}`);
          this.sendError(ws, null, -32700, 'Parse error');
        }
      });

      ws.on('close', () => {
        logger.info('クライアント切断');
        this.dashboard.logMessage('info', 'MCPクライアント切断');
        this.clients.delete(ws);
      });

      ws.on('error', (error: Error) => {
        logger.error('WebSocketエラー:', error);
        this.dashboard.logMessage('error', `WebSocketエラー: ${error.message}`);
      });
    });

    logger.info(`MCPサーバー起動: ws://localhost:${port}/mcp`);
    this.dashboard.logMessage('success', `MCPサーバー起動: ws://localhost:${port}/mcp`);
  }

  private async generateSuggestions(content: string, previousScore: number): Promise<string[]> {
    const suggestions: string[] = [];
    
    if (previousScore < 5) {
      suggestions.push('基本的な構造と内容を見直してください');
    }
    
    if (content.length < 500) {
      suggestions.push('より詳細な説明を追加してください');
    }
    
    if (!content.includes('```')) {
      suggestions.push('コード例を追加してください');
    }
    
    if (!content.includes('##')) {
      suggestions.push('セクション構造を明確にしてください');
    }
    
    return suggestions;
  }

  public async shutdown() {
    logger.info('サーバーシャットダウン中...');
    this.dashboard.logMessage('warning', 'サーバーシャットダウン開始');
    
    this.clients.forEach((_, ws) => ws.close());
    this.wss.close();
    this.dashboard.stop();
  }
}

// サーバー起動
const server = new IntegratedServer();

// グレースフルシャットダウン
process.on('SIGINT', async () => {
  await server.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.shutdown();
  process.exit(0);
});

export default IntegratedServer;