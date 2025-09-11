# ESM移行ガイド

## 概要

現在のLoopSmith MCPサーバーはCommonJS（CJS）で実装されていますが、`@modelcontextprotocol/sdk`はESMパッケージです。このガイドでは、CJSからESMへの移行方法を説明します。

## 移行オプション

### オプション1: ESMへの完全移行（推奨）

#### 必要な変更

1. **package.json**
```json
{
  "type": "module",
  "engines": {
    "node": ">=18.0.0"
  }
}
```

2. **tsconfig.json**
```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true
  }
}
```

3. **__dirnameの代替**
```typescript
// CJS
const promptPath = path.join(__dirname, '..', 'prompts', 'template.txt');

// ESM
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const promptPath = path.join(__dirname, '..', 'prompts', 'template.txt');
```

4. **import文の拡張子**
```typescript
// ESMでは拡張子が必須
import { CodexEvaluator } from './codex-evaluator.js';  // .js必須
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
```

#### CJSモジュールのインポート

既存のCJSモジュールをESMからインポートする場合：

```typescript
// Named exportがない場合
import evaluatorPkg from './codex-evaluator.js';
const { CodexEvaluator } = evaluatorPkg;

// または動的import
const { CodexEvaluator } = await import('./codex-evaluator.js');
```

### オプション2: CJSを維持（動的import使用）

#### 実装方法

```typescript
// index.ts (CommonJS)
async function main() {
  // ESMパッケージを動的import
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  
  const server = new Server(
    { name: 'loopsmith', version: '2.0.0' },
    { capabilities: { tools: {} } }
  );
  
  // 以下実装...
}

main().catch(console.error);
```

#### 制限事項

- トップレベル`await`が使えない
- すべてのESMパッケージは動的importが必要
- TypeScriptの型推論が制限される場合がある

## 移行チェックリスト

### 事前準備

- [ ] Node.js 18以上を確認
- [ ] 既存のテストスイートを実行して基準を確立
- [ ] 依存パッケージのESM対応状況を確認

### 移行作業

- [ ] package.jsonに`"type": "module"`を追加
- [ ] tsconfig.jsonを更新
- [ ] すべての`__dirname`使用箇所を更新
- [ ] import文に拡張子を追加
- [ ] CJSモジュールのインポートを調整
- [ ] スクリプトのシバン（`#!/usr/bin/env node`）を確認

### テストと検証

- [ ] TypeScriptのコンパイルエラーを解決
- [ ] ユニットテストの実行
- [ ] Claude Codeとの統合テスト
- [ ] Windows/macOS/Linuxでの動作確認

## トラブルシューティング

### よくあるエラーと解決方法

#### 1. "Cannot use import statement outside a module"
**原因**: package.jsonに`"type": "module"`がない  
**解決**: package.jsonに追加

#### 2. "ERR_MODULE_NOT_FOUND"
**原因**: import文に拡張子がない  
**解決**: `.js`拡張子を追加

#### 3. "__dirname is not defined"
**原因**: ESMでは`__dirname`が使えない  
**解決**: `import.meta.url`から生成

#### 4. "Cannot find module"（CJSモジュール）
**原因**: ESMからCJSのNamed exportが見えない  
**解決**: デフォルトインポート後に分割代入

## パフォーマンスへの影響

- **起動時間**: ESMは若干高速（キャッシュ効率向上）
- **メモリ使用量**: ほぼ同等
- **実行速度**: 差はほとんどない

## 推奨事項

1. **新規プロジェクト**: ESMで開始
2. **既存プロジェクト**: 段階的移行を検討
3. **ライブラリ**: dual package（CJS/ESM両対応）を検討

## 参考資料

- [Node.js ESM Documentation](https://nodejs.org/api/esm.html)
- [TypeScript ESM Support](https://www.typescriptlang.org/docs/handbook/esm-node.html)
- [MCP SDK Documentation](https://modelcontextprotocol.io)