# zcode-harness-mcp（日本語）

[English](README.md) | [中文](README.zh-CN.md) | [Español](README.es.md) | **日本語** | [Deutsch](README.de.md)

> 本ドキュメントは英語原文の翻訳です。相違がある場合は英語版が正となります。

他のモデルやエージェントが**実インストールの ZCode ハーネス**を制御できる
MCP サーバー（stdio **および** Streamable-HTTP）：能力の発見、モデル選択、
設定の読み書き、ワークスペースとセッションの管理、タスク起動、追加質問への
回答、進捗の監視、ファイル変更やアーティファクトを含む完全な結果の取得。

ブリッジは**制御レイヤー**であり、チャットクライアントでもプロンプト
ラッパーでもありません：すべての作業は、元の ZCode ランタイム（`zcode.cjs
app-server --stdio`、ローカルインストール）が自身のツール・コンテキスト
管理・権限で実行します。

- プロトコル：外側は MCP（公式 SDK）、内側は **ZCode Protocol v1**
  （stdio 上の NDJSON、0.16.5 に対してライブ検証済み）——
  [`docs/PROTOCOL.md`](docs/PROTOCOL.md) 参照。
- 規模：32 の MCP ツール + MCP リソース。45 エントリのケイパビリティ
  レジストリ（[`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md)）。
- `npm test` は決定論的なローカルフィクスチャを使います。ライブテストは明示 opt-in が必要で、過去の報告は現在の検証証拠ではありません。
- 監査修正：セッション ID もワークスペース制限対象、`yolo` は `--allow-yolo` が必要です。ツール許可は完全一致で Bash/PowerShell/Shell は拒否します。ファイルサイズに上限があり、JSONL は各最大4 MiBの2ファイルを保持。EOF はタスクを中断して子プロセスを終了しますが Windows のプロセスツリー隔離は保証しません。`--runtime-path` はコード実行なので信頼できるファイルのみ指定してください。

## 前提条件

- Windows 10/11（動作確認済み）または PATH 上に `node` がある OS
- Node.js ≥ 20（`node --version`）。スクリプトは固定のプログラム名 `node`
  でハーネスを起動します
- ZCode（Desktop）インストール済み。ブリッジは `zcode.cjs` を自動検出：
  - `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`
  - `%ProgramFiles%\ZCode\resources\glm\zcode.cjs`
  - または明示的に：`--runtime-path` ないし `ZCODE_HARNESS_RUNTIME_PATH`
- ZCode ログイン済み（ハーネスはローカルの Z.AI OAuth ログインを使用。
  ブリッジは**資格情報を管理せず**、すべての出力でシークレットを伏字に）

## インストール（Windows / PowerShell）

ZCode Agent Kit のチェックアウト内では、ブリッジは既に
`mcp/zcode-harness-mcp/` にあります — クローンは不要、そこへ直接 cd して
ください。

```powershell
cd $HOME
git clone <このリポジトリ> zcode-harness-mcp   # またはフォルダをコピー
cd zcode-harness-mcp
npm install
npm run build
# ランタイム検出のセルフテスト：
npm run probe:runtime
```

## クイックスタート

### 1) MCP クライアントに MCP サーバーとして登録（stdio）

設定例（例：`claude_desktop_config.json` や `.mcp.json`）：

```json
{
  "mcpServers": {
    "zcode-harness": {
      "command": "node",
      "args": [
        "C:\\Users\\<you>\\zcode-harness-mcp\\dist\\index.js",
        "--stdio",
        "--allow-workspace", "C:\\Users\\<you>\\Projects",
        "--interaction-policy", "ask"
      ]
    }
  }
}
```

### 2) Streamable-HTTP モード（複数クライアント、明示的に有効化）

```powershell
node dist\index.js --http --http-key "<random-local-secret>" --host 127.0.0.1 --port 3322 --allow-workspace "C:\Users\<you>\Projects"
# MCP エンドポイント： http://127.0.0.1:3322/mcp（localhost のみ。公開しない）
```

### 3) 他のエージェント視点のデモ

```powershell
# 実インストールに対して：
node examples\demo-client.mjs --workspace "C:\Users\<you>\demo-workspace"
# フィクスチャハーネスに対してオフラインで：
node examples\demo-client.mjs --fixture
```

デモクライアントは完全なフローを示します：能力の発見 → ワークスペース
オープン → 実モデルカタログの読み取り → GLM-5.3-Flash チェック（黙って
モデルを切り替えない）→ 設定変更 → タスク起動 → 進捗ポーリング →
追加質問への回答 → 結果 + アーティファクトの読み取り → 同じセッションで
追加発注。

### 4) テスト

```powershell
npm test          # ビルド + ユニット + 統合（フィクスチャハーネス、決定論的）
npm run test:live # 明示 opt-in のみ（実インストール・Quota）： $env:LIVE_TEST="1"; $env:LIVE_WORKSPACE="C:\..."; $env:LIVE_DATA_DIR="C:\..."
```

## 主なコマンドラインフラグ

| フラグ | 意味 |
| --- | --- |
| `--stdio` | stdin/stdout 経由の MCP（デフォルト） |
| `--http --http-key KEY --port N --host H` | Bearer キー付き Streamable-HTTP（デフォルト 127.0.0.1:3322） |
| `--read-only` | 変更を伴うツールを拒否（注記ではなく技術的に強制） |
| `--allow-workspace P` | ワークスペースルートを許可（複数可。`;` 区切りリストは `ZCODE_HARNESS_ALLOW_WORKSPACES`） |
| `--runtime-path P` | `zcode.cjs` への明示パス |
| `--data-dir D` | 永続化ディレクトリ（デフォルト `~/.zcode-harness-mcp`） |
| `--interaction-policy deny\|allowlist\|ask` | 権限リクエストへの応答方法（デフォルト： `deny`） |
| `--interaction-allowlist "Read,Glob"` | `allowlist` の完全一致ツール名（シェルは拒否） |
| `--max-concurrent-tasks N` | 並行度（デフォルト 2。超過分はキューに入る） |

## セキュリティモデル（要約）

- タスク**と**アーティファクト読み取りアクセスに対する、実際のパス解決
  （symlinks/junctions）を伴うワークスペース許可リスト
- 読み取り専用モード：変更を伴うツールはエラーを返す。タスクの
  `readOnly` はさらにハーネス側でプランモード + 書き込みツール拒否
  リストを強制
- すべてのツール出力・ログ・イベントでのシークレットの伏字化。資格情報は
  決して公開・管理されない
- プロセス起動は引数配列のみ（`shell: false`）、固定プログラム（`node`）、
  シェル文字列なし
- 追加質問（権限/ユーザー入力）は決して自動展開されない：ポリシー
  `deny`（デフォルト）、`allowlist`、またはタイムアウト付き `ask` →
  安全なデフォルト回答（deny）
- ブリッジ自身の ZCode ランタイムへの自己登録なし、公開ネットワーク
  公開なし、プラグインの自動インストールなし

詳細：[`docs/SECURITY.md`](docs/SECURITY.md) · 正直な限界： [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md)

## 状態

現在の実装および検証状況：[`KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md) · テスト証跡：[CI](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml) · API リファレンス： [`docs/MCP_API.md`](docs/MCP_API.md)

## ライセンス

MIT。リファレンスリポジトリ [zcode-acp](https://github.com/william0wang/zcode-acp)（Apache-2.0）と [zcode-open-bridge](https://github.com/tizerluo/zcode-open-bridge)（MIT）をプロトコルソースとして調査しました（コミットは `docs/PROTOCOL.md` に文書化）；取り入れたコード：なし。
