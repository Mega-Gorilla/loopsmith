// 環境変数に基づいて評価器を選択
import { CodexEvaluator as RealCodexEvaluator } from './codex-evaluator';
import { CodexEvaluatorMock } from './codex-evaluator-mock';

// USE_MOCK_EVALUATOR環境変数でモック/本番を切り替え（デフォルトは本番）
const useMock = process.env.USE_MOCK_EVALUATOR === 'true';
const CodexEvaluator = useMock ? CodexEvaluatorMock : RealCodexEvaluator;

if (useMock) {
  console.log('⚠️  モック評価器を使用しています (USE_MOCK_EVALUATOR=true)');
}
import { EvaluationRequest, MCPMessage } from './types';
import * as winston from 'winston';
import * as dotenv from 'dotenv';
import * as WebSocket from 'ws';

dotenv.config();

// ロガー設定（APIキーマスキング付き）
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      // APIキーをマスク
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

class CodexMCPServer {
  private wss!: WebSocket.Server;
  private evaluator: InstanceType<typeof CodexEvaluator>;
  private clients: Map<WebSocket, any> = new Map();

  constructor() {
    this.evaluator = new CodexEvaluator();
    
    this.startWebSocketServer();
  }

  private async handleMessage(ws: WebSocket, message: MCPMessage) {
    logger.debug('受信メッセージ:', message);

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
              name: 'loopsmith',
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
                    content: {
                      type: 'string',
                      description: '評価対象のドキュメント内容'
                    },
                    rubric: {
                      type: 'object',
                      description: '評価基準（非推奨：weightsを使用してください）',
                      properties: {
                        completeness: { type: 'number' },
                        accuracy: { type: 'number' },
                        clarity: { type: 'number' },
                        usability: { type: 'number' }
                      }
                    },
                    weights: {
                      type: 'object',
                      description: '評価基準の重み（推奨）',
                      properties: {
                        completeness: { 
                          type: 'number',
                          description: '完全性の重み（0-100）',
                          default: 30
                        },
                        accuracy: { 
                          type: 'number',
                          description: '正確性の重み（0-100）',
                          default: 30
                        },
                        clarity: { 
                          type: 'number',
                          description: '明確性の重み（0-100）',
                          default: 20
                        },
                        usability: { 
                          type: 'number',
                          description: '実用性の重み（0-100）',
                          default: 20
                        }
                      }
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
                  required: ['content']
                }
              },
              {
                name: 'get_improvement_suggestions',
                description: '改善提案を取得（オプション）',
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
    if (logger.level === 'debug') {
      logger.debug('引数:', args);
    }

    try {
      switch (name) {
        case 'evaluate_document': {
          const evalRequest: EvaluationRequest = args as EvaluationRequest;
          const result = await this.evaluator.evaluate(evalRequest);
          
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
          break;
        }

        case 'get_improvement_suggestions': {
          const suggestions = await this.generateSuggestions(
            args.content as string,
            args.previous_score as number
          );
          
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
      this.sendError(ws, message.id, error.code || -32603, error.message || 'ツール実行に失敗しました', error.data);
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
      this.clients.set(ws, {});

      ws.on('message', async (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as MCPMessage;
          await this.handleMessage(ws, message);
        } catch (error: any) {
          logger.error('メッセージ処理エラー:', error);
          this.sendError(ws, null, -32700, 'Parse error');
        }
      });

      ws.on('close', () => {
        logger.info('クライアント切断');
        this.clients.delete(ws);
      });

      ws.on('error', (error: Error) => {
        logger.error('WebSocketエラー:', error);
      });
    });

    logger.info(`MCPサーバー起動: ws://localhost:${port}/mcp`);
  }

  private async generateSuggestions(content: string, previousScore: number): Promise<string[]> {
    // 簡易的な改善提案生成
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

  public shutdown() {
    logger.info('サーバーシャットダウン中...');
    this.clients.forEach((_, ws) => ws.close());
    this.wss.close();
  }
}

// サーバー起動
const server = new CodexMCPServer();

// グレースフルシャットダウン
process.on('SIGINT', async () => {
  await server.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.shutdown();
  process.exit(0);
});

export default CodexMCPServer;