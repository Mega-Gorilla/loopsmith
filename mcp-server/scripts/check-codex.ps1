# Windows PowerShell用Codex存在確認スクリプト

$codexPath = Get-Command codex -ErrorAction SilentlyContinue

if ($codexPath) {
    Write-Output $codexPath.Path
    exit 0
} else {
    Write-Error "Codex CLI not found. Run: npm install -g @openai/codex"
    exit 1
}