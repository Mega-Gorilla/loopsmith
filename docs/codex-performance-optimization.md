# Codex CLI パフォーマンス最適化ガイド

## 問題の概要

Codex CLIを使用した評価処理が通常のCodex CLI直接実行と比較して遅いという問題が報告されています。
タイムアウト設定が5分（デフォルト）となっているにも関わらず、実際の処理時間が長く感じられます。

## 現在の実装の分析

### 実装詳細
- **実行方法**: `child_process.spawn()` を使用
- **タイムアウト**: デフォルト5分（300000ms）、最大30分
- **バッファサイズ**: 20MB（CODEX_MAX_BUFFER）
- **実行環境**: Windows環境では `shell: true` で実行

### ボトルネックの特定

#### 1. Codex CLI自体の遅延
- **トークン遅延**: Codex CLIには10ms/トークンの人工的な遅延が組み込まれている
- **影響**: 500トークンで約3.5秒、2000トークンで約14秒の追加遅延
- **原因**: ストリーミング効果のシミュレーション

#### 2. Node.js spawn()の性能問題
- **バッファサイズ**: spawn()のデフォルトバッファは8KBと小さい
- **プロセス起動**: Node.jsのプロセス起動は他のランタイムより約4倍遅い
- **Windows固有**: シェル経由での実行による追加オーバーヘッド

#### 3. プロンプトサイズ
- **長いプロンプト**: XMLタグ構造と詳細な指示により入力が増大
- **標準入力**: 大量のテキストをstdinに書き込む処理の遅延

## 最適化ソリューション

### 即効性のある対策

#### 1. Codex実行オプションの最適化
```javascript
// codex-evaluator.ts の修正案
const codexArgs = [
  'exec',
  '--dangerously-bypass-approvals-and-sandbox',
  '--skip-git-repo-check',
  // 以下を追加検討
  '--no-animation',     // アニメーション無効化（存在する場合）
  '--quiet',           // 冗長な出力を抑制（存在する場合）
];
```

#### 2. バッファサイズの最適化
```javascript
const codexProcess = spawn(codexCommand, codexArgs, {
  shell: isWindows,
  windowsHide: true,
  env: codexEnv,
  cwd: workingDirectory,
  // バッファサイズを増加
  stdio: ['pipe', 'pipe', 'pipe'],
  highWaterMark: 1024 * 1024  // 1MBバッファ
});
```

#### 3. ストリーム処理の改善
```javascript
// チャンク処理を最適化
codexProcess.stdout.setEncoding('utf8');
codexProcess.stdout.on('data', (chunk) => {
  // バッファリングを最小限に
  stdout += chunk;
  // リアルタイムで部分的な解析を試みる
  tryPartialParse(stdout);
});
```

### 中期的な改善策

#### 1. exec()への切り替え検討
```javascript
// 小規模な評価の場合
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

// バッファ制限があるが、高速
const { stdout, stderr } = await execAsync(
  `codex exec --dangerously-bypass-approvals-and-sandbox < prompt.txt`,
  { 
    maxBuffer: 20 * 1024 * 1024,
    timeout: this.codexTimeout 
  }
);
```

#### 2. プロンプトの最適化
```javascript
// プロンプトを一時ファイルに保存
const promptFile = path.join(os.tmpdir(), `codex-prompt-${Date.now()}.txt`);
fs.writeFileSync(promptFile, evaluationPrompt);

// ファイル経由で実行
const codexArgs = [
  'exec',
  '--prompt-file', promptFile,  // stdinの代わりにファイル使用
  // ...
];
```

#### 3. キャッシング機構の実装
```javascript
class CodexEvaluator {
  private cache = new Map<string, EvaluationResponse>();
  
  async evaluate(request: EvaluationRequest): Promise<EvaluationResponse> {
    const cacheKey = this.generateCacheKey(request);
    
    // キャッシュ確認
    if (this.cache.has(cacheKey)) {
      console.log('キャッシュから結果を返却');
      return this.cache.get(cacheKey)!;
    }
    
    // 実行して結果をキャッシュ
    const result = await this.executeCodex(...);
    this.cache.set(cacheKey, result);
    return result;
  }
}
```

### 長期的な最適化

#### 1. Worker Threadsの活用
```javascript
// worker.js
const { parentPort } = require('worker_threads');
// Codex実行ロジック

// main.js
const { Worker } = require('worker_threads');
const worker = new Worker('./worker.js');
```

#### 2. Process Poolの実装
```javascript
class CodexProcessPool {
  private pool: ChildProcess[] = [];
  private maxProcesses = 3;
  
  async execute(prompt: string): Promise<string> {
    const process = await this.getAvailableProcess();
    // 実行ロジック
  }
}
```

#### 3. 代替ランタイムの検討
- **Bun**: Node.jsより高速なプロセス起動
- **Deno**: より効率的なサブプロセス管理

## 環境変数による調整

`.env`ファイルに以下を追加：

```bash
# パフォーマンスチューニング
CODEX_TIMEOUT=120000        # 2分に短縮（高速失敗）
CODEX_MAX_BUFFER=10485760   # 10MBに削減（メモリ節約）
CODEX_CACHE_ENABLED=true    # キャッシュ有効化
CODEX_CACHE_TTL=3600000     # キャッシュ有効期限（1時間）
```

## パフォーマンス測定

### ベンチマーク実装
```javascript
async function benchmarkCodex() {
  const startTime = performance.now();
  
  // 各段階の時間を測定
  const metrics = {
    promptGeneration: 0,
    processSpawn: 0,
    execution: 0,
    parsing: 0
  };
  
  // 測定ロジック
  
  const totalTime = performance.now() - startTime;
  console.log('総処理時間:', totalTime, 'ms');
  console.log('内訳:', metrics);
}
```

## 推奨される実装順序

1. **即座に実装可能**
   - バッファサイズの増加
   - 不要なログ出力の削減
   - プロンプトの簡潔化

2. **短期間で実装可能**
   - プロンプトのファイル経由実行
   - 部分的な結果の早期パース
   - 簡易キャッシング

3. **計画的に実装**
   - Process Pool
   - Worker Threads
   - 代替実行方法の検討

## トラブルシューティング

### 症状別の対処法

#### 「評価が5分でタイムアウトする」
- `CODEX_TIMEOUT`を増やす
- プロンプトを簡潔にする
- ファイルサイズを確認

#### 「起動が遅い」
- Windowsの場合、アンチウイルスの除外設定
- Node.jsのバージョンアップ
- SSDの使用

#### 「メモリ不足エラー」
- `CODEX_MAX_BUFFER`を減らす
- 評価対象ファイルを分割
- システムメモリの増設

## まとめ

Codexのパフォーマンス問題は複数の要因が絡み合っています。
即効性のある対策から段階的に実装し、最終的にはキャッシングやProcess Poolなどの
高度な最適化を導入することで、大幅な性能改善が期待できます。

特に重要なのは：
1. バッファサイズの最適化
2. プロンプトの効率化
3. キャッシングの活用

これらの対策により、評価時間を30-50%短縮できる可能性があります。

---

最終更新日: 2025年1月