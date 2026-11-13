# ZCode Agent Kit へのコントリビューション
[English (original)](CONTRIBUTING.md) · [Deutsch](CONTRIBUTING.de.md) · [Español](CONTRIBUTING.es.md) · **日本語** · [简体中文](CONTRIBUTING.zh-CN.md)

> 本ドキュメントは英語原文の翻訳です。相違がある場合は英語版が正となります。

不具合の報告、修正、ドキュメント、翻訳を歓迎します。このガイドでは、ソースのチェックアウトで kit を開発する方法を説明します。kit をインストールして使うだけなら、[README](README.ja.md) の手順に従ってください。

## 必要なもの

- Node.js 24 以降。CI は Node.js 24 と 26 でテストします。
- Bun 1.4.2。プロキシと MCP ブリッジのテストは Bun で実行され、CI はこのバージョンに固定しています。CI ランナーでは、Bun 1.4.3 以降を使うと、大きなリクエストが集中したときのプロキシのメモリのピークが上がります。1.2.20 のような古い Bun は、MCP ブリッジのロックファイルを受け付けません。
- Git。

## クローンとインストール

```sh
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git
cd ZCode-Agent-Kit
```

プルリクエストを送るには、GitHub でリポジトリをフォークし、自分のフォークにブランチをプッシュしてください。

kit 自体には npm の依存関係がありません。プロキシと MCP ブリッジにはそれぞれ依存関係があり、各ディレクトリの `bun.lock` で固定されています。CI と同じ方法でインストールします。

```sh
cd zcode-proxy-src && bun install --frozen-lockfile
cd ../mcp/zcode-harness-mcp && bun install --frozen-lockfile
cd ../..
```

チェックアウトでは、`node cli/zcode-kit.mjs <command>` で CLI を実行します（例：`node cli/zcode-kit.mjs doctor`）。アシスタントの設定に書き込むコマンド（`setup`、`integrate`、`doctor --fix`、`accounts enable`、`accounts disable`）は、チェックアウトからは実行できません。インストール済みのコピーとチェックアウトは 1 つのホームフォルダーを共有するため、両方から書き込むと kit の状態が 2 か所に分かれてしまいます。`integrate <harness> --dry-run` は、何も書き込まずに変更内容を一覧表示します。チェックアウトから書き込むことが本当に必要な場合に限り、`ZCODE_KIT_ALLOW_CHECKOUT=1` を設定してください。

## テストの実行

次のコマンドは、リポジトリのルートで実行します。

| コマンド | 実行内容 |
|---|---|
| `npm run test` | `node --test` による kit のテスト |
| `npm run test:proxy` | `zcode-proxy-src/` での `bun test` によるプロキシのテスト |
| `npm run test:mcp` | MCP ブリッジをビルドし、そのテストを実行 |
| `npm run test:all` | 上の 3 つすべてと、プロキシの型チェック（`npm run test:proxy-typecheck`） |

`ci` ワークフローは、すべてのプルリクエストに対して、Ubuntu と Windows 上の Node.js 24 と 26 でこれらのテストを実行します。さらに、時間のかかるチェックを 2 つ実行します。

- 出力の比較（`npm run test:ux-before`）。キャプチャした `zcode-kit` の出力はすべて、`tests/ux-before/` のベースラインとバイト単位で一致する必要があります。そのため、コマンドの出力を変える場合は、更新したベースラインファイルを同じプルリクエストに含めてください。ジョブが失敗すると、新しいキャプチャがアーティファクトとしてアップロードされるので、差分を確認できます。Linux では比較に約 8 分かかり、util-linux の `script` が必要です。macOS ではスキップされます。
- メモリ予算（`tests/memory/`）。`tests/memory/expected-red.json` に載っている実行は失敗し、それ以外の実行はすべて成功する必要があります。そのため、載っている実行を直す変更では、そのファイルからも該当する実行を削除してください。

## 変更の提案

- 新しいアシスタントの統合や、プロキシのリクエスト処理の変更など、大きめの変更をする場合は、コードを書く前に Issue を作成するか [Discussion](https://github.com/ZepiGit/ZCode-Agent-Kit/discussions) を始めて、進め方について合意してください。
- プルリクエストは小さく保ち、1 つの変更に絞ってください。
- 動作を変える場合は、それをカバーするテストを追加または更新してください。
- コミットメッセージは Conventional Commits の形式（`type(scope): summary`）で書いてください。履歴のコミットの多くは、`feat`、`fix`、`docs`、`test`、`ci`、`chore` のタイプを使っています。スコープは省略でき、`proxy`、`cli`、`mcp`、`omp` のように変更した部分を示します。履歴にある例：`fix(mcp): bridges sharing one data directory leave each other's tasks alone`。
- 新しいファイルが npm パッケージに入るのは、`pack/build.mjs` の許可リストにそのファイル名がある場合だけです。

## ドキュメントと翻訳

README は、英語、ドイツ語、スペイン語、日本語、簡体字中国語で用意されています。原文は英語版で、翻訳はそれに合わせて更新します。翻訳ファイルは、英語のファイルと同じ場所に言語の接尾辞を付けて置かれています（`README.de.md`、`README.es.md`、`README.ja.md`、`README.zh-CN.md`）。ほかのドキュメントは翻訳の数が少ないため、変更するファイルの隣にどの言語のファイルがあるかを確認してください。

ユーザー向けの英語ドキュメントを変更したときは、できれば同じプルリクエストで翻訳ファイルも更新してください。できない場合は、後で更新できるように、内容が古くなったファイルをプルリクエストの説明に列挙してください。

`CHANGELOG.md` は常に英語で書きます。

## 初めてのコントリビューション

[`good first issue`](https://github.com/ZepiGit/ZCode-Agent-Kit/labels/good%20first%20issue) ラベルの付いた Issue は、最初に取り組む課題として用意されています。2 人が同じ作業をしてしまわないように、作業を始める前にその Issue にコメントを残してください。

## 質問とセキュリティの報告

質問は [GitHub Discussions](https://github.com/ZepiGit/ZCode-Agent-Kit/discussions) でどうぞ。セキュリティの問題は、公開の Issue ではなく、[SECURITY.md](SECURITY.ja.md#脆弱性の報告) に書かれた方法で報告してください。
