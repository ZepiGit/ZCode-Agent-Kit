# ハーネスアダプター — 他のエージェント CLI がローカルプロキシを使う方法（日本語）

[English](README.md) | [中文](README.zh-CN.md) | [Español](README.es.md) | **日本語** | [Deutsch](README.de.md)

> 本ドキュメントは英語原文の翻訳です。相違がある場合は英語版が正となります。

キットの中核はハーネス非依存です。`http://127.0.0.1:8457` で待ち受ける
ローカル HTTP プロキシが、3 つの標準形式を提供します：

| エンドポイント | 形式 | 用途 |
|---|---|---|
| `POST /v1/messages` | Anthropic messages（SSE + バッチ） | Claude Code 系クライアント、OMP |
| `POST /v1/chat/completions` | OpenAI chat-completions（SSE + バッチ） | OpenAI 互換クライアント |
| `POST /v1/responses` | OpenAI Responses API | Agents SDK 系クライアント |
| `GET /v1/models` | モデル一覧 | ディスカバリー |
| `GET /health`, `GET /quota` | ステータス/クォータ（要認証） | 診断 |

認証：`Authorization: Bearer <.proxykey の内容>`
鍵はローカル（`<clone>/.proxykey`）にのみ置かれ、setup.mjs が生成します。

## `zcode-kit setup` による自動セットアップ（検出されたハーネスのみ）

setup.mjs はインストール済みのハーネスを検出し、**その対象だけ**を設定します。
OMP しかないユーザーの環境には Claude/Codex の成果物は一切作られません
（生成ファイルも含む）。

| ハーネス | 仕組み | 既存 config への影響 |
|---|---|---|
| OMP (oh-my-pi) | `~/.omp/agent/models.yml` の provider ブロック `zcode` + 自動起動拡張 | 追加型（管理ブロック、トランザクション、冪等）。モデル指定： `omp --model zcode/glm-5.3[-flash] --thinking low\|high\|max` |
| pi | `~/.pi/agent/models.json` の provider `zcode`（`api: anthropic-messages`、`!node` キーリゾルバ） | 追加型（他の provider は保持）。出典：pi-mono docs/models.md |
| Claude Code | `generated/claude-zcode-settings.json` + `bin/zcode-claude.cmd\|.sh` | `~/.claude` は変更しない（呼び出しごとのオプトイン） |
| Codex CLI | 隔離された `generated/codex-home` + `bin/zcode-codex.cmd\|.sh` | `~/.codex` は変更しない。**違い**：独自の skills/ルール/MCP はラッパー内では適用されない |
| OpenCode | `opencode.json` の provider `zcode`（`@ai-sdk/openai-compatible`、apiKey `{env:ZCODE_PROXY_KEY}`） | 追加型。JSONC コメントは保持される |
| Aider | `generated/aider-zcode.env` + `bin/zcode-aider.cmd\|.sh`（プロセスローカル、**setx しない**） | モデル `openai/glm-5.3[-flash]` |
| Continue | `~/.continue/config.yaml` の管理ブロック（schema v1） | 既存のモデル/ロールは保持 |
| Goose | `%APPDATA%/Block/goose/config/custom_providers/zcode.json` | 認証情報は文書化された `auth.command` ヘルパー経由（kit のキーリゾルバ、シェルなし） |
| Cline | `generated/cline-zcode-values.md` — **manual-confirmation-required** | kit は VS Code の状態に一切触れない。UI で一度だけ値を入力する |
| Kilo Code | `generated/kilo-zcode-values.md` — **manual-confirmation-required** | UI でカスタム provider（Anthropic messages）を設定。kilo.jsonc は意図的に書かない |
| MCP 対応ハーネス | stdio サーバー `zcode-harness`（`node mcp/zcode-harness-mcp/dist/index.js --stdio`） | OMP：`~/.omp/agent/mcp.json` にエントリー。Claude Code：`claude mcp add`（検出時のみ）。Codex：隔離 home 内。MCP 単体はモデル統合としてカウントされない |

## オプトインのラッパー（既存 config は変更されない）

| ハーネス | ラッパー | 動作 |
|---|---|---|
| Claude Code | `bin\zcode-claude.cmd` | 必要時にプロキシを起動し、`claude --settings <clone>\generated\claude-zcode-settings.json` を呼び出す（CLI settings は user settings.json より優先。通常の `claude` はそのまま動く） |
| Codex CLI | `bin\zcode-codex.cmd` | `CODEX_HOME=<clone>\generated\codex-home` + `ZCODE_PROXY_KEY` を設定し、必要時にプロキシを起動。通常の `codex` と `~/.codex` は変更されない |

## 手動での接続（OpenAI/Anthropic 対応の任意のクライアント）

```yaml
# OpenAI 形式
base_url: http://127.0.0.1:8457/v1
api_key: <.proxykey の内容>
model: glm-5.3            # または glm-5.3-flash
```

```yaml
# Anthropic 形式
base_url: http://127.0.0.1:8457
auth_token: <.proxykey の内容>
model: glm-5.3
```

推論/thinking：
- **Anthropic 形式**： `thinking: {type: "enabled", budget_tokens: 2048|16384|32768}`
  と `output_config: {effort: "low"|"high"|"max"}` を組み合わせる — 詳細は
  [EFFORT_MAPPING.md](../EFFORT_MAPPING.md)。
- **OpenAI 形式**： `reasoning_effort: low|high|max` + `thinking: {type: "enabled"}`
  （プロキシが Anthropic 側のフィールドに変換）。

## MCP クライアント（汎用）

```json
{
  "mcpServers": {
    "zcode-harness": {
      "type": "stdio",
      "command": "node",
      "args": ["<clone の絶対パス>/mcp/zcode-harness-mcp/dist/index.js", "--stdio"]
    }
  }
}
```

ブリッジは**実インストールの ZCode Desktop** を制御します（app-server
プロトコル：セッション、ターン、タスク）。制限事項：デスクトップが起動して
いる必要がある（Z.AI の CAPTCHA はデスクトップが解決）。ブリッジの
カタログ経由の推論レベルは `low/high/max`。デスクトップのプランカタログには
GLM-5.3/GLM-5-Turbo が載る — GLM-5.3-Flash はプロキシ経由で動き、
デスクトップブリッジでは使えない。詳細：
[mcp/zcode-harness-mcp/README.md](../mcp/zcode-harness-mcp/README.md)。

## クォータとエラーの型

- `GET /quota`（認証付き）はモデルごとのトークンバケットを表示します。
- クォータ消費済み → HTTP 400 `[1005] exceed quota limit`（再試行不可 —
  リセットを待つ。GLM-5.3 は毎日現地時間 18:00）。
- `[3007] captcha verify failed` → 激しい再試行の後のゲートウェイ側
  アンチアビューズ。しばらく休憩する。
- `401 start_plan_jwt_invalid` → デスクトップのログインを更新
  （[README.ja.md](../README.ja.md) →「ログインの更新」）。
- Codex 経由：responses ハンドラでまれに化粧的なエラー
  `OutputTextDelta without active item` が出る — 結果は正しい
  （既知の見た目上の問題）。
