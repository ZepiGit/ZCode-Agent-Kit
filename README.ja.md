# ZCode Agent Kit（日本語）

[![CI](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml/badge.svg)](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml)
![Release](https://img.shields.io/github/v/release/ZepiGit/ZCode-Agent-Kit)

[English](README.md) | [中文](README.zh-CN.md) | [Español](README.es.md) | **日本語** | [Deutsch](README.de.md)

> 本ドキュメントは英語原文の翻訳です。相違がある場合は英語版が正となります。

**自分の ZCode Desktop アカウント**を使って、お使いのエージェントハーネスから
モデルへアクセス——追加サブスクリプションも API 購入も不要。ハーネスアダプター
10 種、ローカルプロキシ 1 つ、透過的なロールバック。

```
お使いのハーネス (OMP / pi / Claude Code / Codex / OpenCode / Cline / Kilo Code /
              Aider / Continue / Goose / MCP・OpenAI・Anthropic 対応クライアント全般)
        │
        ├─► ローカル zcode-proxy  http://127.0.0.1:8457（OpenAI + Anthropic + Responses 形式）
        │         └─► zcode.z.ai（start-plan：ZCode Desktop と同じクォータ）
        │
        └─► zcode-harness-mcp (stdio) ──► インストール済みの ZCode Desktop（実デスクトップセッション）
```

モデル：**glm-5.3**（テキスト、コンテキスト 1M）と **glm-5.3-flash**
（テキスト+画像、コンテキスト 1M）。検証済みの推論レベルは
**low / high / max**（デフォルトは max）。

> **作業ツリーの注記（2026-09-15）：** 修復・認証回復・postinstall の変更はローカル
> ソースの説明で、公開済み版の検証結果ではありません。最終検証は未完了で、
> 既存の個人インストールを修復したとは主張しません。

## クイックスタート

**Windows（PowerShell）** — 最新リリースを取得、SHA256 検証済み、
管理者権限不要：

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.ps1 | iex
```

**macOS / Linux**：

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.sh | sh
```

ワンライナーは**最新の公開リリース**からインストーラーを取得します。インストーラーは
そのリリースを自動的に解決します（`ZCODE_KIT_VERSION` でバージョン固定可能、例:
`$env:ZCODE_KIT_VERSION = "v0.2.0"`）。リリースアーカイブをダウンロードして
チェックサムを検証し、ユーザーローカルにインストールします（既定は
`%LOCALAPPDATA%\zcode-agent-kit` または `~/.local/share/zcode-agent-kit`、
`ZCODE_KIT_HOME` で上書き可能）。bun が無ければ v1.4.2 をユーザーローカルに
導入し、ハーネス検出付きで setup を実行します。

**npm / npx：**

```sh
npm install -g zcode-agent-kit
zcode-kit setup

# グローバルインストールを使わない場合：
npx --yes zcode-agent-kit setup
```

npm パッケージは `zcode-kit` と `zcode-agent-kit` の両方のコマンドを提供します。
postinstall は案内を表示するだけで、ランタイムの導入やハーネス設定の変更は
**行いません**。`zcode-kit setup` を明示的に実行してください。setup は冪等性を
意図して設計されています。npm には **Node ≥ 20** が必要で、setup が固定版の
bun 依存関係を導入・確認します。

> npm アーティファクトはメンテナーがリリースごとに公開します。`npm install` が
> 404 を返す場合、このバージョンはまだ npm レジストリに存在しません — 上記の
> インストーラーを使うか、ローカルビルドから
> `npm install -g <repo>/pack/dist` で導入してください。

## 初回の使い方（この順番で）

1. **インストール**（上のコマンド）。setup はインストール済みのハーネスを検出し、
   検出したものだけを扱います。記録された設定変更はロールバックできますが、
   認証情報や依存関係の導入は対象外です（下記参照）。
2. **一度ログイン**：ZCode Desktop アプリがインストール・ログイン済みであること。
   setup はその認証情報を自動で取り込みます（不可能な場合は一回限りのログイン
   コマンドを正確に表示します）。
3. **確認**：`node cli\zcode-kit.mjs status`（プロキシは起動中か？クォータは？）と
   `node cli\zcode-kit.mjs doctor`（完全な診断）。
4. **使う** — 下の*ハーネス別の使い方*を参照。プロキシは必要に応じて自動起動します：
   OMP は拡張経由で自動起動し、キットのラッパー（`bin\zcode-claude`、
   `bin\zcode-codex`、`bin\zcode-aider`、`zcode-kit run ...`）は起動前にプロキシの
   起動を保証します。それ以外（pi、Continue、Goose、素の API クライアント）は
   一度自分で起動してください：`node proxy\zcode-proxy-manager.mjs start`
5. **その後**：導入方法に応じた「更新」を参照。`zcode-kit rollback` は最新の
   トランザクションに記録されたファイル変更を取り消します。`zcode-kit uninstall`
   は統合を削除しますが、共有認証情報は削除しません。

**リポジトリのチェックアウトから**（開発・手動インストール）：

```powershell
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit
cd zcode-agent-kit
$env:ZCODE_KIT_ALLOW_CHECKOUT = "1"     # 明示的な同意：チェックアウトが黙って provider ルートになることはない
node setup.mjs                          # または: node cli\zcode-kit.mjs setup --harness auto
node cli\zcode-kit.mjs doctor
```

必要条件：**Node ≥ 20**（bun はリポジトリチェックアウト時のみ必要。インストーラーは
自身で用意します）、**ZCode Desktop がインストール済みでログイン済み**であること
（認証情報のインポートは既存のデスクトップログインから行います。MCP ブリッジによる
モデル応答にはデスクトップアプリの起動が必要です）。管理者権限は一切不要です。
WSL は検出して拒否します——Windows ホストにインストールしてください。

## zcode-kit CLI

```
zcode-kit setup [--harness auto|omp,pi,...]   ブートストラップ + 検出済みハーネスの統合
zcode-kit integrate <harness> --dry-run       書き込み内容の事前確認
zcode-kit integrate <harness>                 アダプターを 1 つ適用（トランザクション）
zcode-kit run <harness> -- <args>             ZCode 接続で claude-code/codex/aider/opencode を起動
zcode-kit doctor [--fix] [--harness <id>] [--json]  診断・明示的な修復
zcode-kit status                              プロキシ状態 + クォータスナップショット
zcode-kit models [--json] [--show-key]        利用可能モデル一覧（稼働中プロキシから）
zcode-kit usage --json                        アカウントの使用量/クォータ（値を捏造しない）
zcode-kit auth status|login|logout            プロキシ資格情報のライフサイクル
zcode-kit update                              チェックアウトを fast-forward し統合を再適用
zcode-kit rollback [tx-id]                    最新（または指定）トランザクションを取り消し
zcode-kit uninstall                           kit の統合を削除（共有資格情報は削除しない）
```

記録された設定変更にはハッシュ付きバックアップを作成します。完了済みトランザクションの
ロールバックでは、その後のユーザー変更を上書きせず競合として報告します。
`setup` / `integrate` は途中まで成功してから失敗することがあります。その場合は
部分的な変更を記録して rollback コマンドを表示し、全体を自動では取り消しません。
ローカルキー作成、認証情報、依存関係の導入、外部 CLI の操作は**すべてが復元可能な
わけではありません**。外部登録は表示された取り消しコマンドが必要な場合があります。

## setup の挙動

`setup --harness auto` はインストール済みハーネスのみを検出し、**その対象だけを
変更します**——OMP しか無い環境に Claude/Codex の成果物は作られません：

1. **bootstrap** — ローカルプロキシキー（`.proxykey`、排他的作成）と
   `proxy/config.yaml` を生成し、`bun install --frozen-lockfile` で依存を導入
   （失敗はハードエラー）、既存の ZCode Desktop ログインから資格情報をインポート。
2. **10 個のアダプター**（検出または明示指定されたハーネスのみ）——
   `harnesses/README.md` と `SUPPORT_MATRIX.json` を参照。
3. **MCP ブリッジ** — 実在するハーネスにのみ `zcode-harness` stdio ブリッジを登録。
   MCP 登録だけがモデル統合として数えられることはありません（Cline/Kilo は
   manual-confirmation-required と明示）。

OMP しか無いマシンでは、実行されるのは OMP アダプターと OMP の MCP エントリー
だけで、Claude/Codex 関連は一切作られません。

**Continue YAML:** 既存の `models: []`（水平空白や、空白で区切ったコメントも可）を
ブロックリストへ変換してからモデルを追加します。インデントあり・なしのリストでも
ユーザーのモデルを先頭に保ち、既定の順序を変えません。再実行は冪等です。空でない
インラインリスト、重複 `models` キー、未対応形式はファイルを変更せず拒否します。
`~/.continue/config.yaml` の管理領域には JSON 形式で引用した**ローカルプロキシキー**を
保存します。Desktop 認証情報ではなく、ログにも出力しません。キー変更後は再統合して
ください。旧 `${ZCODE_PROXY_KEY}` は Continue の有効な秘密値展開ではありません。
追加の環境ファイルは作成しません。検証環境に Continue がないため、**実接続検証は
ブロック中**です。パーサー・設定テストは実クライアントセッションの証明ではありません。

## ハーネス別の使い方

**OMP**（追加型プロバイダー、thinking レベル込みの完全統合）：

```bash
omp --model zcode/glm-5.3-flash --thinking low -p "hi"
omp --model zcode/glm-5.3 --thinking max
```

**pi**（`~/.pi/agent/models.json`、追加型プロバイダー `zcode`）：

```bash
pi --model zcode/glm-5.3
```

**Claude Code**（オプトインのラッパー、`~/.claude` は変更しません）：

```bat
bin\zcode-claude.cmd -p "hi" --model glm-5.3-flash
```

**Codex CLI**（オプトインのラッパー、隔離された CODEX_HOME）：

```bat
bin\zcode-codex.cmd exec "say hi" -m glm-5.3-flash
```

**Aider / OpenCode / Goose**（ランチャーはプロセスローカルの環境変数のみ設定）：

```bat
node cli\zcode-kit.mjs run aider -- --model openai\glm-5.3-flash
node cli\zcode-kit.mjs run opencode -- .
goose session --provider zcode
```

**Cline / Kilo Code**（GUI 設定）：kit は準備した値シートを `generated/` に書き、
`manual-confirmation-required` として明示します——VS Code の内部状態には
一切触れません。

**その他のクライアント**（`http://127.0.0.1:8457` で OpenAI / Anthropic /
Responses 形式、Bearer トークン = `.proxykey` の内容）：`harnesses/README.md`
を参照。

## 診断と限定的な修復（現在のソース、最終検証待ち）

`zcode-kit doctor` は診断、`zcode-kit doctor --fix` は明示的な修復です。
`--harness <id>` で対象を限定し、`--json` で構造化結果を得られます。修復は一般的な
setup や依存関係の導入を行わず、setup ロック内で対象アダプターを再適用します。
キーの不一致は、明確に kit テンプレートと一致し、ポートを排他的に確保できる場合のみ
修正します。キー修正は独自・破損した設定や使用中ポートでは拒否します。一致済みの
キーなら設定を書き換えません。チェックアウトには引き続き
`ZCODE_KIT_ALLOW_CHECKOUT=1` が必要です。修復失敗時は記録されたファイル変更を
ロールバックします。これは部分変更を残す setup と異なり、認証情報や外部操作は対象外です。

共通の起動前チェックは安全にプロキシを起動・確認し、タイムアウト付きで一度だけクォータを
確認します。定期ポーリング・再試行ループはありません。認証 `3012` と残高・クォータ
`1113` / `3001` を区別し、再起動でクォータは増えません。上流の認証・残高異常や情報取得不能は警告しますが、モデル要求で限定的な認証回復を
試せるよう正常なローカルプロキシの利用を継続します。利用可能クォータの証明でも
残高ゼロの捏造でもありません。ローカルの識別・起動失敗はラッパーの起動を止めます。外部・識別不能のリスナーや古い所有権
ロックを強制的に処理しません。`logs/heal.log` は容量制限付きの固定分類ログで、
プロバイダーの応答本文は含めません。

OMP は起動前チェック後、認証付きローカルヘルス確認を 60 秒間キャッシュします。
後続要求で停止したプロキシを回復でき、起動失敗後は 1 分待ちます。正常な各ターンで
上流クォータを繰り返し問い合わせることはありません。

通常の setup は最小限の Flash 実リクエストも一度試みるため、クォータを消費する場合が
あります。`ZCODE_KIT_SKIP_SMOKE=1` または CI/test では省略します。失敗を報告しても
保存済み統合は取り消しません。この実装の存在だけでは実接続検証済みとはいえません。

## プロキシ管理

```bat
node proxy\zcode-proxy-manager.mjs status
node proxy\zcode-proxy-manager.mjs start
node proxy\zcode-proxy-manager.mjs stop
node proxy\zcode-proxy-manager.mjs restart
node proxy\zcode-proxy-manager.mjs doctor
node proxy\zcode-proxy-manager.mjs logs 50
```

安全性：127.0.0.1 のみにバインド。認証付きヘルス/識別チェック。fail-closed な停止
（ポート上の身元不明・外部プロセスは**決して殺さない**。プロセス開始時刻で PID
再利用を検出）。並列起動に対するロック。graceful→強制の二段階シャットダウン。ログ
ローテーションと有界読み取り。トライアル請求・オフピークチャネルは無効。`doctor`
は JWT 経過年齢と実際の認証有効性を分け、存在するコンポーネントだけを検査します。

## セキュリティ & オートメーション方針

率直に記載します。このツールがあなたに合うか判断する材料にしてください：

- **CAPTCHA の扱い。** z.ai ゲートウェイは通常のクライアントプロトコルの一部
  としてチャレンジページを返します — 公式 ZCode Desktop アプリはそれを自動的
  かつ不可視に応答しています。同梱プロキシは**あなた自身のログイン済み
  アカウント**に対してこの挙動をそのまま再現します：公式クライアントと同じ
  方法でゲートウェイのチャレンジに応答します。人間による認証ゲートを迂回する
  ものはなく（これらのチャレンジを人間が解くことはそもそもない）、他の
  アカウントには触れず、CAPTCHA 代行サービスやサードパーティソルバーも
  使用しません。
- **トライアル自動化なし。** トライアル自動請求（claim）やオフピーク
  スケジューリングは、kit が同梱する設定のどこにも存在せず、監査対応後は
  基底のデフォルトも fail-closed（`false`）になりました：claim ブロックが
  欠落・破損した設定で請求が有効化されることはありません。有効化には自身の
  設定に明示的な `claim.enabled: true` が必要です。
- **MCP スコープ。** `zcode-harness` ブリッジは意図的に**ユーザースコープ**で
  登録されます：マシン全体の統合であり、プロジェクト単位ではありません。
  取り消しは 1 コマンド（`claude mcp remove zcode-harness --scope user`）で、
  ブリッジ自身は未認証・非ループバックの要求に一切応答しません。
- **テンプレートではなくコードで強制**（監査対応）：プロキシはループバック
  以外のバインドを拒否し、実際のベアラーキーなしでは起動しません。アダプター
  は所有していない provider エントリの上書きを拒否し、setup はソース
  チェックアウトからのユーザー設定書き込みを拒否します。

## ログインの更新

ランタイムは要求時に保存済みプロキシ認証情報を再読み込みします。不正・部分書き込み
データは直前の有効値を置き換えません。ストアがない場合（logout）は再読み込みで
消去しますが、実行中の要求の中断や上流トークンの失効は行いません。明示的に注入された
認証情報は既定で隔離されたままです。プロセスごとの失敗認証値・ソース変更の組は
最大 128 件で、上限後は再起動まで自動インポートを停止します。保存前にストアを比較
しますが、プロセス間ロックはなく、他の書き込みとの短い競合可能性が残ります。
一般的なアトミック compare-and-swap の保証ではありません。

応答を出力する前の特定の非ストリーミング認証・残高エラーでは、既存 Desktop ログインを
一度再インポートし、**有効な認証値が変わった場合のみ**一度再送できます。同時要求は回復を
共有し、失敗した認証値と Desktop ファイルの変更ごとに試行を制限するため、後のログインを
検出できます。有効な更新値は、観測済みストアに変更がない場合のみ暗号化してプロキシ側に
保存します。Desktop ファイルの変更、ブラウザログイン、キー作成、trial 取得、無限再試行は
ありません。SSE・ストリーム途中のエラーは再送しません。回復できなければ要求は失敗し、
権限やクォータをローカルで修復することはできません。

意図的に手動更新する場合：

```bash
cd zcode-proxy-src
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts auth login zai --import
# またはブラウザログイン：
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts auth login zai
```

## アンインストール / ロールバック

```bat
node cli\zcode-kit.mjs rollback      :: 最新トランザクションを取り消し（1 回に 1 ステップ）
node cli\zcode-kit.mjs uninstall     :: kit 所有分をロールバックし generated/ を削除
node proxy\zcode-proxy-manager.mjs stop
```

`uninstall` は `~/.zcode-proxy/credentials.json`（他ツールと共有）や ZCode
Desktop のログイン・データを削除しません。`zcode-kit auth logout` はプロキシ自身の
保存資格情報のみを削除し、その旨を表示します。

## 更新

ソースチェックアウトでは `zcode-kit update` は変更のある作業ツリーを拒否し、
fast-forward のみで更新します。統合の再適用には上記の部分的 setup の挙動が適用
されます。`.git` がないリリース・tarball 導入では拒否するため、インストーラーを
再実行してください。プロキシは固定版（`MANIFEST.md` 参照）で、パッチは `patches/`
にあります。

### リリース自動化（メンテナー向け）

`.github/workflows/release.yml` は `main` push、`v*` タグ、dispatch で起動します。
テスト後の非タグ実行では、npm 未公開かつリモートタグが存在しないか現在の HEAD と
完全一致する場合だけ現行版を再利用します。それ以外は npm とリモートタグの両方で
空いている次の patch（最大 100 候補）を選び commit/tag を push します。dispatch が
同一版の再試行になるのは**この未公開・タグなし/同一 HEAD 条件だけ**です。npm にない
ことだけを理由に別コミットの古い GitHub 資産を再利用しません。タグ実行は既存 npm 版の
公開を省略し、資産は置き換えません。レジストリエラーでは停止します。npm 11.19.1 を
固定し、公開後は版の存在を確認しますが、ダウンロード内容の検証ではありません。
各ゲートと OIDC 公開の成功が必要で、ローカル変更は公開の証拠ではありません。

## テストと証跡

```sh
npm run test          # kit フィクスチャ：トランザクション、安全性、アダプター
npm run test:proxy    # プロキシのプロトコル・認証フィクスチャ
npm run test:mcp      # MCP ブリッジスイート
```

今回の修正前の baseline は **kit 65 / proxy 872 / MCP 42** 件です。MCP の `wmic`
終了処理パスは**未実行**であり、この件数で検証されたとはいえません。
**最終検証は未完了**です。日付付き結果は `TEST_REPORT.md` を参照してください。
ソース確認、フィクスチャ・設定テスト、実モデル呼び出し、公開済みリリースは別の証跡です。
今回の変更について新たな実接続検証や個人インストールの修復を主張しません。
過去の実接続結果は、この作業ツリーの検証結果ではありません。

## ドキュメント

- `SUPPORT_MATRIX.json` — アダプターごとの正確な状態
- `EFFORT_MAPPING.md` / `.json` — low/high/max のアップストリームパラメータへの対応
- `SETUP_REPORT.md`、`TEST_REPORT.md` — 実行コマンド付きのテスト証跡
- `IMPLEMENTATION_STATUS.md` — 決定事項と未解決点
- `harnesses/README.md` — ハーネスごとの詳細と手動統合スニペット
- `MANIFEST.md` — 同梱コンポーネント、コミット、ライセンス
- `docs/RELEASE_CHECKLIST.md` — リリース準備済みと要対応の区別
