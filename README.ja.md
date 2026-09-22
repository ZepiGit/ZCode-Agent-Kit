# ZCode Agent Kit

普段使っているコーディングアシスタントで、自分の ZCode アカウントを利用できます。

![ZCode Desktop とコーディングアシスタントを Agent Kit で接続](zcode_agent_kit.png)

*kit はローカルで動作し、モデルへのリクエストは ZCode に送られます。*

コーディングアシスタントはそのままに、ローカル接続を通じて既存の ZCode モデルと利用枠を使えます。

**オプションのアカウントローテーション:** インストーラーは **"Do you want to activate the Account Rotator feature? [y/n]"** と尋ねます。`y` を選ぶと現在のログインが取り込まれ、その後の `zcode-kit auth login zai` による別アカウントのログインは追加のアカウントとして保存されます。同じアカウントで再ログインすると、その登録情報が更新されます。後から有効にするには `zcode-kit accounts enable`、保存済みアカウントの確認には `zcode-kit accounts` を使います。詳しくは [Account Rotator のドキュメント (ドイツ語)](docs/ACCOUNT_ROTATOR.md) を参照してください。

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
omp --model zcode/glm-5.3
```

Claude Code の対話セッション:

```sh
zcode-kit run claude-code -- --model glm-5.3
```

テキストには `glm-5.3`、テキストと画像には `glm-5.3-flash` を選びます。画像への対応はアシスタント側にも依存します。オプションの MCP ブリッジはインストール済みの ZCode ランタイムのツールを提供します。ブリッジを登録するだけではモデルは接続されません。

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
<summary>プロキシを手動で起動または停止</summary>

次の場所は **リリース版インストーラーの既定のインストール先** にのみ適用されます。

**PowerShell:**

```powershell
node (Join-Path $env:LOCALAPPDATA 'zcode-agent-kit/proxy/zcode-proxy-manager.mjs') start
```

**macOS/Linux:**

```sh
node "$HOME/.local/share/zcode-agent-kit/proxy/zcode-proxy-manager.mjs" start
```

必要に応じて `start` を `status`、`logs 50`、`stop` に置き換えます。停止すると接続中のクライアントが中断されます。カスタムの場所にインストールした場合は、その絶対パスを指定してください。これらの既定パスは npm インストールには使えません。

</details>

## ヘルプ

```sh
zcode-kit doctor
zcode-kit auth status
```

- **コマンドが見つからない:** ターミナルを開き直してください。リリース版のインストールでは、`%LOCALAPPDATA%\Microsoft\WindowsApps` (Windows) または `$HOME/.local/bin` (macOS/Linux) が PATH にあるか確認します。
- **モデルから返答がない:** Desktop のログインと残りの利用枠を確認します。アシスタントがプロキシを起動しない場合は、手動で起動します。ローカルのヘルスチェックだけではモデルへのアクセスは確認できません。
- **401 またはポートが使用中:** 別の kit がインストールされていないか確認します。キーを削除したり、不明なプロセスを終了したりしないでください。
- **セットアップが途中で失敗した:** 再実行する前に表示されたロールバックコマンドを確認します。以前の変更が残っている場合があります。

## 実際のプロジェクトデータを使う前に

プロキシは localhost のみで動かし、`.proxykey`、認証情報、生成された設定ファイルを共有しないでください。

**[セキュリティポリシー (ドイツ語)](SECURITY.md) を読んでください:** 管理されたプロキシは、OS のサンドボックスなしでベンダーの CAPTCHA JavaScript を実行する場合があります。接続はループバックに限定され、Bearer キーで認証されますが、プロセスの分離とは異なります。アカウントの制限を回避するものではなく、すべてのチャレンジの成功も保証しません。

<details>
<summary>kit の更新または削除</summary>

**更新:**

- リリース版のインストール: 同じ専用のインストール先で同じリリース版インストーラーを再実行します。最新版を使う場合、古い `ZCODE_KIT_VERSION` の固定指定は削除してください。
- npm インストール: `npm install -g zcode-agent-kit@latest` を実行してから、その npm インストールの `zcode-kit setup --harness auto --installer` を実行します。

更新時も同じインストール方法を使用してください。

**統合の削除:** 上記の管理コマンドの `stop` でプロキシを止め、`zcode-kit uninstall` を実行します。インストール先、依存関係、ログ、プロキシキー、共有の認証情報は残ります。Desktop からログアウトするわけではありません。残ったファイルを削除する前に確認してください。

npm インストールの場合は、その後 `npm uninstall -g zcode-agent-kit` でグローバルパッケージを削除します。

</details>

## 詳細情報

[アシスタントのガイド](harnesses/README.ja.md) · [サポートマトリクス](SUPPORT_MATRIX.json) · [セキュリティ](SECURITY.md) · [問題を報告](https://github.com/ZepiGit/ZCode-Agent-Kit/issues) · [ライセンスと同梱コンポーネント](MANIFEST.md)
