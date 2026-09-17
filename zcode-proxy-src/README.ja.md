# ZCode Proxy（日本語）

[English](README.md) | [中文](README.zh-CN.md) | [Español](README.es.md) | **日本語** | [Deutsch](README.de.md)

> 本ドキュメントは英語原文の翻訳です。相違がある場合は英語版が正となります。

このディレクトリは [TriDefender/zcode-api](https://github.com/TriDefender/zcode-api) の
**zcode-proxy** を vendored として含みます — v4.6.4、コミット
`9a5cebe07c5255faa675075fa37632d4dea733fa`（2026-09-11）に固定、MIT ライセンス
（upstream は LICENSE ファイルを同梱しません）。バージョン・コミット・ローカル
変更は [`../MANIFEST.md`](../MANIFEST.md) に、ローカルパッチは
[`../patches/`](../patches/) にあります。

本 README は、このコンポーネントが **ZCode Agent Kit 内でどのように使われるか**
を説明します。upstream のオリジナル README（中国語）は
[README.zh-CN.md](README.zh-CN.md) として保存されており、スタンドアロン版の
upstream プロジェクト（Android アプリ、Docker デプロイ、オフピークチャネル、
トライアル請求）について記載しています —— kit はそれらを使いません。

## kit 内での役割

プロキシは kit のモデルゲートウェイです。**`http://127.0.0.1:8457`** で OpenAI
chat-completions・Anthropic messages・OpenAI Responses の各リクエストを受け付け、
ログイン済みの ZCode Desktop アカウント（start-plan、ZCode Desktop と同じ
クォータ）で Z.AI ゲートウェイへ転送します。

- アドレス/形式： `POST /v1/chat/completions`、`POST /v1/messages`、
  `POST /v1/responses`、`GET /v1/models`、`GET /health`、`GET /quota`
- 認証： `Authorization: Bearer <.proxykey の内容>` — 鍵は setup.mjs がローカルで
  生成し、マシンの外へ出ることはありません
- ライフサイクル： `node proxy\zcode-proxy-manager.mjs start|stop|restart|status|doctor|logs`
  が管理（ループバックのみのバインド、fail-closed 停止、ログローテーション —
  ルート README 参照）
- ログイン更新： [README.ja.md](../README.ja.md) →「ログインの更新」を参照

## upstream からのローカル差分

- upstream スタンドアロンのデフォルト 8080 ではなくポート **8457**
  （kit の設定テンプレート）。ループバックのみ、ベアラーキー必須
- **トライアル請求とオフピークチャネルは無効**： kit 同梱の設定は upstream の
  `claim`（限定トライアルの自動取得）や `/async/*`（オフピーク）を使いません。
  基盤のデフォルトは監査対応後 fail-closed（`false`）です
- **vendoring からの除外**: `Android-APP/`（209 MB）と `node_modules/` は含まれ
  ません。`node_modules/` は setup.mjs が `bun install --frozen-lockfile` で
  導入します。Android ビルド経路（`scripts/build-android-apk.sh`、
  `build:android-*` npm スクリプト、esbuild devDependency、vendored 版
  `.github/workflows/release.yml` の `build-android` ジョブ）も合わせて削除済みです
- upstream のテストファイル 2 件をローカルで追加。ソース変更はすべて
  [`../patches/zcode-proxy-local-patches.patch`](../patches/zcode-proxy-local-patches.patch)
  にあります

## 利用可能なモデル

プロキシは `/v1/models` に以下のモデルを掲載します（一覧は表示のみ —
他のモデル名も通常どおり転送されます）。kit 内で検証済みなのは **glm-5.3**
（テキスト、1M コンテキスト）と **glm-5.3-flash**（テキスト+画像、1M
コンテキスト）です。ルート README を参照してください。

| モデル | コンテキスト | 最大出力 |
|---|---|---|
| `glm-4.5-air` | 131K | 96K |
| `glm-4.6` | 200K | 131K |
| `glm-4.6v`（ビジョン） | 131K | 32K |
| `glm-4.7` | 200K | 131K |
| `glm-5` / `glm-5-turbo` | 200K | 64K |
| `glm-5v-turbo`（ビジョン） | 200K | 131K |
| `glm-5.1` | 200K | 64K |
| `glm-5.2` | 1M | 128K |
| `glm-5.3` / `glm-5.3-flash` | 1M | 128K |

## 設定と環境変数

プロキシは `config.yaml` を読みます（kit は `ZCODE_PROXY_CONFIG` で
`../proxy/config.yaml` を指します）。環境変数が優先されます。よく使うもの：

| 環境変数 | デフォルト | 意味 |
|---|---|---|
| `ZCODE_PROXY_PORT` | `8080` | 待受ポート（kit テンプレートは 8457） |
| `ZCODE_PROXY_API_KEY` | なし | クライアントが提示すべきキー（kit では `.proxykey` の内容） |
| `ZCODE_PROVIDER` | `zai` | プロバイダー `zai` / `bigmodel` |
| `ZCODE_PROXY_CONFIG` | `config.yaml` | 設定ファイルのパス |
| `ZCODE_PROXY_CREDENTIAL_SECRET` | マシン固有 | ログイン資格情報の暗号化シード（移行/Docker 時は固定する） |
| `ZCODE_LOG_FORMAT` | デスクトップ表 | `compact` で 1 行ログ（狭いターミナル向け） |

## ソースから直接起動 / TUI

このディレクトリからプロキシを直接起動すると、対話型ターミナルパネル
（upstream のメイン UI）が開きます：

```powershell
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts
```

<img src="docs/images/tui-annotated.png" alt="ZCode Proxy ターミナルパネル" width="980" />

パネルは 3 領域：**ログインと設定**（プロバイダー / プラン / ログイン）、
**プロキシサービス**（起動/停止、現在の設定）、**ログ**（リクエストごとに
1 行、ライブ）。<kbd>s</kbd> でプロキシ起動。`Status: running` で準備完了。
ボタンはマウスクリック可能。`bun run zcode-proxy --cli serve` でヘッドレス
実行。ショートカット： <kbd>s</kbd> 起動/停止 · <kbd>l</kbd> ログイン ·
<kbd>L</kbd> リンク貼り付けログイン · <kbd>o</kbd> ログアウト ·
<kbd>p</kbd>/<kbd>t</kbd> プロバイダー/プラン切替 ·
<kbd>↑</kbd><kbd>↓</kbd>/<kbd>PgUp</kbd>/<kbd>g</kbd> ログスクロール ·
<kbd>c</kbd> クリア · <kbd>q</kbd> 終了。

kit のユーザーは通常これを必要としません — `proxy/zcode-proxy-manager.mjs` が
ログローテーション付きでヘッドレスにプロキシを稼働させ続けます。

## kit で使わない機能

以下の upstream 機能はコード内に存在しますが、kit 同梱の設定には含まれません：
Android アプリ（vendoring から除外）、Docker デプロイ、`/async/*`
オフピークチャネル、トライアル自動請求（無効、fail-closed）。スタンドアロンで
の利用は upstream リポジトリを参照してください。

## ライセンス

MIT（upstream README による。upstream は LICENSE ファイルを同梱しない —
[`../MANIFEST.md`](../MANIFEST.md) 参照）。
