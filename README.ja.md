# ZCode Agent Kit

[![CI](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml/badge.svg)](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml)

[English](README.md) | [中文](README.zh-CN.md) | [Español](README.es.md) | **日本語** | [Deutsch](README.de.md)

**自分の ZCode Desktop アカウント**を、好みのコーディングアシスタントから利用するためのキットです。対応クライアントをローカルプロキシへ接続します。アシスタント自体のインストール、アカウント作成、利用枠の購入は行わず、無料・無制限のアクセスも提供しません。

- **モデルプロキシ:** OpenAI Chat Completions、Responses、Anthropic Messages 形式。既定の接続先は `http://127.0.0.1:8457`。
- **モデル:** `glm-5.3`（テキスト）、`glm-5.3-flash`（テキスト・画像）。公称コンテキストは 1M トークン、推論レベルは `low` / `high` / `max`。クライアントの対応状況とアカウント制限は引き続き適用されます。
- **任意の MCP ブリッジ:** インストール済み ZCode ランタイムの操作を公開します。モデルプロバイダー設定とは別機能で、Desktop アプリの起動だけではモデル応答を保証できません。

## 未公開の監査修正

- Desktop の起動は独立した MCP モデル呼び出しの成功を保証しません。設定保存後に setup のモデルテストが失敗した場合は警告であり、モデル利用成功ではありません。
- リリースインストーラーは Bun の絶対パスを `.bun-path` に保存し、グローバル PATH を変更しません。npm の状態は `node_modules` 外の `%LOCALAPPDATA%/zcode-agent-kit/installs/<root-hash>` または `${XDG_STATE_HOME:-$HOME/.local/state}/zcode-agent-kit/installs/<hash>` に保存します。`ZCODE_KIT_STATE_DIR` は絶対パスかつ当該インストール専用としてください。ソース/tarball はルート内を使います。古い npm パッケージを置換する前に setup で移行してください。元データは残りますが、既に失われたデータは復元できません。
- MCP 許可リストはセッション ID 経由の操作にも適用され、`yolo` は `--allow-yolo` が必要です。ログは上限付きで、同じブリッジのクライアントは信頼境界を共有します。
- リモート CAPTCHA JavaScript に OS サンドボックスはなく、キット外部では既定で無効です。手動で起動したプロキシには明示的な `ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA=1` が必要です。キット管理のサービスは `proxyEnv` 経由で自動的に許可し、CAPTCHA チャレンジを自動解決します（プロセス内、OS サンドボックスなし）。プロバイダーの制限を回避するものではありません。
- Start-plan は同梱 ZCode システムブロックを追加し、クライアントの `cache_control` を除去します。キット CWD は `/workspace` ですが、OS・シェル・バージョン・ロケール・トレース・機器情報は送信され得ます。互換性や利用権を保証しません。
- main/dispatch の自動公開は意図した動作です。`ALLOW_PUBLISH` はバージョン整合性のみを確認し、人間の承認や法的許可ではありません。本修正は公開済みリリースの証拠ではありません。

## 1. インストール前の準備

1. **ZCode Desktop:** 自分のアカウントでログイン済み、モデル利用枠があること。
2. **Node.js 20 以上:** ターミナルの PATH から使えること。[nodejs.org](https://nodejs.org/)
3. **Bun:** 永続的な PATH 設定が必要です。[導入手順](https://bun.sh/docs/installation)。検証版は **1.4.2**。npm・ソースの setup が導入するのは Bun を使う依存関係であり、Bun 本体ではありません。
4. OMP、pi、Claude Code、Codex、OpenCode、Cline、Kilo Code、Aider、Continue、Goose のうち、使うアシスタントを別途インストールしてください。

**新しいターミナル**で確認します。

```sh
node --version
bun --version
```

PowerShell と POSIX シェルで使えます。見つからない場合は先に PATH を直してください。リリース用インストーラーは Bun を取得して絶対パスを `.bun-path` に保存します。キットは再起動後もそのパスを使い、グローバル PATH は変更しません。既存の Bun は自動更新せず再利用します。

**Windows:** 管理者権限なしの PowerShell を使用し、Git Bash や WSL から `install.sh` を実行しないでください。**macOS/Linux:** POSIX シェル、`curl`、`tar`、SHA-256 ツール、更新には `rsync` が必要です。Bun の導入には `unzip` も必要です。後述の Windows 検証は Linux/macOS の実クライアント検証を意味しません。

## 2. 一つの方法を選んでインストール

npm 版とリリースインストーラー版を混在させないことを推奨します。別々のキーを持ちながら、同じアシスタント設定を書き換える場合があります。

### 推奨: 公開リリースのインストーラー

**どのディレクトリからでも実行できます**。リポジトリのクローンや kit フォルダーへの移動は不要です。公開スクリプトをダウンロードして実行するため、組織の方針で必要なら先に内容を確認してください。

**Windows — PowerShell:**

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.ps1 | iex
```

**macOS/Linux — POSIX:**

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.sh | sh
```

インストーラーはアーカイブの SHA-256 を確認し、ユーザー領域に配置して setup を実行します。

| OS | kit の場所 | コマンド用 shim |
|---|---|---|
| Windows | `%LOCALAPPDATA%\zcode-agent-kit` | `%LOCALAPPDATA%\Microsoft\WindowsApps\zcode-kit.cmd` |
| macOS/Linux | `$HOME/.local/share/zcode-agent-kit` | `$HOME/.local/bin/zcode-kit` |

優先順位は `ZCODE_KIT_INSTALL_DIR`、`ZCODE_KIT_HOME`、既定値です。**必ず専用の絶対パスを指定してください。ホーム、作業プロジェクト、ソースチェックアウトは指定しないでください。** 更新時に対象のファイルを置換・同期します。これらの変数はインストール先を選ぶもので、導入済み CLI の参照先を後から変更するものではありません。

固定する場合は、実行前に `ZCODE_KIT_VERSION` を `v` を含む既存リリースタグに設定します。最新へ戻す際は設定を解除してください。固定されるのはアーカイブで、上のワンライナーはインストーラースクリプト自体を最新リリースから取得します。

### 代替: npm

Node と Bun を事前に PATH へ設定し、任意の場所で実行します。

```sh
npm install -g zcode-agent-kit
zcode-kit setup
```

現行ソースの postinstall は案内だけを表示し、統合は明示的な setup が行います。古い公開版は動作が異なる場合があります。コマンド名は `zcode-kit` と `zcode-agent-kit`。404 は対象の不存在やアクセス不可を示す場合があり、ローカルの故障を証明しません。

一時的な `npx ... setup` を恒久的な導入に使わないでください。生成設定がパッケージの配置先を参照するため、安定したグローバル導入かインストーラーを使用します。

## 3. 実際に使うインストールを確認

導入後、新しいターミナルを開きます。

**PowerShell:**

```powershell
Get-Command zcode-kit -All
node --version
bun --version
zcode-kit help
```

**macOS/Linux:**

```sh
command -v zcode-kit
node --version
bun --version
zcode-kit help
```

`zcode-kit` が見つからなければ上記 shim のディレクトリをユーザー・シェルの PATH に追加して開き直します。複数のコピーがある場合は下記の**明示的なパス**を使ってください。Windows の PowerShell と Git Bash は別のコピーを選ぶ場合があります。

### 絶対パスなら作業ディレクトリに依存しない

ターミナルごとに、**実際に選んだ導入先**を設定します。下記はリリースインストーラーの既定値で、**npm 用ではありません**。独自の場所や checkout なら代入値を変更してください。

**PowerShell:**

```powershell
$KitRoot = Join-Path $env:LOCALAPPDATA 'zcode-agent-kit'
if (-not (Test-Path (Join-Path $KitRoot 'cli/zcode-kit.mjs'))) { throw 'Wrong KitRoot: cli/zcode-kit.mjs not found' }
node (Join-Path $KitRoot 'cli/zcode-kit.mjs') help
```

**macOS/Linux:**

```sh
KIT_ROOT="$HOME/.local/share/zcode-agent-kit"
if [ -f "$KIT_ROOT/cli/zcode-kit.mjs" ]; then
  node "$KIT_ROOT/cli/zcode-kit.mjs" help
else
  printf '%s\n' 'Wrong KIT_ROOT: cli/zcode-kit.mjs not found' >&2
fi
```

失敗したら先へ進まずパスを修正します。npm では `npm root -g` がグローバルモジュールの場所を示し、その `zcode-agent-kit` サブディレクトリが kit です。別方式のパスを流用しないでください。

**任意のフォルダーから `node cli/zcode-kit.mjs` を実行しないでください。** 相対パスの基準は現在地です。グローバルコマンドか絶対パスなら混同を防げます。

## 4. 設定して最初のモデル呼び出しを行う

Setup は実行ファイル・設定ディレクトリからアシスタントを検出してアダプターを適用します。検出だけで導入や動作の成功は証明できません。対象の指定・プレビュー例:

```sh
zcode-kit setup --harness omp
zcode-kit integrate continue --dry-run
```

先にセクション 3 で呼び出すコピーを確認してください。Setup はユーザー設定や MCP 登録を変更できます。トランザクションを記録しますが、**全体を一括で元に戻す処理ではありません**。後半で失敗すると前半の変更は残り、rollback コマンドを表示します。

現行 setup は利用枠を消費し得る小さな Flash 実リクエストも試みます。その実行で `ZCODE_KIT_SKIP_SMOKE=1` を設定すれば省略でき、CI/test も省略します。Smoke の失敗は設定を自動で取り消しません。`doctor --fix` は依存関係の導入や一般 setup を行いません。

```sh
zcode-kit status
zcode-kit doctor
zcode-kit auth status
zcode-kit usage --json
```

プロキシ未起動なら失敗する場合があります。セクション 6 で起動するか、自動起動するアシスタントを使ってください。**ヘルス確認や終了コードだけではモデル利用を証明できません。** `logged_in`、利用枠の診断、実際の回答を確認します。

### アシスタントは kit ではなく自分のプロジェクトで起動

**編集してほしいプロジェクト**でターミナルを開くか、PowerShell の `Set-Location` / POSIX の `cd` で移動します。ランチャーはこの作業ディレクトリを保持します。

**OMP は直接起動し、`zcode-kit run omp` は使いません:**

```sh
omp -p --model zcode/glm-5.3-flash "Reply with 52"
omp -p --model zcode/glm-5.3 "Reply with 52"
```

期待結果は `52`、終了コード 0。遅延は変動し、タイムアウトは失敗として扱います。対話形式:

```sh
omp --model zcode/glm-5.3 --thinking max
```

**その他の kit ランチャー:** `--` より後がアシスタントへの引数です。

```sh
zcode-kit run claude-code -- -p "Reply with 52" --model glm-5.3-flash
zcode-kit run codex -- exec "Reply with 52" -m glm-5.3-flash
zcode-kit run aider -- --model openai/glm-5.3-flash
zcode-kit run opencode -- .
```

Windows でもモデル識別子は `/` を使います。`run` が対応するのは **`claude-code`、`codex`、`aider`、`opencode` のみ**。これらと OMP 拡張はプロキシを確認・起動します。それ以外は手動起動してください。

## 5. 各統合の内容

| ID | 設定・使い方 |
|---|---|
| `omp` | プロバイダー、モデル、自動起動拡張、任意の MCP 登録。`omp` を直接実行。 |
| `pi` | `~/.pi/agent/models.json` に `zcode` を追加。プロキシ起動後 `pi --model zcode/glm-5.3`。 |
| `claude-code` | 生成設定と任意ランチャー。通常の Claude モデル設定を置換しませんが、setup はユーザー範囲に MCP を登録する場合があります。他社モデル接続はコミュニティ互換です。 |
| `codex` | `generated/codex-home` の隔離された `CODEX_HOME`。個人設定・skills は自動で引き継がれません。 |
| `opencode` | プロバイダー追加。`zcode-kit run opencode -- .` がプロセスにキーを渡します。 |
| `aider` | 生成環境とランチャー。他の引数を渡すなら `--model openai/glm-5.3-flash` を指定。 |
| `continue` | **既存の** `~/.continue/config.yaml` を更新。不在なら省略。Continue を先に設定して再統合し、UI でモデルを選択。 |
| `goose` | キーヘルパー付きの永続的カスタムプロバイダー。プロキシ起動後 `goose session --provider zcode`。 |
| `cline` | `generated/cline-zcode-values.md` の値を UI に手動入力。 |
| `kilo-code` | `generated/kilo-zcode-values.md` の値を UI に手動入力。 |

10 アダプターがあることと、10 クライアントの実接続検証は別です。日付付き [対応表](SUPPORT_MATRIX.json)と[CI 実行](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml)を参照。Cline/Kilo の確認は値シートの存在であり、**GUI 設定完了ではありません**。MCP 登録だけではモデルを利用できません。

**現行 Continue:** `models: []`、コメント、ブロックリストの字下げを扱い、ユーザーモデルと既定順序を先頭に保ちます。非空インラインリスト、重複キー、危険な形式は拒否します。ローカルキーは YAML の引用値として保存し、`${ZCODE_PROXY_KEY}` という非対応の展開は使いません。キー更新後は再統合・対応修復を行ってください。Continue 本体の実接続テスト済みとは主張しません。

## 6. プロキシを明示的に起動・確認・停止

セクション 3 の変数を使えばプロジェクトに留まったまま操作できます。

**PowerShell:**

```powershell
node (Join-Path $KitRoot 'proxy/zcode-proxy-manager.mjs') start
node (Join-Path $KitRoot 'proxy/zcode-proxy-manager.mjs') status
node (Join-Path $KitRoot 'proxy/zcode-proxy-manager.mjs') logs 50
```

**macOS/Linux:**

```sh
node "$KIT_ROOT/proxy/zcode-proxy-manager.mjs" start
node "$KIT_ROOT/proxy/zcode-proxy-manager.mjs" status
node "$KIT_ROOT/proxy/zcode-proxy-manager.mjs" logs 50
```

他の操作は `status` を `doctor`、`stop`、`restart` に置き換えます。**停止・再起動は接続クライアントを中断します。** 8457 を使用しているだけでプロセスを終了しないでください。管理器は外部・識別不能のプロセスを拒否し、自分のプロセスの識別情報・開始時刻を確認します。古いロックを自動で奪いません。

## 7. トラブル対処と限定的な自動回復

| 症状 | 確認・対処 |
|---|---|
| `zcode-kit` / `node` / `bun` がない | 新しいターミナルで PATH を確認。kit は絶対パスも使えます。npm/ソース setup は Bun 自体を導入しません。 |
| `Cannot find module .../cli/zcode-kit.mjs` | 相対パスの現在地または導入先が誤っています。スクリプトをプロジェクトへコピーせず絶対パスを直してください。 |
| Continue `models: []` で失敗 | 古い公開版には修正がありません。対応リリースまたは明示的なソース導入を利用し、`models` キーを重複追加しないでください。 |
| 不明なコマンド・非対応 `run` | OMP/pi/Goose は直接実行。`run` は上記 4 種だけです。 |
| `foreign` / ポート使用中 / HTTP 401 | 複数コピーとコマンド解決先を確認。キー削除、ロック奪取、外部プロセス終了は行わないでください。 |
| Auth `3012` / `logged_in: false` | Desktop ログインを確認。現行版は限定回復を試みます。意図的なログインは `zcode-kit auth login`。 |
| 残高・利用枠 `1113` / `3001` | アカウント・プランを確認。再起動やローカル修復で枠は増えません。 |
| Setup 後半で失敗 | 前半の変更が残る場合あり。記録と表示された rollback を確認。 |
| `doctor --fix` 後も終了 1 | プロキシ停止や手動作業が残る場合あり。個々の結果を読む。 |
| 停止中でも `models --json` が成功 | レジストリへのフォールバックの可能性。`source` を確認。推論の証拠ではありません。 |

現行ソースの管理対象修復:

```sh
zcode-kit doctor --harness continue --json
zcode-kit doctor --fix --harness continue
```

対象アダプターをロック内で再適用します。Offline のキー整合には明確なテンプレートと確保可能なポートが必要です。独自・破損設定や使用中ポートは拒否し、キーが一致すれば設定を書き換えません。修復失敗時は記録済みファイル変更を戻しますが、通常 setup は部分変更を残します。認証、依存導入、外部登録すべてがファイル rollback の対象ではありません。

起動前チェックは上流認証・枠エラーを警告してモデル側回復を許可し、ローカル識別・起動失敗ではラッパーを止めます。OMP はローカル health を 60 秒保持、失敗後は 1 分待機。毎ターン枠を照会しません。`logs/heal.log` は固定分類でサイズ制限があります。

認証情報を要求ごとに再読み込みします。破損・途中書き込みでは最後の有効値を維持、ストアがなければ消去します。応答前の一部エラーで **既存 Desktop ログイン**を取り込み、実効認証が変わった場合のみ一度再送します。Desktop ファイル変更、API キー作成、購入、trial 取得はせず、進行中 SSE エラーは再送しません。回復・保存試行は有限で成功保証なし。同時書き込みやプロセス上限は [SECURITY.md](SECURITY.md) を参照。

## 8. 更新・rollback・アンインストール

**元の導入方法を維持してください。**

- インストーラー: 同じ専用ディレクトリへ再実行。公開ファイルのみで、未公開 Git 変更ではありません。古いバージョン固定を解除してください。
- npm: `npm install -g zcode-agent-kit@latest`、続いて同じ npm コピーで `zcode-kit setup`。
- Checkout: **そのルートで** `node cli/zcode-kit.mjs update`。クリーンなツリーで fast-forward し、setup を再適用。リリースタグ選択ではありません。`.git` のない版は拒否します。

記録された設定を戻す:

```sh
zcode-kit rollback
```

ID なしは最新、表示済み ID を指定すれば対象を選べます。後から編集した内容は競合として報告します。認証、依存、外部登録がすべて戻るとは限りません。

先にセクション 6 の**絶対パスの管理器**で対象プロキシを止め、その後:

```sh
zcode-kit uninstall
```

Uninstall 自体はプロキシを止めず、導入フォルダー、依存、ログ、`.proxykey`、共有認証、Desktop データも削除しません。記録済み統合、生成ファイル、一致する installer shim を削除します。npm のパッケージ削除 `npm uninstall -g zcode-agent-kit` は**その後**に行います。残存フォルダーは内容確認後に手動削除してください。

`zcode-kit auth logout` は対象パスを説明し、`zcode-kit auth logout --yes` は `ZCODE_PROXY_CREDENTIALS_PATH` も反映して削除します。Desktop ログアウトや上流トークン失効ではありません。通常の修復として logout を使わないでください。

## 9. ソース導入・開発（上級者向け）

現行ソースが必要な場合のみ選びます。Node、Bun、Git を先に導入し、編集対象プロジェクトではなく**新しい専用フォルダー**へ clone します。リリースインストーラーを checkout に実行しないでください。

**PowerShell:**

```powershell
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit
if ($LASTEXITCODE -ne 0) { throw 'Clone failed; stop here' }
Set-Location zcode-agent-kit -ErrorAction Stop
$env:ZCODE_KIT_ALLOW_CHECKOUT = '1'
try { node cli/zcode-kit.mjs setup --harness omp }
finally { Remove-Item Env:ZCODE_KIT_ALLOW_CHECKOUT -ErrorAction SilentlyContinue }
```

**macOS/Linux:**

```sh
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit &&
cd zcode-agent-kit &&
ZCODE_KIT_ALLOW_CHECKOUT=1 node cli/zcode-kit.mjs setup --harness omp
```

Clone と移動が成功した場合のみ進み、失敗後は後続行を実行しないでください。例は `omp` に限定しています。使う対象または `auto` を指定できます。明示許可は意図しない別コピーへの設定変更を防ぎます。Checkout setup はグローバル shim を作らないため、後で絶対パスを使ってください。参照される checkout を移動せず、アシスタント開始前には**作業プロジェクト**へ戻ります。

Proxy/MCP 依存を導入後、**checkout ルート**でテストします。Fixture・ビルドファイルを生成するため、厳密な隔離が必要なら使い捨てコピーを用意します。

```sh
npm run test
npm run test:proxy
npm run test:mcp
```

最新のテスト結果は [CI 実行](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml) を参照してください。ローカルの実行結果はコミットしません。自動テストは実アカウントやモデルへの接続を保証しません。

メンテナー向け: `main` push、`v*` タグ、dispatch は公開を起動し得ます。npm とリモートタグを照合して他コミットの資産再利用を防ぎ、未公開版の再試行は条件付きです。テスト、バージョン・パッケージゲート、OIDC、再配布条件は必要です。[公開チェックリスト](docs/RELEASE_CHECKLIST.md)を参照。ローカル成功は npm 公開成功ではありません。

## セキュリティと関連文書

認可された自分のアカウントのみ使用してください。`.proxykey`、生成設定・env、プロファイル内容を保護し、issue に貼らないでください。Proxy は loopback 専用・bearer 認証です。Gateway challenge 処理は同梱プロトコル実装で、提供元の承認や将来の互換性を保証しません。Trial 取得・off-peak 自動化は既定で無効です。設定変更・公開前に [SECURITY.md](SECURITY.md) を読んでください。

- [クライアント詳細](harnesses/README.md)・[対応表](SUPPORT_MATRIX.json)
- [推論レベル対応](EFFORT_MAPPING.md)
- [CI 実行](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml)・[対応表](SUPPORT_MATRIX.json)
- [同梱コンポーネントとライセンス](MANIFEST.md)
- [公開チェックリスト](docs/RELEASE_CHECKLIST.md)
