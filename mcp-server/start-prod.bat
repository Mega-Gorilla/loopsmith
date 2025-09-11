@echo off
echo Starting MCP Server in Production Mode...
set USE_MOCK_EVALUATOR=false
set CODEX_SUPPORTS_JSON_FORMAT=false
set MCP_PORT=23105
set EVALUATION_PROMPT_PATH=../prompts/evaluation-prompt.txt
npm start