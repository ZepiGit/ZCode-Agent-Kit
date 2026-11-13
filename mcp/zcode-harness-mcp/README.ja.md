# zcode-harness-mcp
[English (original)](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · **日本語** · [简体中文](README.zh-CN.md)

> 本ドキュメントは英語原文の翻訳です。相違がある場合は英語版が正となります。

MCP クライアント（コーディングアシスタントなど）に、このマシンにインストール
された ZCode ランタイムのツールを提供するローカルの Model Context Protocol
（MCP）サーバーです。ブリッジはランタイム（`zcode.cjs app-server --stdio`）を
子プロセスとして起動し、その上で 32 個のツールと一連のリソースを提供します。
モデルの一覧、ワークスペースのオープン、セッションの作成、タスクの開始と待機、
権限リクエストへの回答、結果の読み取りができます。

作業を行うのは ZCode ランタイムで、ランタイム自身のツールとこのマシンの ZCode
ログインを使います。ブリッジはリクエストと結果を中継し、タスクの状態を保存
します。キットのプロキシは使いません。ブリッジを登録しても、アシスタントに
モデルが接続されるわけではありません。

## 前提条件

- Node.js 24 以降。ブリッジはプログラム名 `node` でランタイムを起動するため、
  `node` が `PATH` 上に必要です。
- インストール済みでログイン済みの ZCode Desktop。ブリッジは ZCode のログイン
  を管理しません。
- ローカルの stdio サーバーを起動できる MCP クライアント、またはローカルの HTTP
  エンドポイントに `Authorization` ヘッダーを送れる MCP クライアント。

## ZCode ランタイムの検出

ブリッジは、Windows での ZCode Desktop のインストール先から `zcode.cjs` を
探します。

- `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`
- `%LOCALAPPDATA%\ZCode\resources\glm\zcode.cjs`
- `%ProgramFiles%` と `%ProgramFiles(x86)%` の下の同じ 2 つのパス
- `%LOCALAPPDATA%\zcode\app.resources\glm\zcode.cjs`

他の OS の場合やインストール先が異なる場合は、`--runtime-path` または
`ZCODE_HARNESS_RUNTIME_PATH` でファイルを指定します。ファイルが受け入れられる
のは、`node <ファイル> --version` が終了コード 0 で終わり、バージョン番号を出力
した場合だけです。指定したファイルが存在しない、またはこの確認に失敗した場合、
他のランタイムは試しません。このファイルは実行されるので、信頼できるファイル
だけを指定してください。

ランタイムが 1 つも受け入れられなくても、ブリッジは起動します。その場合
`zcode_health` は `degraded: true` と理由を返し、ランタイムを必要とするツール
はエラーを返します。

ランタイムには組み込みのプロバイダー設定が必要です。ブリッジは
`zcode-builtin.json` をランタイムのファイルからの相対位置で探し（作業
ディレクトリは探しません）、`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` でランタイム
に渡します。ブリッジの環境にある空でない `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`
が最優先で、次が `ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE`、最後がブリッジ
の見つけたファイルです。変更されるのはランタイムのプロセスの環境だけで、
`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` はそのまま渡されます。選ばれたファイルが
読み取れない場合、ランタイムは起動されず、他のファイルも試しません。パスは
[docs/SECURITY.md](docs/SECURITY.md) にあります。

## インストール

キットのリリース版インストーラーと npm セットアップにはビルド済みのブリッジ
（`dist/`）が含まれ、依存関係もインストールされます。キットのセットアップは
ブリッジをアシスタントに登録できます。どのような場合に登録するかは
[harnesses/README.ja.md](../../harnesses/README.ja.md) に記載しています。

ソースからビルドするには、このディレクトリで次を実行します。

```sh
npm install
npm run build
npm run probe:runtime
```

`npm run probe:runtime` はランタイム検出の結果を JSON で出力します。

## ブリッジの登録

### stdio

```json
{
  "mcpServers": {
    "zcode-harness": {
      "command": "node",
      "args": [
        "<kit>/mcp/zcode-harness-mcp/dist/index.js",
        "--stdio",
        "--allow-workspace", "<path to your projects>",
        "--interaction-policy", "ask"
      ]
    }
  }
}
```

絶対パスを使ってください。設定の形式はクライアントごとに異なります。この例は
一般的な `mcpServers` 形式です。読み取り専用の例は
[examples/config/stdio.mcp.json](examples/config/stdio.mcp.json) にあります。

`workspacePath` を受け取るツールは、許可されたルートの内側にあるディレクトリ
だけを受け付けます。`--allow-workspace` がない場合、許可されるルートはデータ
ディレクトリ内の `workspaces` ディレクトリだけです。

キットが生成するエントリは、スクリプトのパスの前に Node のフラグ
`--max-semi-space-size=1` を置きます。V8 ヒープの若い世代を小さくするもので、
省略できます。

### HTTP

```sh
node dist/index.js --http --http-key "<random local secret>" --allow-workspace "<path to your projects>"
```

エンドポイントは `http://127.0.0.1:3322/mcp` です。すべてのリクエストに
`Authorization: Bearer <key>` が必要です。HTTP モードでは、キーがない場合や、
ホストが `127.0.0.1`、`localhost`、`::1`、その他の `127.x.x.x` アドレス以外の
場合、ブリッジは起動を拒否します。応答するのは `POST` だけで、リクエスト間で
セッションを保持しないため、複数のクライアントが 1 つのブリッジを使えます。
クライアント設定の例は
[examples/config/http.mcp.json](examples/config/http.mcp.json) にあります。

HTTP のコードは `--http` を指定したときだけ読み込まれます。stdio のブリッジ
では読み込まれません。

## オプション

不明なオプションがあると、ブリッジは起動時に停止します。`--read-only` の
つづり間違いが見過ごされないようにするためです。

| オプション | 環境変数 | デフォルト | 意味 |
| --- | --- | --- | --- |
| `--stdio` | | 有効 | stdin と stdout 経由の MCP。ログは stderr に出力されます。 |
| `--http` | | 無効 | stdio の代わりに HTTP 経由の MCP。 |
| `--http-key KEY` | `ZCODE_HARNESS_HTTP_KEY` | なし | Bearer キー。`--http` では必須です。 |
| `--host H` | `ZCODE_HARNESS_HTTP_HOST` | `127.0.0.1` | HTTP のホスト。ループバックアドレスのみ。 |
| `--port N` | `ZCODE_HARNESS_HTTP_PORT` | `3322` | HTTP のポート。 |
| `--allow-workspace P` | `ZCODE_HARNESS_ALLOW_WORKSPACES` | なし | 許可するワークスペースのルート。オプションを繰り返すか、複数のパスを `;` で区切ります。 |
| `--read-only` | | 無効 | 状態を変更するツールは `READ_ONLY_MODE` を返します。 |
| `--allow-yolo` | `ZCODE_HARNESS_ALLOW_YOLO=1` | 無効 | クライアントがモード `yolo` を選べるようにします。このモードはランタイムの権限リクエストを無効にします。 |
| `--runtime-path FILE` | `ZCODE_HARNESS_RUNTIME_PATH` | 検出 | `zcode.cjs` へのパス。 |
| `--data-dir DIR` | `ZCODE_HARNESS_DATA_DIR` | `~/.zcode-harness-mcp` | タスク、結果、イベント、インタラクションの保存先。 |
| `--interaction-policy deny\|allowlist\|ask` | `ZCODE_HARNESS_INTERACTION_POLICY` | `deny` | ランタイムの権限リクエストへの応答方法。 |
| `--interaction-allowlist A,B` | `ZCODE_HARNESS_INTERACTION_ALLOWLIST` | なし | ポリシー `allowlist` が承認する、完全一致のツール名。このポリシーでは必須です。 |
| `--interaction-timeout-sec N` | `ZCODE_HARNESS_INTERACTION_TIMEOUT_SEC` | `300` | 回答のないリクエストが拒否されるまでの秒数。 |
| `--max-concurrent-tasks N` | `ZCODE_HARNESS_MAX_CONCURRENT_TASKS` | `2` | 同時に実行するタスクの数。それ以上のタスクはキューで待ちます。 |
| | `ZCODE_HARNESS_TASK_QUEUE_LIMIT` | `50` | 終了していないタスクの最大数。 |
| | `ZCODE_HARNESS_REQUEST_TIMEOUT_MS` | `60000` | ランタイムへの 1 回のリクエストの制限時間。 |
| | `ZCODE_HARNESS_MAX_ARTIFACT_BYTES` | `10485760` | `zcode_artifact_read` が読み取るファイルの最大サイズ。 |
| | `ZCODE_HARNESS_LOG_LEVEL` | `info` | `debug`、`info`、`warn`、`error` のいずれか。 |
| `--help`, `-h` | | | 使い方の行を出力します。 |

## タスク

`zcode_task_start` はすぐに `taskId` を返します。タスクはその後ランタイムで
実行されます。`zcode_task_wait` は 1 回の呼び出しにつき最大 120 秒、タスクの
終了を待ちます。`zcode_task_get` は状態を、`zcode_task_result` はテキストと
詳細を、`zcode_task_events` はイベントを返します。`zcode_task_input` は追加の
入力を送り、`zcode_task_cancel` はタスクを止めます。すべてのツールは
[docs/MCP_API.md](docs/MCP_API.md) で説明しています。

- **同時実行。** デフォルトでは 2 つのタスクが同時に実行され、それ以上のタスク
  はキューに入ります。終了していないタスクは最大 50 個です。1 つの
  ワークスペースで同時に実行できる書き込みタスクは 1 つ、1 つのセッションで
  同時に実行できるタスクは 1 つです。
- **保持期間。** ブリッジが保持する終了済みタスクは最大 500 個で、終了から
  7 日を超えて保持することはありません。削除されたタスクはレコード、結果、
  イベントを失い、そのタスクには `unknown task: <taskId>` が返されます。
  終了していないタスクと状態が `unknown` のタスクは削除されません。
- **冪等性。** 同じ `idempotencyKey` で `zcode_task_start` をもう一度呼ぶと、
  新しいタスクは開始されず、既存のタスクが返されます。キーはタスクが保持
  されている間だけ記憶されます。その後は、同じキーで新しいタスクが開始
  されます。
- **テキストのサイズ。** タスクの応答テキストは UTF-8 で 4 MiB までです。
  それより長いテキストは最初の 1 MiB と最後の 3 MiB が残り、その間に
  `[… N bytes truncated …]` という行が入ります。この結果は `partial` と
  マークされ、`truncated.droppedBytes` を持ちます。
- **リスト。** 1 つのタスクが保持するのは、警告 200 件、エラー 200 件、ツール
  呼び出し 1,000 件までです。
- **イベント。** タスクのイベントは、それぞれ 4 MiB までのファイル 2 つに保存
  されます。古いイベントは破棄されます。
- **再起動。** ブリッジの再起動後、終了していなかったタスクは `interrupted` と
  マークされます。終了済みタスクの保存された結果は引き続き読み取れます。
- **クライアントの終了。** stdio クライアントが接続を閉じると、ブリッジは終了
  していないタスクを `interrupted` とマークし、ランタイムを停止して終了
  します。停止するのはブリッジが起動したランタイムのプロセスだけで、
  ランタイムが起動したプロセスは停止しません。

## 権限リクエスト

ランタイムは特定のツールを使う前に確認を求め、ユーザーに質問することもあり
ます。これらのリクエストの扱いは `--interaction-policy` で決まります。

- `deny`（デフォルト）：すべてのリクエストを拒否します。
- `allowlist`：ツール名が `--interaction-allowlist` にあれば権限リクエストを
  承認し、なければ拒否します。ユーザーへの質問はクライアントに渡されます。
- `ask`：リクエストはクライアントに渡されます。クライアントは
  `zcode_interaction_respond` で回答し、ランタイムが提示した選択肢の中から
  しか選べません。時間内に回答されなかったリクエストは拒否されます。

ツール `Bash`、`PowerShell`、`Shell` へのリクエストは、どのポリシーでも拒否
されます。読み取り専用モードの場合と、`readOnly` で開始したタスクの場合は、
すべてのリクエストが拒否されます。

## セキュリティ

ブリッジはあなたのユーザー権限で動作し、サンドボックスではありません。

- ワークスペースのパス、セッション ID、ファイルの読み取りは、シンボリック
  リンクとジャンクションを解決したうえで、許可されたルートと照合されます。
- `--read-only` は状態を変更するすべてのツールをブロックします。`readOnly` の
  タスクはランタイムのモード `plan` で実行され、書き込みツールとシェルツール
  が拒否されます。ただし、引き続き許可されているツールがファイルを変更する
  ことまでは防げません。
- モード `yolo` は、ブリッジを `--allow-yolo` 付きで起動した場合を除いて拒否
  されます。
- シークレットは、ツールの結果、イベント、ログ、エラーメッセージの中で伏字に
  されます。
- ランタイムは固定のプログラム名と引数のリストで起動され、シェルを経由
  しません。
- HTTP はループバックアドレスに限定され、Bearer キーが必要です。

詳細は [docs/SECURITY.md](docs/SECURITY.md) にあります。キットのセキュリティ
ポリシーは [SECURITY.md](../../SECURITY.ja.md) にあります。

## ZCode 0.16.9

- `zcode_workspace_open` はワークスペースのモードとスラッシュコマンドを返し
  ます。ランタイムはワークスペースについて、デフォルトのモデルも、モデル
  カタログも、設定のリビジョンも返しません。
- `zcode_models_list` は、プロンプトなしのセッションを作成して閉じることで
  モデルカタログを読み取ります。このときランタイムのサービスが起動することが
  あるため、読み取り専用モードではブロックされます。
- モデル、推論レベル、モードはセッションごとに選びます。`zcode_model_set`
  または `zcode_task_start` の引数を使います。ワークスペースのデフォルトは設定
  もリセットもできません。ツールはエラーを返し、ローカルには何も保存
  しません。
- `zcode_settings_update` の 4 つの設定は、1 つのワークスペースではなく
  ランタイムのプロセス全体に適用され、保存されません。ブリッジはランタイム
  から確認応答を受け取りますが、値を読み戻すことはできません。
- ブリッジ経由のモデルターンは確認されていません。2026-09-23 に Windows 11 で
  行ったテストでは、`zai-api/GLM-5.3-Flash` がカタログにあり、推論レベル `low`
  での選択も確認されましたが、プロバイダーはコード `1113`（残高またはリソース
  パッケージの不足）でターンを拒否しました。記録は
  [SUPPORT_MATRIX.json](../../SUPPORT_MATRIX.json) にあります。キットの
  プロキシ経由で成功するモデルリクエストは、ブリッジ経由のターンについて何も
  示しません。

その他の制限は [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) にあり
ます。

## テストとデモ

```sh
npm test
```

ブリッジをビルドし、ランタイムの代役（`test/fixture/fake-harness.mjs`）に
対してユニットテストと統合テストを実行します。ZCode は不要です。

```sh
LIVE_TEST=1 LIVE_WORKSPACE="<workspace>" LIVE_DATA_DIR="<data directory>" npm run test:live
```

インストール済みの ZCode ランタイムに対して実行され、利用枠を消費することが
あります。`LIVE_TEST=1` と `LIVE_WORKSPACE` がない場合、これらのテストは
スキップされます。

```sh
node examples/demo-client.mjs --workspace "<workspace>"
node examples/demo-client.mjs --fixture
```

クライアントの視点でツールを順に呼び出します。ヘルス、ケイパビリティ、
ワークスペース、モデルカタログ、セッション、タスク、権限リクエスト、結果、
同じセッションでの追加の依頼です。`--fixture` を付けると、インストール済みの
ランタイムの代わりに代役を使います。

## ドキュメント

- [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md)：ブリッジが提供する機能の分野別一覧（英語）
- [docs/MCP_API.md](docs/MCP_API.md)：ツール、リソース、タスクの結果とその制限（英語）
- [docs/SECURITY.md](docs/SECURITY.md)：チェックとその限界（英語）
- [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)：動作しないもの、提供されないもの（英語）
- [docs/PROTOCOL.md](docs/PROTOCOL.md)：ブリッジと ZCode ランタイムのやり取り（英語）

## ライセンス

MIT。[LICENSE](LICENSE) を参照してください。
