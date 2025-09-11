import * as express from 'express';
import * as http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs';
import * as winston from 'winston';
import { EventEmitter } from 'events';

// ダッシュボードサーバークラス
export class DashboardServer extends EventEmitter {
  private app: express.Application;
  private server: http.Server;
  private io: SocketIOServer;
  private port: number;
  private evaluationHistory: any[] = [];
  private currentEvaluation: any = null;
  private logs: any[] = [];
  private maxLogs = 1000;
  private maxHistory = 50;
  
  // ロガー設定
  private logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console()
    ]
  });

  constructor(port: number = parseInt(process.env.DASHBOARD_PORT || '3000')) {
    super();
    this.port = port;
    this.app = express.default();
    this.server = http.createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
      }
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketIO();
    this.setupEventListeners();
  }

  private setupMiddleware() {
    // CORS設定
    this.app.use(cors({
      origin: 'http://localhost:3000'
    }));
    
    // JSON解析
    this.app.use(express.json());
    
    // 静的ファイルの提供
    const publicPath = path.join(__dirname, '../public');
    this.app.use(express.static(publicPath));
  }

  private setupRoutes() {
    // API: 評価履歴の取得
    this.app.get('/api/history', (req, res) => {
      res.json({
        history: this.evaluationHistory.slice(-10),
        stats: this.calculateStats()
      });
    });

    // API: 現在の評価状態
    this.app.get('/api/status', (req, res) => {
      res.json({
        current: this.currentEvaluation,
        serverStatus: 'running',
        connectedClients: this.io.sockets.sockets.size
      });
    });

    // API: ログの取得
    this.app.get('/api/logs', (req, res) => {
      const limit = parseInt(req.query.limit as string) || 100;
      res.json({
        logs: this.logs.slice(-limit)
      });
    });

    // API: 評価履歴のクリア
    this.app.post('/api/clear-history', (req, res) => {
      this.evaluationHistory = [];
      this.io.emit('history:cleared');
      res.json({ success: true });
    });

    // API: MCPサーバーからのイベント受信
    this.app.post('/api/event', (req, res) => {
      const { event, data, timestamp } = req.body;
      
      // Handle different event types
      switch (event) {
        case 'evaluation:start':
          this.startEvaluation(data.document);
          break;
        case 'evaluation:progress':
          this.updateProgress(data.progress);
          break;
        case 'evaluation:complete':
          this.completeEvaluation(data);
          break;
        case 'evaluation:error':
          this.errorEvaluation(data);
          break;
        default:
          this.logger.warn(`Unknown event type: ${event}`);
      }
      
      res.json({ success: true });
    });

    // ヘルスチェック
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', uptime: process.uptime() });
    });
  }

  private setupSocketIO() {
    this.io.on('connection', (socket) => {
      this.logger.info('ダッシュボードクライアント接続:', socket.id);
      
      // 初期データを送信
      socket.emit('initial:data', {
        logs: this.logs.slice(-50),
        history: this.evaluationHistory.slice(-10),
        current: this.currentEvaluation,
        stats: this.calculateStats()
      });

      // クライアント切断時
      socket.on('disconnect', () => {
        this.logger.info('ダッシュボードクライアント切断:', socket.id);
      });

      // ログフィルター要求
      socket.on('logs:filter', (filter: any) => {
        const filtered = this.filterLogs(filter);
        socket.emit('logs:filtered', filtered);
      });

      // 評価履歴詳細要求
      socket.on('history:detail', (id: string) => {
        const item = this.evaluationHistory.find(h => h.id === id);
        socket.emit('history:detail:response', item);
      });
    });
  }

  private setupEventListeners() {
    // ログイベントの処理
    this.on('log', (log: any) => {
      this.addLog(log);
      this.io.emit('log:new', log);
    });

    // 評価開始イベント
    this.on('evaluation:start', (data: any) => {
      this.currentEvaluation = {
        id: Date.now().toString(),
        startTime: new Date(),
        status: 'running',
        document: data.document?.substring(0, 100) + '...',
        progress: 0
      };
      this.io.emit('evaluation:started', this.currentEvaluation);
      this.addLog({
        level: 'info',
        message: '評価を開始しました',
        timestamp: new Date()
      });
    });

    // 評価進捗イベント
    this.on('evaluation:progress', (progress: number) => {
      if (this.currentEvaluation) {
        this.currentEvaluation.progress = progress;
        this.io.emit('evaluation:progress', progress);
      }
    });

    // 評価完了イベント
    this.on('evaluation:complete', (result: any) => {
      if (this.currentEvaluation) {
        const endTime = new Date();
        const duration = endTime.getTime() - this.currentEvaluation.startTime.getTime();
        
        const evaluation = {
          ...this.currentEvaluation,
          endTime,
          duration,
          status: 'completed',
          result,
          progress: 100
        };
        
        this.evaluationHistory.push(evaluation);
        if (this.evaluationHistory.length > this.maxHistory) {
          this.evaluationHistory.shift();
        }
        
        this.currentEvaluation = null;
        this.io.emit('evaluation:completed', evaluation);
        
        this.addLog({
          level: 'success',
          message: `評価完了: スコア ${result.score}/10`,
          timestamp: new Date()
        });
      }
    });

    // 評価エラーイベント
    this.on('evaluation:error', (error: any) => {
      if (this.currentEvaluation) {
        this.currentEvaluation.status = 'error';
        this.currentEvaluation.error = error;
        this.evaluationHistory.push(this.currentEvaluation);
        this.currentEvaluation = null;
        this.io.emit('evaluation:error', error);
        
        this.addLog({
          level: 'error',
          message: `評価エラー: ${error.message}`,
          timestamp: new Date()
        });
      }
    });
  }

  private addLog(log: any) {
    const logEntry = {
      ...log,
      timestamp: log.timestamp || new Date(),
      id: Date.now().toString() + Math.random()
    };
    
    this.logs.push(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  private filterLogs(filter: any) {
    let filtered = [...this.logs];
    
    if (filter.level) {
      filtered = filtered.filter(log => log.level === filter.level);
    }
    
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      filtered = filtered.filter(log => 
        log.message.toLowerCase().includes(searchLower)
      );
    }
    
    if (filter.startDate) {
      const start = new Date(filter.startDate);
      filtered = filtered.filter(log => 
        new Date(log.timestamp) >= start
      );
    }
    
    return filtered;
  }

  private calculateStats() {
    const total = this.evaluationHistory.length;
    const successful = this.evaluationHistory.filter(h => 
      h.status === 'completed' && h.result?.pass
    ).length;
    const failed = this.evaluationHistory.filter(h => 
      h.status === 'completed' && !h.result?.pass
    ).length;
    const errors = this.evaluationHistory.filter(h => 
      h.status === 'error'
    ).length;
    
    const averageDuration = this.evaluationHistory
      .filter(h => h.duration)
      .reduce((acc, h) => acc + h.duration, 0) / (total || 1);
    
    const averageScore = this.evaluationHistory
      .filter(h => h.result?.score)
      .reduce((acc, h) => acc + h.result.score, 0) / (total || 1);
    
    return {
      total,
      successful,
      failed,
      errors,
      successRate: total > 0 ? (successful / total * 100).toFixed(1) : 0,
      averageDuration: Math.round(averageDuration / 1000), // 秒単位
      averageScore: averageScore.toFixed(1)
    };
  }

  public start() {
    this.server.listen(this.port, () => {
      this.logger.info(`🌐 ダッシュボードサーバー起動: http://localhost:${this.port}`);
    });
  }

  public stop() {
    this.server.close(() => {
      this.logger.info('ダッシュボードサーバー停止');
    });
  }

  // MCPサーバーから呼び出すメソッド
  public logMessage(level: string, message: string, meta?: any) {
    this.emit('log', { level, message, ...meta });
  }

  public startEvaluation(document: string) {
    this.emit('evaluation:start', { document });
  }

  public updateProgress(progress: number) {
    this.emit('evaluation:progress', progress);
  }

  public completeEvaluation(result: any) {
    this.emit('evaluation:complete', result);
  }

  public errorEvaluation(error: any) {
    this.emit('evaluation:error', error);
  }
}

// スタンドアロン実行
if (require.main === module) {
  const dashboard = new DashboardServer();  // デフォルト値を使用（環境変数から読み取り）
  dashboard.start();
  
  // テストログ生成（デモ用）
  setInterval(() => {
    dashboard.logMessage('info', `テストログ: ${new Date().toLocaleTimeString()}`);
  }, 5000);
  
  // グレースフルシャットダウン
  process.on('SIGINT', () => {
    dashboard.stop();
    process.exit(0);
  });
}