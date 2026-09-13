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

## クイックスタート

**Windows（PowerShell）** — バージョン固定インストーラー、SHA256 検証済み、
管理者権限不要：

```powershell
& ([scriptblock]::Create((irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/download/v0.2.0/install.ps1)))
```

**macOS / Linux**：

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/download/v0.2.0/install.sh | sh
```

インストーラーは固定バージョンのリリースアーカイブをダウンロードしてチェックサムを
検証し、ユーザーローカルにインストールします（既定は
`%LOCALAPPDATA%\zcode-agent-kit` または `~/.local/share/zcode-agent-kit`、
`ZCODE_KIT_HOME` で上書き可能）。bun が無ければ v1.4.2 をユーザーローカルに
導入し、ハーネス検出付きで setup を実行します。

**リポジトリのチェックアウトから**（開発・手動インストール）：

```powershell
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit
cd zcode-agent-kit
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
zcode-kit doctor [--harness <id>] [--json]    機械可読な診断
zcode-kit status                              プロキシ状態 + クォータスナップショット
zcode-kit models [--json] [--show-key]        利用可能モデル一覧（稼働中プロキシから）
zcode-kit usage --json                        アカウントの使用量/クォータ（値を捏造しない）
zcode-kit auth status|login|logout            プロキシ資格情報のライフサイクル
zcode-kit update                              チェックアウトを fast-forward し統合を再適用
zcode-kit rollback [tx-id]                    最新（または指定）トランザクションを取り消し
zcode-kit uninstall                           kit の統合を削除（共有資格情報は削除しない）
```

すべての書き込みはトランザクション対象です。ファイルはまずハッシュ化・バックアップ
され、ロールバックは所有権を考慮します——後から行われたユーザー変更は競合として
報告され、決して上書きされません。

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

## ログインの更新

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

`zcode-kit update` は汚れたワークツリーでは拒否し、fast-forward のみで強制更新は
しません。統合はトランザクション的に再適用されます。同梱プロキシは固定版
（`MANIFEST.md` 参照）、ローカルパッチは `patches/` にあります。

## テスト

```bat
npm run test          :: kit スイート（node --test）：トランザクション、マネージャ安全性、アダプター
npm run test:proxy    :: 858 件の bun テスト（SSE 境界、ツール引数、中断、usage などの契約テスト含む）
npm run test:mcp      :: MCP ブリッジスイート（36 件、HTTP 認証/オリジンゲート、アローリスト脱出を含む）
```

## ドキュメント

- `SUPPORT_MATRIX.json` / `.md` — アダプターごとの正確な状態
- `EFFORT_MAPPING.md` / `.json` — low/high/max のアップストリームパラメータへの対応
- `SETUP_REPORT.md`、`TEST_REPORT.md` — 実行コマンド付きのテスト証跡
- `IMPLEMENTATION_STATUS.md` — 決定事項と未解決点
- `harnesses/README.md` — ハーネスごとの詳細と手動統合スニペット
- `MANIFEST.md` — 同梱コンポーネント、コミット、ライセンス
- `docs/RELEASE_CHECKLIST.md` — リリース準備済みと要対応の区別
