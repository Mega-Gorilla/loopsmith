# 即座に実装可能なパフォーマンス改善

## 1. バッファサイズの最適化（推奨）

`codex-evaluator.ts`の116行目付近を修正：

```typescript
const codexProcess = spawn(codexCommand, codexArgs, {
  shell: isWindows,
  windowsHide: true,
  env: codexEnv,
  cwd: workingDirectory,
  // 追加: ストリームのバッファサイズを増加
  stdio: [
    'pipe',
    ['pipe', { highWaterMark: 1024 * 1024 }],  // stdout: 1MB
    ['pipe', { highWaterMark: 256 * 1024 }]    // stderr: 256KB
  ]
});
```

## 2. ストリーム処理の最適化

`codex-evaluator.ts`の154行目付近を修正：

```typescript
// エンコーディングを事前設定
codexProcess.stdout.setEncoding('utf8');
codexProcess.stderr.setEncoding('utf8');

// データ収集を最適化
let chunks: string[] = [];
codexProcess.stdout.on('data', (data) => {
  chunks.push(data);
  // バッファオーバーフロー防止
  if (chunks.join('').length > this.codexMaxBuffer) {
    console.warn('出力バッファが上限に達しました');
    chunks = [chunks.join('').slice(-this.codexMaxBuffer)];
  }
});

// 最後に結合（効率的）
codexProcess.on('close', (code) => {
  stdout = chunks.join('');
  // ...
});
```

## 3. プロンプトの最適化

現在の長いプロンプトを短縮：

```typescript
// buildEvaluationPromptWithPath メソッドを最適化
private buildEvaluationPromptWithPath(filePath: string): string {
  // 開発/本番モードの切り替え
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  if (isDevelopment) {
    // 開発時は詳細なプロンプト
    return this.loadFullPrompt(filePath);
  } else {
    // 本番時は最小限のプロンプト
    return this.loadMinimalPrompt(filePath);
  }
}

private loadMinimalPrompt(filePath: string): string {
  return `評価対象: ${filePath}
必須評価: 実装可能性、技術的妥当性、情報充足性
出力: JSON形式で ready_for_implementation, score, analysis を含める
制約: 読み取り専用、文字化け無視`;
}
```

## 4. 不要なログの削減

```typescript
// デバッグモードの追加
const DEBUG = process.env.CODEX_DEBUG === 'true';

if (DEBUG) {
  console.log(`Codex評価開始 - タイムアウト設定: ${this.codexTimeout}ms`);
  console.log(`Codex作業ディレクトリ: ${workingDirectory}`);
}
```

## 5. 環境変数の追加

`.env`ファイル：

```bash
# 高速化設定
CODEX_FAST_MODE=true        # 簡潔モード有効化
CODEX_DEBUG=false           # デバッグログ無効化
CODEX_STREAM_BUFFER=1048576 # 1MBストリームバッファ
```

## 効果測定

これらの改善により期待される効果：

- **バッファ最適化**: 10-20%の高速化
- **プロンプト短縮**: 20-30%の高速化
- **ログ削減**: 5-10%の高速化

合計で **30-50%の処理時間短縮** が見込まれます。

## 実装優先順位

1. バッファサイズ増加（最も簡単で効果的）
2. 不要なログ削減（即座に実装可能）
3. プロンプト最適化（要テスト）
4. ストリーム処理改善（慎重に実装）