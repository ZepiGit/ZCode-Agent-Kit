# アシスタント別ガイド
[English (original)](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · **日本語** · [简体中文](README.zh-CN.md)

> 本ドキュメントは英語原文の翻訳です。相違がある場合は英語版が正となります。

このページでは、対応するコーディングアシスタントごとに、実行するコマンド、kit が書き込む内容、自分で行う作業を説明します。インストール方法は[メインの README](../README.ja.md) にあります。CLI ではアシスタントを「harness」と呼ぶため、フラグ名は `--harness` です。

kit には Node.js 24 以降が必要です。Node.js 20 と 22 はサポート対象外になり、これらのバージョンでは `zcode-kit setup` と `zcode-kit update` は何も変更せずに停止します。リリース版のインストーラーは、Bun がない場合に Bun 1.4.2 をインストールします。`zcode-kit --version` はインストール済みのバージョンを、`zcode-kit help` はすべてのコマンドを表示します。

## セットアップでアシスタントを選ぶ

`zcode-kit setup` はインストール済みのアシスタントを探し、同意したものだけを設定します。

- **ターミナルでは**、検出したアシスタントをチェックボックスのリストで表示します。矢印キーで移動、Space でチェックの切り替え、`a` で全項目の切り替え、Enter で確定します。チェックしたアシスタントは設定され、チェックしなかったものはスキップされます。Esc を押した場合や、何もチェックせずに Enter を押した場合は、回答を保存しません。
- **色やカーソル制御が使えないターミナル、またはリストを表示するには小さすぎるターミナルでは**、アシスタントごとに `Configure ZCode for <アシスタント>? [y/n]` と質問します。`zcode-kit setup --select` を使うと、代わりに番号付きのリストを表示し、番号、`all`、`none` で答えられます。
- **ターミナルがない場合**（CI、パイプ）は何も質問せず、回答が保存されていないアシスタントをすべてスキップします。この場合はアシスタントを指定してください。`zcode-kit setup --harness omp,codex` または `ZCODE_KIT_HARNESSES=omp,codex` とすると、指定したものだけが設定されます。`none` は検出したアシスタントをすべてスキップし、不明な id はエラーになります。

回答は `generated/harness-choices/` に保存され、以降のセットアップ、`zcode-kit update`、`zcode-kit doctor --fix` で再利用されます。同意したものは最新の状態に保たれ、断ったものには手を加えず、再度質問されることもありません。`zcode-kit setup --reask` はターミナルでもう一度質問し、`zcode-kit doctor --forget <アシスタント>` は保存済みの回答を 1 つ削除します。この kit が以前に作成した統合は、回答が保存されていなくても更新されることがあります。

Ctrl-C を押すと、セットアップは終了コード 130 で終わります。確定していないチェックボックスのリストは適用されません。y/n の質問ですでに答えた分は適用されたままです。1 つのアシスタントが失敗した場合、その部分的な変更は元に戻され、他のアシスタントは設定され、セットアップは終了コード 20 で終わります。セットアップは、変更を元に戻す `zcode-kit rollback` コマンドを表示します。アシスタントが設定済みであることは、ファイルが書き込まれたことを意味するだけで、ログインが有効であることやモデルが応答することを示すものではありません。ログインは `zcode-kit auth status` で確認してください。

## アシスタントを 1 つだけ設定する

```sh
zcode-kit integrate <アシスタント> --dry-run   # 書き込まれる内容を一覧表示し、何も書き込まない
zcode-kit integrate <アシスタント>             # 書き込み、同意を保存する
zcode-kit rollback                             # 直近の変更を元に戻す
```

`--dry-run` は、変更されるファイルごとに `would write` の行を表示します。実際の実行では、そのアシスタントへの同意も保存するため、以降のセットアップと更新で最新の状態に保たれます。MCP ブリッジを登録することはありません。kit の git チェックアウト内では、`ZCODE_KIT_ALLOW_CHECKOUT=1` を設定しない限り、`setup` と `integrate` は書き込みを拒否します。

## 一覧

| アシスタント (id) | セットアップが書き込むもの | 起動方法 | モデル応答での検証 |
|---|---|---|---|
| OMP (`omp`) | `~/.omp/agent/models.yml` の provider `zcode`、自動起動拡張 | `omp --model zcode/glm-5.3-flash` | Windows、バージョン 18.2.9 |
| pi (`pi`) | `~/.pi/agent/models.json` の provider `zcode` | `zcode-kit proxy start` の後に `pi --model zcode/glm-5.3` | Windows、バージョン 0.85.0 |
| Claude Code (`claude-code`) | `generated/claude-zcode-settings.json` | `zcode-kit run claude-code -- <args>` | Windows、バージョン 2.1.278 |
| Codex CLI (`codex`) | `generated/codex-home/config.toml` | `zcode-kit run codex -- <args>` | Windows、バージョン 0.155.1 |
| OpenCode (`opencode`) | OpenCode の設定ファイルの provider `zcode` | `zcode-kit run opencode -- <args>` | Windows、バージョン 1.18.29 |
| Aider (`aider`) | `generated/aider-zcode.env` | `zcode-kit run aider -- <args>` | Windows、バージョン 0.86.2 |
| Continue (`continue`) | `~/.continue/config.yaml` のモデル 2 つ | `zcode-kit proxy start` の後、Continue でモデルを選択 | なし |
| Goose (`goose`) | Goose の `custom_providers` フォルダーの `zcode.json` | `zcode-kit proxy start` の後に `goose session --provider zcode` | なし |
| Cline (`cline`) | `generated/cline-zcode-values.md` | Cline に値を入力した後、`zcode-kit proxy start` | なし |
| Kilo Code (`kilo-code`) | `generated/kilo-zcode-values.md` | Kilo Code に値を入力した後、`zcode-kit proxy start` | なし |

最後の列は[サポートマトリクス](../SUPPORT_MATRIX.json)に基づきます（Windows 11、2026-09-23、kit v0.2.33、`glm-5.3-flash`）。Linux と macOS では、実際のモデル応答による検証は行っていません。「なし」の行は、アシスタント本体を使わず、設定の書き込みだけを検証しています。

`generated/` とローカルキー `.proxykey` は、リリース版のインストールとソースのチェックアウトでは kit ディレクトリ内に、npm インストールでは `node_modules` の外にある別の状態ディレクトリ内にあります。書き込まれるファイルの一部にはキーが平文で含まれます。これらのファイルは共有しないでください。キーが変わった場合は `zcode-kit setup` を再実行してください。

`zcode-kit run <アシスタント> -- <args>` は Claude Code、Codex CLI、OpenCode、Aider で使えます。必要ならプロキシを起動し、`--` より後ろをすべてアシスタントに渡します。kit ディレクトリの `bin/zcode-claude`、`bin/zcode-codex`、`bin/zcode-aider`（`.cmd` または `.sh`）も同じ動作をします。

## アシスタントごとの注意点

### OMP

OMP は直接起動します。`zcode-kit run omp` はありません。thinking のレベルは `--thinking low`、`high`、`max` で選びます。kit は既定値として `max` を設定します。セットアップは `models.yml` にマーカー付きのブロックを追加し、拡張機能を `~/.omp/agent/extensions/` にコピーします。`config.yml` がある場合は、そこに拡張機能を登録し、`disabledProviders` から `zcode` を取り除きます。`models.yml` がない場合は OMP をスキップし、自分で書いた `zcode` provider がファイルにある場合は何も変更しません。

拡張機能は、OMP が `zcode` のモデルに最初のリクエストを送るときにプロキシを起動します。起動の確認は別プロセスで実行され、最長 120 秒です。失敗した場合、OMP は理由を示す `[zcode-autostart]` の行を表示し、次の試行は早くても 60 秒後です。拡張機能は、セットアップが見つけた Node.js のパスを保存します。その Node.js が削除された場合や、バージョン 24 より古い場合は、`zcode-kit setup` を再実行して OMP を再起動してください。

### pi

pi はプロキシを自動では起動しません。エントリーは Anthropic messages 形式を使い、他の provider は保持されます。キーはファイルに書き込まれません。pi は kit のスクリプト `proxy/resolve-zcode-proxy-key.mjs` を実行してキーを取得します。`~/.pi/agent` がない場合、セットアップは pi をスキップします。kit が書いたものではない `zcode` provider がファイルにある場合は、何も変更しません。kit は pi の thinking レベルを設定しません。

### Claude Code

`~/.claude/settings.json` は変更されません。`zcode-kit run claude-code -- <args>` は `claude --settings <生成されたファイル> <args>` を実行するため、その呼び出しだけが ZCode に送られ、通常の `claude` はこれまでどおり動きます。この設定では `glm-5.3` をメインのモデル、`glm-5.3-flash` を小型で高速なモデルとして使います。すべてで Flash を使うには `--model glm-5.3-flash` を付けます。Anthropic は、Claude 以外のモデルでの Claude Code の利用を公式にはサポートしていません。

### Codex CLI

`zcode-kit run codex -- <args>` は、その呼び出しに限って `CODEX_HOME` を `generated/codex-home` に設定します。`~/.codex` と通常の `codex` はそのままです。別の home なので、自分の Codex の設定、skills、ルール、MCP サーバーはそこでは適用されません。その中の `config.toml` は Responses API を使い、`glm-5.3` を既定のモデルとし、kit の MCP ブリッジのエントリーを常に含みます。Windows では `[windows]` に `sandbox = "unelevated"` も設定します。

### OpenCode

セットアップは `OPENCODE_CONFIG` が指すファイルを編集します。指定がなければ、`OPENCODE_CONFIG_DIR`、`$XDG_CONFIG_HOME/opencode`、`~/.config/opencode` のいずれかにある `opencode.jsonc` または `opencode.json` を編集し、ファイルがなければ作成します。他の設定と、`provider` セクションの外にあるコメントは保持されます。kit が書いたものではない `zcode` provider がある場合は、エラーで変更を中止します。エントリーは環境変数 `ZCODE_PROXY_KEY` からキーを読み取り、この変数は `zcode-kit run opencode` が設定します。`opencode` を直接起動する場合は、自分でこの変数を設定し、先にプロキシを起動してください。`glm-5.3-flash` には `low`、`high`、`max` のバリアントがあり、既定値は `low` です。

### Aider

`zcode-kit run aider` は、そのプロセスに限って `OPENAI_API_BASE` と `OPENAI_API_KEY` を設定します。システム全体には何も設定せず、`~/.aider.conf.yml` にも触れません。引数がなければ `aider --model openai/glm-5.3` を実行します。引数を渡す場合は、モデルを自分で指定してください（例：`zcode-kit run aider -- --model openai/glm-5.3-flash`）。`generated/aider-zcode.env` には、手動で使うための同じ値が入っています。

### Continue

セットアップは「ZCode GLM-5.3」と「ZCode GLM-5.3-Flash」を、`models:` リストの末尾にマーカー付きのブロックとして追加します。既存のモデルは保持されます。`config.yaml` がない場合、セットアップは Continue をスキップします。ファイルができたら `zcode-kit integrate continue` を実行してください。項目を 1 行に書いた `models:` リストは編集しません。先にブロック形式のリストに書き直してください。

### Goose

フォルダーは、Windows では `%APPDATA%\Block\goose\config\custom_providers`、macOS と Linux では `~/.config/goose/custom_providers` です。キーは `zcode.json` に保存されません。Goose は kit のキー取得スクリプトを実行してキーを取得します。この kit が書いたものではない `zcode.json` は上書きしません。

### Cline と Kilo Code

kit は、VS Code がこれらの拡張機能のために保持しているストレージには書き込みません。セットアップが値をまとめたファイルを書き出すので、拡張機能の設定画面で一度だけ入力してください。

- **Cline：** API Provider「OpenAI Compatible」、末尾が `/v1` のベース URL、キー、モデル ID。ファイルには Cline CLI 用の `cline auth` コマンドも記載されています。
- **Kilo Code：** API を「Anthropic Messages」にしたカスタム provider、末尾が `/v1` のベース URL、キー、手動で追加する 2 つのモデル。kit は `kilo.jsonc` を書きません。

この 2 つのファイルにキーは含まれません。キーは `zcode-kit models --show-key` で表示できます。セットアップがこれらの拡張機能を探すのは `~/.vscode/extensions` だけです。他のエディターの場合は `zcode-kit integrate cline` または `zcode-kit integrate kilo-code` を実行してください。

## MCP ブリッジ

ブリッジ `zcode-harness` はローカルの MCP サーバーで、アシスタントからインストール済みの ZCode のセッションやタスクを扱えるようにします。登録してもモデルは接続されません。

セットアップは、そのアシスタントにチェックを付けるか `y` と答えた場合、または `--harness` で指定した場合に、OMP（`~/.omp/agent/mcp.json`）と Claude Code（`claude mcp add zcode-harness --scope user`）にブリッジを登録します。リストと質問にその旨が表示されます。`--no-mcp` を付けるとブリッジは登録されず、`integrate` がブリッジを登録することはありません。Claude Code では、これが通常の設定に対する唯一の変更です。`claude mcp remove zcode-harness --scope user` または `zcode-kit uninstall` で削除できます。他の MCP クライアントでは次のエントリーを使えます。

```json
{
  "mcpServers": {
    "zcode-harness": {
      "type": "stdio",
      "command": "node",
      "args": ["--max-semi-space-size=1", "<kit の絶対インストールパス>/mcp/zcode-harness-mcp/dist/index.js", "--stdio"]
    }
  }
}
```

ブリッジには、インストール済みでログイン済みの ZCode Desktop が必要です。モデル一覧はプロキシのものと異なる場合があります。記録されている検証（Windows 11、ZCode 0.16.9、2026-09-23）では、ブリッジは GLM-5.3-Flash を一覧に表示して選択できましたが、プロバイダーがモデルへのリクエストをコード 1113（残高不足）で拒否したため、ブリッジ経由のモデル応答は確認できていません。詳しくは[ブリッジのドキュメント](../mcp/zcode-harness-mcp/README.ja.md)を参照してください。

## その他のクライアント

OpenAI または Anthropic の API に対応したクライアントであれば、統合なしでプロキシを使えます。`zcode-kit proxy start` と `zcode-kit proxy status` は、ベース URL、キー、モデル ID を表示します。完全なキーは対話的なターミナルでのみ表示されます。それ以外では `zcode-kit models --show-key` で表示できます。以下の例はデフォルトポート `8457` を使います。

```yaml
# OpenAI 形式
base_url: http://127.0.0.1:8457/v1
api_key: <ローカルのプロキシキー>
model: glm-5.3            # または glm-5.3-flash
```

```yaml
# Anthropic 形式
base_url: http://127.0.0.1:8457
auth_token: <ローカルのプロキシキー>
model: glm-5.3
```

プロキシは `POST /v1/messages`（Anthropic）、`POST /v1/chat/completions` と `POST /v1/responses`（OpenAI）、`GET /v1/models`、`GET /health`、`GET /quota` を提供します。いずれもキーが必要で、`Authorization: Bearer <キー>` または `x-api-key` で送ります。

### thinking のレベル

どちらのモデルも `low`、`high`、`max` のレベルに対応します。[effort の対応表](../EFFORT_MAPPING.md)（英語）を参照してください。

- **OpenAI 形式：** `reasoning_effort` を送ります。`medium` は `high` として扱われ、このフィールドがないリクエストは `max` で実行されます。プロキシは 8000、16000、32000 トークンのいずれかの thinking 予算を付けます。
- **Anthropic 形式：** `thinking: {type: "enabled", budget_tokens: <n>}` を `output_config: {effort: "low"|"high"|"max"}` と一緒に送ります。
- **Flash は常に thinking を使用します。** thinking を無効にした `glm-5.3-flash` へのリクエストは `low` で送られます。

## エラーとクォータ

- **`[1005] exceed quota limit`（HTTP 400）：** クォータを使い切っています。プロキシは約 65 秒間再試行し、その後 Account Rotator に別のアカウントがあればそちらを試します。それでもエラーが返る場合は、クォータが回復するまで待ってください。クォータは `zcode-kit proxy status` で確認できます。
- **`[3007] captcha verify failed`：** プロバイダーの不正利用チェックがリクエストを拒否しました。プロキシは新しいトークンで一度だけ再試行します。それも失敗した場合は、時間を置いてから再試行してください。
- **Flash で `[1210]`：** thinking を無効にする代わりに、`low`、`high`、`max` のいずれかを選んでください。
- **HTTP 401：** `Invalid or missing proxy API key` は、クライアントが誤ったローカルキーを送ったことを意味します。それ以外の場合は、`zcode-kit auth status` でログインを確認し、`zcode-kit auth login zai` で更新してください。`--import` を付けると、Desktop で現在有効な `zai`/`start-plan` のログインを取り込みます。`coding-plan` のログインでは、このオプションを付けずにログインします。
- **出力が始まる前の一時的な障害**（接続の拒否やリセット、HTTP 429、500、502、503、504、524、529、最初のコンテンツの前に失敗したストリーム）は、待ち時間を延ばしながら最大 3 回再試行されます。出力が始まった後は何も再試行しません。`ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS` はプロキシの起動時に読み込まれ、基本の待ち時間をミリ秒で指定します（既定 500、上限 10000）。
- **途中で切れた応答**は、何も示さずに止まるのではなく、エラーで終わります。チャットのストリームでは `data: {"error":…}`、Responses のストリームでは `response.failed`、Anthropic のストリームでは `event: error` です。アシスタントからリクエストを送り直してください。
