# ハーネスアダプター — 他のエージェント CLI がローカルプロキシを使う方法（日本語）
[English (original)](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · **日本語** · [简体中文](README.zh-CN.md)

> 本ドキュメントは英語原文の翻訳です。相違がある場合は英語版が正となります。

キットの中核はハーネス非依存です。ローカル HTTP プロキシが 3 つの標準形式を提供します。以下の例はデフォルトポート `8457` を使います。実際のポートと接続情報は `zcode-kit proxy status` が表示します：

| エンドポイント | 形式 | 用途 |
|---|---|---|
| `POST /v1/messages` | Anthropic messages（SSE + バッチ） | Claude Code 系クライアント、OMP |
| `POST /v1/chat/completions` | OpenAI chat-completions（SSE + バッチ） | OpenAI 互換クライアント |
| `POST /v1/responses` | OpenAI Responses API | Agents SDK 系クライアント |
| `GET /v1/models` | モデル一覧 | ディスカバリー |
| `GET /health`, `GET /quota` | ステータス/クォータ（要認証） | 診断 |

認証：`Authorization: Bearer <.proxykey の内容>`。
`zcode-kit setup` が鍵をローカルで生成します。リリース版とソースの
チェックアウトでは kit 内に `.proxykey` を置きます。npm インストールでは
`node_modules` の外にあるインストール固有の状態ディレクトリに保存します。

## `zcode-kit setup` によるセットアップ（検出されたハーネス、同意がある場合のみ）

`zcode-kit setup --harness auto` はインストール済みのハーネスを検出し、保存済みの決定がないハーネスごとに "Configure ZCode as a provider with its supported models in <HARNESS>? [y/n]" と質問します。`y` でそのハーネスを設定し、`n` はスキップしてファイルに触れません。ターミナルがなければ未決定のハーネスはすべてスキップされます。Ctrl-C で質問を中止できます（終了コード 130）。すでに `y` と答えたものは設定されたままです。OMP しかない場合、Claude/Codex の設定や生成ラッパーは作られません。決定はハーネスごとに 1 ファイルとして `generated/harness-choices/` に保存され、セットアップのトランザクションの一部です（ロールバックで再び削除されます）。`zcode-kit update` と `zcode-kit doctor --fix` は同意済みの統合（`y`、明示的な選択、または `zcode-kit integrate <harness>`）だけを再適用し、保存された `n` は `--harness`、`integrate`、または `zcode-kit setup --reask`（ターミナルで再質問）で変えるまで尊重されます。質問より前に kit が作成した統合は無人実行でも更新されますが、同意と見なされることはありません。無人実行では `--harness omp,codex` または `ZCODE_KIT_HARNESSES=omp,codex` でハーネスを選択します（`none` は検出されたすべてをスキップ）。不明な id はエラーです。kit の MCP ブリッジは別個の同意がある場合だけ登録されます。明示的な選択か、セットアップが質問の前に表示する MCP の注記の後に答えた `y` です（`--no-mcp` で無効化）。`integrate`、更新、その注記なしの保存済み決定では登録されません。1 つのハーネスが失敗しても他は止まりません。そのハーネス自身の部分的な書き込みは元に戻され、サマリーに失敗として表示され、セットアップは終了コード 20 で終わります（インストーラーは警告を出して続行します）。

| ハーネス | 仕組み | 既存 config への影響 |
|---|---|---|
| OMP (oh-my-pi) | `~/.omp/agent/models.yml` の provider ブロック `zcode` + 自動起動拡張 | 追加型（管理ブロック、トランザクション、冪等）。モデル指定： `omp --model zcode/glm-5.3[-flash] --thinking low\|high\|max` |
| pi | `~/.pi/agent/models.json` の provider `zcode`（`api: anthropic-messages`、`!node` キーリゾルバ） | 追加型（他の provider は保持）。出典：pi-mono docs/models.md |
| Claude Code | `generated/claude-zcode-settings.json` + `bin/zcode-claude.cmd\|.sh` | `~/.claude` は変更しない（呼び出しごとのオプトイン） |
| Codex CLI | 隔離された `generated/codex-home` + `bin/zcode-codex.cmd\|.sh` | `~/.codex` は変更しない。**違い**：独自の skills/ルール/MCP はラッパー内では適用されない |
| OpenCode | `opencode.json` の provider `zcode`（`@ai-sdk/openai-compatible`、apiKey `{env:ZCODE_PROXY_KEY}`） | 追加型。JSONC コメントは保持される |
| Aider | `generated/aider-zcode.env` + `bin/zcode-aider.cmd\|.sh`（プロセスローカル、**setx しない**） | モデル `openai/glm-5.3[-flash]` |
| Continue | `~/.continue/config.yaml` の管理ブロック（schema v1） | 既存のモデル/ロールは保持 |
| Goose | `%APPDATA%/Block/goose/config/custom_providers/zcode.json`（Windows）または `~/.config/goose/custom_providers/zcode.json`（macOS/Linux） | 認証情報は文書化された `auth.command` ヘルパー経由（kit のキーリゾルバ、シェルなし） |
| Cline | `generated/cline-zcode-values.md` — **manual-confirmation-required** | kit は VS Code の状態に一切触れない。UI で一度だけ値を入力する |
| Kilo Code | `generated/kilo-zcode-values.md` — **manual-confirmation-required** | UI でカスタム provider（Anthropic messages）を設定。kilo.jsonc は意図的に書かない |
| MCP 対応ハーネス | stdio サーバー `zcode-harness`（`node mcp/zcode-harness-mcp/dist/index.js --stdio`） | OMP：`~/.omp/agent/mcp.json` にエントリー。Claude Code：`claude mcp add`（検出され同意した場合のみ）。Codex：隔離 home 内。MCP 単体はモデル統合としてカウントされない |

`generated/` 以下のパスは kit の状態を指します。リリース版/ソースでは
kit ディレクトリ内、npm では別の状態ディレクトリ内です。

OMP は `omp --model zcode/glm-5.3-flash --thinking low` などで直接起動し、`zcode-kit run` は使いません。セットアップでネイティブの Node/Bun を固定し、自動起動の事前確認は kit モジュールを OMP にインポートせず、新しい子プロセスで行います。子プロセスは最大 120 秒で終了し、失敗時は機密情報を含まないカテゴリを表示します。原因を修正し、セッションごとの 60 秒の待機時間後に再試行してください。同じセッションで復旧できます。ランタイムを移動した場合は `zcode-kit setup --harness auto` を再実行し、拡張機能を再読み込みします。ポートを使用している不明なプロセスを終了することはありません。プロキシが正常、またはセットアップが成功しただけでは、モデルの応答が完了する証拠にはなりません。

## オプトインのラッパー（既存 config は変更されない）

| ハーネス | ラッパー | 動作 |
|---|---|---|
| Claude Code | `bin\zcode-claude.cmd` | 必要時にプロキシを起動し、`claude --settings <kit の状態>\generated\claude-zcode-settings.json` を呼び出す（CLI settings は user settings.json より優先。通常の `claude` はそのまま動く） |
| Codex CLI | `bin\zcode-codex.cmd` | `CODEX_HOME=<kit の状態>\generated\codex-home` + `ZCODE_PROXY_KEY` を設定し、必要時にプロキシを起動。通常の `codex` と `~/.codex` は変更されない |

## 手動での接続（OpenAI/Anthropic 対応の任意のクライアント）

これは同等の入口であり、代替手段ではありません。kit のプロキシが起動しており、ZCode に有効なログインが必要です。`zcode-kit proxy start`（すでに起動中の場合も）と `zcode-kit proxy status` は現在のベース URL、ローカルキー、モデル ID を表示します。プロキシの起動が検証できない場合、値は設定由来としてラベル付けされ、出力に `Start the proxy first: zcode-kit proxy start` と表示されます。完全なキーは対話的なターミナルでのみ表示されます。それ以外では `zcode-kit models --show-key` を使ってください。以下の例のポートは、コマンドが表示するポートに置き換えてください。

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

**Flash:** `glm-5.3-flash` は常に thinking を使用します。明示的に無効にした thinking は `low` に正規化され、明示的に選んだ `high` と `max` は維持されます。Flash の Anthropic 形式における低レベルの thinking 予算は、上記の一般的な `2048` ではなく `8000` トークンで、回答用の追加出力枠も確保します。OpenAI 形式では `reasoning_effort: low` を使用します。thinking の強度が高いという理由だけでハングと判断しないでください。直接のプロキシ経由と Claude Code で Flash の応答完了を確認済みですが、すべてのハーネスの動作確認を意味しません。

Windows の独立した Codex プロファイルでは制限付きトークンのサンドボックス（`windows.sandbox = "unelevated"`）を有効にします。`workspace-write` はプロジェクト内に制限され、全面的なアクセスは許可しません。OpenCode Flash は `--variant low`、`high`、`max` に対応し、既定値は `low` です。ネイティブ実行ファイル用 npm ラッパーと Brotli/deflate 圧縮のセッションストリームに対応します。Responses のツール結果のテキストと画像は保持され、不正なイベントを成功した出力と見なしません。

## MCP クライアント（汎用）

```json
{
  "mcpServers": {
    "zcode-harness": {
      "type": "stdio",
      "command": "node",
      "args": ["<kit の絶対インストールパス>/mcp/zcode-harness-mcp/dist/index.js", "--stdio"]
    }
  }
}
```

ブリッジは**実際にインストールされた ZCode ハーネス**を制御します
（app-server プロトコル：セッション、ターン、タスク）。対話的な認証には
Desktop が必要な場合がありますが、プロバイダーがモデル呼び出しを拒否
することもあります。ブリッジの推論レベルは `low/high/max` です。
ライブのモデル一覧はプロキシ側と異なる場合があり、GLM-5.3-Flash
はプロキシ経由で検証されています。ネイティブのモデル一覧に載っていても、
ネイティブ経由のモデル呼び出しが成功する証拠にはなりません。プロキシの
動作確認は、ネイティブプロバイダーの動作確認とは別です。
詳細：[MCP ブリッジ](../mcp/zcode-harness-mcp/README.ja.md)。

## クォータとエラーの型

- `GET /quota`（認証付き）はモデルごとのトークンバケットを表示します。
- クォータ消費済み → HTTP 400 `[1005] exceed quota limit`。プロキシは同じアカウントを成長間隔で再試行し（既定で最大約65秒）、ローテーターに別のアカウントがあればその後に切り替えます。それでも表示される場合は、プロバイダーによる利用枠の回復を待ってください。
- `[3007] captcha verify failed` → ゲートウェイ側のアンチアビューズ。プロキシは新しく発行した CAPTCHA トークンで一度再試行します。それでも失敗する場合は、しばらく休憩してください。
- 出力前の一時的な障害（接続拒否やリセット、HTTP 500/502/503/504/524/529、429、公式クライアントが再試行するゲートウェイのエラーコード）は、同じアカウントで待ち時間を増やしながら最大 3 回再試行します。予算は公式クライアントより小さく（基本待ち時間 1 秒で倍増、`Retry-After` は 15 秒まで尊重）、再試行のたびにアカウントを再確認します。ゲートウェイの判定（クォータ、残高、CAPTCHA、モデル、認証）、リクエストのエラー、出力開始後の障害は再試行しません。15 秒を超える `Retry-After` は 429/503/529 でクライアントにそのまま渡します。`ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS` で調整できます（基本待ち時間をミリ秒で指定、既定 500、上限 10000。`off` にすると接続が確立しなかった場合の再試行だけを残します。proxy start/restart が値を引き継ぎます）。
- アップストリームが途中で切断したストリームは、無言で途切れる代わりにエラーで終わります。チャットのストリームは `data: {"error":…}`、Responses は `response.failed`、ネイティブの Anthropic ストリームは `api_error` 型の `event: error` フレーム 1 つで、メッセージに原因（`upstream_incomplete` または `upstream_stream_error`）が入ります。未完成の最後のフレームは、エラーフレームを正しく解析できるよう破棄します。出力開始後は何も再送しません。ハーネスからターンを送り直してください。
- `401 start_plan_jwt_invalid` → Desktop のログインを確認し、`zcode-kit auth login zai` で更新。プランが明示的に設定された Desktop 0.16.9 の現在アクティブな `zai`/`start-plan` ログインには `zcode-kit auth login zai --import` を使います。`credentials.json` が存在する場合はそれが正となり、認証情報が無効でも `config.json` へ暗黙にはフォールバックしません。新形式の `coding-plan` ログインでは通常の OAuth を使います。インポートは API キーの作成や取得を行いません。
- Flash で `[1210]` → thinking が有効か確認し、無効にする代わりに `low`、`high`、`max` を選びます。プロキシは、無効にした thinking を `low` に正規化します。上記の Flash の注記を参照してください。
