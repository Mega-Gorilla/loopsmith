# Windows PowerShell用Codexセットアップスクリプト

Write-Host "OpenAI Codex CLI セットアップ開始..." -ForegroundColor Green

# Codex CLIの存在確認
$codexPath = Get-Command codex -ErrorAction SilentlyContinue

if (-not $codexPath) {
    Write-Host "Codex CLIをインストールしています..." -ForegroundColor Yellow
    npm install -g @openai/codex
    
    # インストール確認
    $codexPath = Get-Command codex -ErrorAction SilentlyContinue
    if (-not $codexPath) {
        Write-Host "エラー: Codex CLIのインストールに失敗しました" -ForegroundColor Red
        exit 1
    }
}

Write-Host "Codex CLIが見つかりました: $($codexPath.Path)" -ForegroundColor Green

# バージョン確認
Write-Host "`nCodex CLIバージョン:" -ForegroundColor Cyan
& codex --version

# 認証状態の確認
Write-Host "`n認証状態を確認中..." -ForegroundColor Yellow
$authStatus = & codex whoami 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "認証が必要です。" -ForegroundColor Yellow
    Write-Host "以下のコマンドを実行してください:" -ForegroundColor Cyan
    Write-Host "  codex login" -ForegroundColor White
} else {
    Write-Host "認証済み: $authStatus" -ForegroundColor Green
}

# 環境設定の確認
Write-Host "`n環境設定:" -ForegroundColor Cyan
Write-Host "  作業ディレクトリ: $(Get-Location)" -ForegroundColor White
Write-Host "  Node.jsバージョン: $(node --version)" -ForegroundColor White
Write-Host "  npmバージョン: $(npm --version)" -ForegroundColor White

# .envファイルの確認
$envFile = Join-Path (Get-Location) ".env"
if (Test-Path $envFile) {
    Write-Host "  .envファイル: 検出済み" -ForegroundColor Green
} else {
    Write-Host "  .envファイル: 未検出" -ForegroundColor Yellow
    Write-Host "  .env.exampleから.envファイルを作成してください" -ForegroundColor Cyan
}

Write-Host "`nセットアップ完了！" -ForegroundColor Green