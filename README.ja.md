# ZCode Agent Kit
[English (original)](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · **日本語** · [简体中文](README.zh-CN.md)

普段使っているコーディングアシスタントで、自分の ZCode アカウントを利用できます。

![ZCode Desktop とコーディングアシスタントを Agent Kit で接続](zcode_agent_kit.png)

*kit はローカルで動作し、モデルへのリクエストは ZCode に送られます。*

コーディングアシスタントはそのままに、ローカル接続を通じて既存の ZCode モデルと利用枠を使えます。

**オプションのアカウントローテーション:** インストーラーは **"Do you want to activate the Account Rotator feature? [y/n]"** と尋ねます。`y` を選ぶと現在のログインが取り込まれ、その後の `zcode-kit auth login zai` による別アカウントのログインは追加のアカウントとして保存されます。保存済みのユーザーとして再ログインすると、通常はその登録情報が更新されます。ユーザーの照合方法と例外はドキュメントで説明しています。後から有効にするには `zcode-kit accounts enable`、保存済みアカウントの確認には `zcode-kit accounts` を使います。`zcode-kit accounts health [--json]` は、課金データに基づくアカウントごとの判定を要求時に表示します。モデルへのリクエストが成功することの証明ではありません。利用枠データのないアカウントは正常とは見なされず、アカウントを継続的にポーリングすることもありません。詳しくは [Account Rotator のドキュメント (英語)](docs/ACCOUNT_ROTATOR.md) を参照してください。

**手順:** アカウントを準備 → kit をインストール → GLM-5.3(-flash) を使って作業開始。

## ステップ 1 — 必要なものを確認

- [ZCode Desktop](https://zcode.z.ai/en)。自分のアカウントでログイン済みで、モデルの利用枠が残っていること。
- [Node.js 20 以降](https://nodejs.org/)。新しいターミナルで `node --version` を実行して確認します。
- 別途インストールしたコーディングアシスタント。kit が ZCode へ接続します。


## ステップ 2 — kit を一度インストール

以下のリリース版インストーラーまたは npm を選びます。リリース版インストーラーは検出したアシスタントを自動設定するため、後から別のセットアップコマンドを実行する必要はありません。

インストーラーは番号付きの 4 段階、アシスタントごとの簡潔な結果、接続確認を表示します。詳しいセットアップ出力は表示された `install.log` に保存されます。`ZCODE_KIT_VERBOSE=1` で全出力、`NO_COLOR=1` でプレーンテキストにできます。対話的なインストールでは Account Rotator の質問に `y` または `n` で答える必要があります。無人インストールでは `ZCODE_KIT_ACCOUNT_ROTATOR=y` または `n` を指定してください。明示的な回答がなければ、既存の設定が維持されます。接続確認に失敗しても、インストール自体が成功した場合は警告として扱われます。

> **インストーラーを実行する前に:** スクリプトをダウンロードして実行し、検出したアシスタントの設定を変更します。MCP ツールを登録する場合もあります。セットアップでは、利用枠を消費する小さなモデルリクエストも試みます。変更は記録されますが、途中で失敗するとそれ以前の変更が残ることがあります。セキュリティポリシーで必要な場合は、実行前にスクリプトを確認してください。

**Windows — PowerShell、管理者権限は不要:**

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.ps1 | iex
```

**macOS / Linux — POSIX ターミナル:**

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.sh | sh
```

どのディレクトリからでも実行できます。リポジトリのクローンは不要です。インストーラーはセットアップを実行し、Bun がなければインストールできます。Windows では Git Bash や WSL ではなく PowerShell を使ってください。

<details>
<summary>インストール先と macOS/Linux の前提条件</summary>

既定の場所は、Windows では `%LOCALAPPDATA%\zcode-agent-kit`、macOS/Linux では `$HOME/.local/share/zcode-agent-kit` です。作業中のプロジェクトとは別のフォルダーにしてください。ホームフォルダーやソースのチェックアウトをインストール先に指定しないでください。更新時にインストール先のファイルが置き換えられます。

macOS/Linux では `curl`、`tar`、SHA-256 ユーティリティも必要です。Bun の導入には `unzip`、更新には `rsync` が必要です。現在、実際のクライアントを使った検証は Windows が中心です。日付付きの [サポートマトリクス](SUPPORT_MATRIX.json) を参照してください。

</details>

**代替 — npm (Windows、macOS、Linux):**

Node.js 20+ と [Bun](https://bun.sh/docs/installation) を事前にインストールし、ターミナルから使用できる必要があります (`bun --version`。Bun 1.4.2 で検証)。

```sh
npm install -g zcode-agent-kit@latest
zcode-kit setup --harness auto --installer
```

npm は `zcode-kit` と `zcode-agent-kit` のコマンドをインストールします。2 行目のコマンドは kit の依存関係をインストールし、検出したアシスタントを設定して、Account Rotator の y/n 質問を表示します。npm パッケージをインストールした後に実行してください。コマンド、設定、プロキシが同じ kit に属するよう、インストール方法を統一してください。

## ステップ 3 — 好きなアシスタントで GLM-5.3(-flash) を使う

新しいターミナルを開き、`zcode-kit help` を実行します。その後、kit フォルダーではなく **自分のプロジェクト内** でターミナルを開きます。インストールしたアシスタントを選んでください。

**OMP:**

```sh
omp -p --model zcode/glm-5.3-flash "Reply with ok"
```

**Claude Code:**

```sh
zcode-kit run claude-code -- -p "Reply with ok" --model glm-5.3-flash
```

**Codex:**

```sh
zcode-kit run codex -- exec "Reply with ok" -m glm-5.3-flash
```

これらのコマンドは必要に応じてプロキシを起動・確認します。`ok` という返答があれば、最初のモデル呼び出しは成功です。セットアップの成功メッセージだけでは確認できません。

**返答がありましたか？** そのリクエストについて、アカウント、プロキシ、選んだアシスタントが連携して動きました。自分のプロジェクトで使い始められます。

**返答がありませんか？** 下の「ヘルプ」の確認項目を使ってください。利用枠が尽きている場合、再インストールしても解決しません。

## ステップ 4 — 自分のプロジェクトで使う

OMP の対話セッション:

```sh
omp --model zcode/glm-5.3-flash
```

Claude Code の対話セッション:

```sh
zcode-kit run claude-code -- --model glm-5.3-flash
```

テキストには `glm-5.3`、テキストと画像には `glm-5.3-flash` を選びます。画像への対応はアシスタント側にも依存します。オプションの MCP ブリッジはインストール済みの ZCode ランタイムのツールを提供します。ブリッジを登録するだけではモデルは接続されません。

Flash は常に thinking を使用します。thinking を無効にしたリクエストは `low` に正規化され、明示的に選んだ `high` と `max` は維持されます。OMP では `--thinking low`、`--thinking high`、`--thinking max` でレベルを選びます。直接のプロキシ経由と Claude Code で Flash の応答完了を確認済みですが、すべてのアシスタントが検証に合格したことを意味するものではありません。

<details>
<summary>その他のアシスタントと統合の制限</summary>

| アシスタント | セットアップ後の操作 |
| --- | --- |
| OpenCode | `zcode-kit run opencode -- .` を実行し、ZCode モデルを選びます。 |
| Aider | `zcode-kit run aider -- --model openai/glm-5.3-flash` を実行します。 |
| pi | プロキシを手動で起動してから `pi --model zcode/glm-5.3` を実行します。 |
| Goose | プロキシを手動で起動してから `goose session --provider zcode` を実行します。 |
| Continue | 先に Continue を開いて設定します。`zcode-kit integrate continue` を実行し、プロキシを起動して UI でモデルを選びます。 |
| Cline / Kilo Code | 生成された値を拡張機能の UI に入力してプロキシを起動します。リリース版では `generated/cline-zcode-values.md` または `generated/kilo-zcode-values.md` が生成されます。 |

OMP は直接実行します。`zcode-kit run` は使用しません。kit のランチャーがあるのは Claude Code、Codex、Aider、OpenCode のみです。Codex は分離したプロファイルを使うため、通常の設定やスキルは自動では引き継がれません。Claude Code のルーティングはコミュニティによる互換機能です。アダプターがあっても、すべてのクライアントやバージョンを実環境で検証したことにはなりません。

[アシスタント別のドキュメント](harnesses/README.ja.md) と [サポートマトリクス](SUPPORT_MATRIX.json) を参照してください。

</details>

<details>
<summary>プロキシを手動で起動・停止・再起動</summary>

次のコマンドはすべてのプラットフォームで、リリース版と npm のどちらのインストールでも同じように使えます。

```sh
zcode-kit proxy start
zcode-kit proxy status
zcode-kit proxy logs 50
zcode-kit proxy restart
zcode-kit proxy stop
```

`stop`、`restart`、および自動再起動は、接続中のクライアントと処理中のリクエストを中断します。その後リクエストを再試行してください。`zcode-kit proxy` のないリリースでは、同じコマンドを付けて `node <インストール先>/proxy/zcode-proxy-manager.mjs` を実行します。

**応答しないプロキシ:** `start`、`restart`、`stop` が応答しないプロキシを終了するのは、それがこの kit 自身のものと証明できた場合だけです。条件は、60 秒の起動猶予期間を過ぎていること、起動時刻が記録と一致すること、コマンドラインが kit のプロキシであること、ヘルスチェックが 3 回連続（約 25 秒）で失敗することです。所有者が不明なプロセスは決して終了せず、コマンドはその旨を報告して中止します。`zcode-kit doctor --fix` は管理対象の設定を再適用し、プロキシが停止しているか応答しないことが証明された場合は同じ方法で起動します。

**自動再起動:** プロキシのメインスレッドが応答しなくなった場合やメモリ使用量が高いままの場合、プロキシは kit のマネージャーに新しい起動を依頼します。受け付けるのは 15 分間に最大 3 回までです。それを超えた場合や再起動履歴が読めない場合は依頼が拒否され、`zcode-kit proxy logs 50` を確認して起動するまでプロキシは停止したままになります。残った起動ロックは意図的に引き継ぎません。起動処理が実行中でなければ、メッセージに示されたロックファイルを削除して再試行してください。

</details>

## ヘルプ

```sh
zcode-kit doctor
zcode-kit auth status
```

- **コマンドが見つからない:** ターミナルを開き直してください。リリース版のインストールでは、`%LOCALAPPDATA%\Microsoft\WindowsApps` (Windows) または `$HOME/.local/bin` (macOS/Linux) が PATH にあるか確認します。
- **モデルから返答がない:** Desktop のログインと残りの利用枠を確認します。アシスタントがプロキシを起動しない場合は、手動で起動します。ローカルのヘルスチェックだけではモデルへのアクセスは確認できません。
- **プロキシが停止している、または応答しない:** `zcode-kit doctor --fix` または `zcode-kit proxy restart` を実行します。終了されるのは、kit 自身のものと証明された応答のないプロキシだけです。上の手動操作のセクションを参照してください。
- **OMP の自動起動:** OMP を直接起動します。セットアップでネイティブの Node/Bun を固定し、拡張機能は kit モジュールを OMP にインポートせず、新しい子プロセスで事前確認を行います。失敗時は機密情報を含まないカテゴリを表示し、子プロセスの実行時間は最大 120 秒です。原因を修正し、セッションごとの 60 秒の待機時間後に再試行してください。同じセッション内で復旧できます。ランタイムを移動した場合は `zcode-kit setup --harness auto` を再実行し、拡張機能を再読み込みします。ポートを使用している不明なプロセスには干渉しません。
- **Desktop のログインをインポート:** `zcode-kit auth login zai --import` で Desktop 0.16.9 の現在アクティブな `zai`/`start-plan` ログインを取り込みます。プランの明示的な設定が必要です。`credentials.json` が存在する場合はそれが正となり、認証情報が無効でも旧 `config.json` へ暗黙にはフォールバックしません。新形式の `coding-plan` ログインでは、代わりに `zcode-kit auth login zai` で通常の OAuth を使います。インポーターは API キーの作成や取得を行いません。
- **401 またはポートが使用中:** 別の kit がインストールされていないか確認します。キーを削除したり、不明なプロセスを終了したりしないでください。
- **セットアップが途中で失敗した:** 再実行する前に表示されたロールバックコマンドを確認します。以前の変更が残っている場合があります。

## 実際のプロジェクトデータを使う前に

プロキシは localhost のみで動かし、`.proxykey`、認証情報、生成された設定ファイルを共有しないでください。

**[セキュリティポリシー (英語)](SECURITY.md) を読んでください（[ドイツ語版](SECURITY.de.md) もあります）:** 管理されたプロキシは、OS のサンドボックスなしでベンダーの CAPTCHA JavaScript を実行する場合があります。接続はループバックに限定され、Bearer キーで認証されますが、プロセスの分離とは異なります。CAPTCHA のワーカースレッドはプロキシの応答性を保つためのもので、サンドボックスでも新しい権限境界でもありません。アカウントの制限を回避するものではなく、すべてのチャレンジの成功も保証しません。

<details>
<summary>kit の更新または削除</summary>

**更新:**

- リリース版のインストール: 同じ専用のインストール先で同じリリース版インストーラーを再実行します。最新版を使う場合、古い `ZCODE_KIT_VERSION` の固定指定は削除してください。
- npm インストール: `npm install -g zcode-agent-kit@latest` を実行してから、その npm インストールの `zcode-kit setup --harness auto --installer` を実行します。

更新時も同じインストール方法を使用してください。

**統合の削除:** プロキシを止め（`zcode-kit proxy stop`、上記参照）、`zcode-kit uninstall` を実行します。インストール先、依存関係、ログ、プロキシキー、共有の認証情報は残ります。Desktop からログアウトするわけではありません。残ったファイルを削除する前に確認してください。

npm インストールの場合は、その後 `npm uninstall -g zcode-agent-kit` でグローバルパッケージを削除します。

</details>

## 詳細情報

[アシスタントのガイド](harnesses/README.ja.md) · [サポートマトリクス](SUPPORT_MATRIX.json) · [セキュリティポリシー（英語）](SECURITY.md) · [問題を報告](https://github.com/ZepiGit/ZCode-Agent-Kit/issues) · [コンポーネントマニフェスト（英語）](MANIFEST.md)
