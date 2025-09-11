#!/bin/bash

echo "OpenAI Codex CLI セットアップ開始..."

# Codex CLIの存在確認
if ! command -v codex &> /dev/null; then
    echo "Codex CLIをインストールしています..."
    npm install -g @openai/codex
fi

# APIキーの設定
if [ -z "$OPENAI_API_KEY" ]; then
    echo "OpenAI APIキーを入力してください:"
    read -s api_key
    export OPENAI_API_KEY=$api_key
    echo "export OPENAI_API_KEY=$api_key" >> ~/.bashrc
fi

# Codex認証
codex auth --api-key $OPENAI_API_KEY

# 動作確認
echo "Codex CLIの動作確認中..."
echo "print('Hello from Codex')" | codex exec --full-auto

echo "セットアップ完了！"