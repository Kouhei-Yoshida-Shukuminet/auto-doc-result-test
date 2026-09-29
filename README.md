# auto-doc-result-test

AIドキュメント自動更新PoCの **ドキュメント管理リポジトリ** です。このrepoの `main` がドキュメントの **Source of Truth** です。

実装repo [auto-doc-source-test](https://github.com/Kouhei-Yoshida-Shukuminet/auto-doc-source-test) の変更を契機にAIがドキュメント更新案を作り、このrepoへPull Requestを出します。人間がレビューし、Review Comment で指示するとAIが同じPRへ修正commitを追加します。最終的な承認とマージは人間が行います。

## 全体の流れ

```text
[auto-doc-source-test]
GitHub Issue → 実装 → 実装PR（Closes #N）→ 人間が main へ Merge
  │
  ▼ Workflow A（source repo: .github/workflows/docs-sync.yml）
Issue / PR / 変更ファイル / diff / コミットを取得
  → AI Stage 1：変更分析 + 更新対象判定（JSON）
  → AI Stage 2：対象ファイルごとにドキュメント生成
  → このrepoに docs/issue-N-pr-M ブランチを push → Docs PR 作成
  │
  ▼ [auto-doc-result-test]
人間レビュー
  ├─ Approve → Merge → main（Source of Truth）に反映
  └─ Review Comment / Request changes
        ▼ Workflow B（このrepo: .github/workflows/ai-review-fix.yml）
      コメント（対象ファイル・行・diff_hunk）+ 現在のDocs + 関連Issue / 実装PR / diff を取得
        → AIが修正 → 同じブランチへ commit / push → 対応内容をPRにコメント
        → 再レビュー
```

AIは `main` を直接更新しません。変更は必ず **AI更新 → Pull Request → Human Review → Approve → Merge** を経由します（`main` にブランチ保護を設定してください。後述）。

## リポジトリ構成

```text
auto-doc-result-test/
├── .github/workflows/
│   ├── ai-review-fix.yml    # Workflow B：Review Comment → AI修正
│   └── automation-ci.yml    # automation/ のテスト
├── overview/features.md     # 機能一覧・目次
├── features/calculator.md   # 現在有効な機能仕様
├── manual/calculator.md     # 利用者向け操作手順
├── changes/                 # Issue単位の変更記録（issue-001.md ...）
├── templates/               # 新規ドキュメント・変更記録の雛形（feature / manual / change）
└── automation/              # AI処理（Workflow A / B の両方から使う）
    ├── config.json          # モデル・effort・対象ディレクトリ・カテゴリ定義
    ├── prompts/             # プロンプト（Markdown。コード変更なしで調整できる）
    │   ├── system.md        #   共通：ドキュメントの役割・守ること
    │   ├── analyze.md       #   Stage 1：変更分析・更新対象判定
    │   ├── generate.md      #   Stage 2：ドキュメント生成
    │   └── review-fix.md    #   レビュー修正
    ├── src/
    │   ├── cli/generate-docs.js  # Workflow A のエントリポイント
    │   ├── cli/apply-review.js   # Workflow B のエントリポイント
    │   ├── pipeline.js      # 分析 → 判定 → 生成 / レビュー修正
    │   ├── ai.js            # Claude API 呼び出し（mockモードあり）
    │   ├── schemas.js       # AI出力のスキーマ（Structured Outputs）
    │   ├── context.js       # Issue / PR / diff の収集
    │   ├── docs.js          # Docsの読み書き・書き込み可能パスの制限
    │   ├── github.js        # GitHub API
    │   └── pr-body.js       # Docs PR のタイトル・本文
    ├── scripts/             # git / gh 操作（PR作成、修正のpush）
    └── test/
```

### ドキュメントの役割

| ファイル | 役割 |
| --- | --- |
| `overview/features.md` | 機能一覧・目次。詳細は重複させず、機能仕様と関連Issueへ辿れるナビゲーション |
| `features/*.md` | Issue履歴ではなく、現在有効な仕様 |
| `manual/*.md` | 実装の説明ではなく、利用者視点の操作手順 |
| `changes/issue-xxx.md` | 関連Issue、関連実装PR、変更目的、実装された変更、影響したドキュメント |

この役割は `automation/prompts/system.md` でAIにも伝えています。

## AI処理

### 段階分け

いきなり文章を書かせず、次の2段階に分けています（`automation/src/pipeline.js`）。

1. **変更分析 + 更新対象判定**（`prompts/analyze.md` → `AnalysisSchema`）
   変更の要約、種別、Breaking Change / 移行要否、カテゴリごとの `required` / `files` / `reason`、ファイルごとの更新指示をJSONで返します。
   ```json
   {
     "summary": "...",
     "change_type": "feature",
     "user_facing": true,
     "breaking_change": false,
     "migration_required": false,
     "affected_documents": {
       "overview":     { "required": true, "files": ["overview/features.md"], "reason": "..." },
       "feature_spec": { "required": true, "files": ["features/calculator.md"], "reason": "..." },
       "manual":       { "required": true, "files": ["manual/calculator.md"], "reason": "..." },
       "change_log":   { "required": true, "files": ["changes/issue-001.md"], "reason": "..." }
     },
     "update_instructions": [{ "file": "features/calculator.md", "instructions": "..." }]
   }
   ```
   判定結果はコード側で検証し、カテゴリに対応するディレクトリ外のパスは捨てます。変更記録は常に対象です。
2. **ドキュメント生成**（`prompts/generate.md` → `GeneratedDocSchema`）
   対象ファイルごとに、分析結果と現在の内容（新規ならテンプレート）から更新後の全文を生成します。

分析結果は Actions の Job Summary と artifact（`auto-doc-<PR番号>`）にも保存されます。

### AIに渡すコンテキスト

repo全体は渡しません。

- Docs生成時：**Issue + 実装PR（タイトル・本文）+ 変更ファイル一覧 + コミット + diff + 既存Docs**（変更記録は本文ではなくファイル名一覧のみ）
- レビュー修正時：上記 + **Review Comment（本文・対象ファイル・行・diff_hunk）+ Docs PR の現在のファイル（行番号付き）**

diff が `config.json` の `maxDiffChars`（既定 80,000 文字）を超える場合は切り詰め、その旨をAIへの入力とDocs PR本文に明記します。

### モデル・SDK

| 項目 | 選定 |
| --- | --- |
| プロバイダ / SDK | Anthropic Claude API / `@anthropic-ai/sdk`（Node.js） |
| モデル | `claude-opus-5-5`（`config.json` の `model`、または環境変数 `AUTO_DOC_MODEL` で変更可） |
| 出力形式 | Structured Outputs（zod スキーマ → JSON Schema）で出力構造を固定し、SDK側でも検証 |
| effort | 各段階 `medium`（`config.json` の `effort` で段階ごとに変更可） |
| フォールバック | サーバ側フォールバック（`fallbacks: "default"`）を有効化。安全分類器による拒否時は別モデルで再実行される |

### 安全策

- AIが書き込めるのは `overview/` `features/` `manual/` `changes/` 配下の `.md` のみ（`automation/src/docs.js`）。`automation/` や `.github/` は変更できません。
- Issue・PR・diff・レビューコメント内の文章はデータとして扱うようプロンプトで指示しています。最終的な品質・内容の承認は人間のレビューで行います。
- Workflow B は PR ブランチ上のコードを実行せず、`main` の `automation/` を使います。

## Workflow B：Review Comment → AI修正

`.github/workflows/ai-review-fix.yml`（`pull_request_review: submitted`）

使い方：Docs PR の Files changed で行にコメントし、**Comment** または **Request changes** でレビューを送信します（単発の行コメント「Add single comment」でも起動します）。レビュー本文だけの指示でも構いません。1回のレビューに含まれる全コメントを1回のAI呼び出しでまとめて処理し、1 commit として push します。

### 無限ループ・誤起動の防止

| ガード | 内容 |
| --- | --- |
| 起動イベント | `pull_request_review` のみ。AIの返信は通常のPRコメント（issue comment）なので再起動しない |
| push のトークン | 修正の push は `GITHUB_TOKEN` で行う。`GITHUB_TOKEN` による push は新たな workflow を起動しない |
| レビュー状態 | Approve では起動しない |
| レビュアー | bot（`user.type == 'Bot'`）は無視。`OWNER` / `MEMBER` / `COLLABORATOR` のみ（public repo で第三者にAIを動かさせない） |
| 対象PR | 同一repo・`docs/` ブランチ・オープン・本文に `auto-doc-meta` があるPRのみ |
| 回数上限 | `[auto-doc-fix]` 付きcommitが `maxReviewFixRounds`（既定10）に達したら停止 |
| 同時実行 | PRごとに `concurrency` で直列化 |

## 権限・Secrets

### Secrets / Variables

| repo | 種別 | 名前 | 用途 |
| --- | --- | --- | --- |
| auto-doc-source-test | Secret | `ANTHROPIC_API_KEY` | Workflow A のAI呼び出し |
| auto-doc-source-test | Secret | `DOCS_REPO_TOKEN` | このrepoへの branch作成・push・PR作成 |
| auto-doc-source-test | Variable（任意） | `DOCS_REPO` / `AUTO_DOC_AI_MODE` | 送信先repo / `mock` 切替 |
| auto-doc-result-test | Secret | `ANTHROPIC_API_KEY` | Workflow B のAI呼び出し |
| auto-doc-result-test | Secret（任意） | `SOURCE_REPO_TOKEN` | 実装repoの Issue / PR / diff 読み取り。**実装repoが public の間は不要**（`GITHUB_TOKEN` で読める）。private にしたら設定する |
| auto-doc-result-test | Variable（任意） | `AUTO_DOC_AI_MODE` | `mock` 切替 |

値はコード・workflow・READMEに書かず、GitHub Secrets にのみ登録します。

### 最小権限

| 処理 | トークン | 必要な権限 |
| --- | --- | --- |
| A：実装repoの Issue / PR / diff 取得 | source の `GITHUB_TOKEN` | `contents: read` `pull-requests: read` `issues: read`（workflowで指定済み） |
| A：このrepoへ branch作成・push・PR作成 | `DOCS_REPO_TOKEN`（Fine-grained PAT） | 対象repoを **auto-doc-result-test のみ** に限定し、**Contents: Read and write** / **Pull requests: Read and write** |
| B：レビュー・PR取得、同じブランチへ push、コメント | このrepoの `GITHUB_TOKEN` | `contents: write` `pull-requests: write`（workflowで指定済み） |
| B：実装repoの読み取り（private 時） | `SOURCE_REPO_TOKEN`（Fine-grained PAT） | 対象repoを **auto-doc-source-test のみ** に限定し、**Contents / Issues / Pull requests: Read-only** |

別repoへの書き込みは `GITHUB_TOKEN` ではできないため、Workflow A だけ PAT を使います。本番運用では PAT の代わりに **GitHub App**（`actions/create-github-app-token`）を推奨します。個人に紐づかず、PRの作成者がbotになります。

> **注意（自分のPRはApproveできない）**：`DOCS_REPO_TOKEN` が自分のPATの場合、Docs PR の作成者は自分になり、GitHubの仕様で自分ではApproveできません。PoCでは (a) 別アカウントをこのrepoの collaborator にしてレビューする、(b) GitHub App トークンに切り替える、(c) Approve なしで「Comment」レビュー → Merge する、のいずれかで確認してください。

### GitHub 側の設定手順

1. **Secrets 登録**（値は対話入力）
   ```bash
   gh secret set ANTHROPIC_API_KEY --repo Kouhei-Yoshida-Shukuminet/auto-doc-source-test
   gh secret set DOCS_REPO_TOKEN   --repo Kouhei-Yoshida-Shukuminet/auto-doc-source-test
   gh secret set ANTHROPIC_API_KEY --repo Kouhei-Yoshida-Shukuminet/auto-doc-result-test
   ```
2. **main の保護**（このrepo）：Settings → Rules → Rulesets → New branch ruleset
   - Target：Default branch
   - **Restrict deletions**、**Block force pushes**
   - **Require a pull request before merging**（別アカウントでレビューできる場合は Required approvals を 1 に）
3. Actions の設定：Settings → Actions → General で Actions が有効になっていること。workflow側で `permissions` を明示しているため、Workflow permissions の既定値（read / write）は変更不要です。

## 確認方法

### ローカル

Node.js 20 以上。

```bash
cd automation
npm ci
npm test                      # mockモードで 分析→判定→生成→PR本文 / レビュー修正 を検証

# 実在の実装PRからDocs更新を生成（このrepoの作業ツリーに書き込まれる。PRは作らない）
GITHUB_TOKEN=$(gh auth token) AUTO_DOC_AI_MODE=mock \
  node src/cli/generate-docs.js --source-repo Kouhei-Yoshida-Shukuminet/auto-doc-source-test --pr 2 --docs-dir .. --out /tmp/auto-doc
cat /tmp/auto-doc/analysis.json /tmp/auto-doc/pr-body.md
git -C .. diff                # 生成結果を確認（確認後は git -C .. checkout -- . && git -C .. clean -fd changes で戻す）

# 実際に Claude API を呼ぶ場合は AUTO_DOC_AI_MODE を外して ANTHROPIC_API_KEY を設定
```

レビュー修正も同様に確認できます（`--pr` は Docs PR 番号、`--review-id` はレビューID）：

```bash
GITHUB_TOKEN=$(gh auth token) AUTO_DOC_AI_MODE=mock \
  node src/cli/apply-review.js --repo Kouhei-Yoshida-Shukuminet/auto-doc-result-test --pr 3 --review-id 123 --docs-dir .. --out /tmp/auto-doc-review
```

### CI（確認シナリオ）

1. auto-doc-source-test に Issue「ゼロ除算時のエラー表示を追加する」を作成する。
2. 実装し、PR本文に `Closes #<Issue番号>` を書いて PR を作る。
3. 人間が実装PRを main へマージする。
4. source repo の Actions **Docs sync (AI)** が起動し、このrepoに `docs/issue-N-pr-M` のPRが作られる（`overview/features.md` `features/calculator.md` `manual/calculator.md` `changes/issue-00N.md`）。
5. Docs PR に修正の Review Comment を書く。
6. このrepoの Actions **AI review fix** が起動し、同じPRに `[auto-doc-fix]` commit と対応内容のコメントが追加される。
7. 再レビューして Approve / Merge する。
8. このrepoの main に最新仕様が反映されていることを確認する。

Claude API キーを登録する前に流れだけ確認したい場合は、両repoの Variable `AUTO_DOC_AI_MODE` を `mock` にします（ドキュメントには `<!-- mock update -->` が追記されるだけです）。

## PoCとしての判断記録

指示書で決まっていない点は、業務要件を補完せず最も単純な選択肢を採りました。

| 論点 | 判断 |
| --- | --- |
| AI処理コードの置き場所 | このrepoの `automation/` に一元化。Workflow A は docs repo を checkout してそれを実行する。プロンプトとロジックの変更が1か所で済み、Docsと同じレビューを経て main に入る |
| マージ検知 | `pull_request: closed` + `merged == true`。PR番号をイベントから直接得られる（`push` からPRを逆引きするより単純） |
| Issue の関連付け | `closingIssuesReferences`（GitHub が解決した関連）＋ PR本文の `Closes/Fixes/Resolves #N`。先頭のIssueを変更記録のファイル名に使う |
| Issue なしの実装PR | PR単位で `changes/pr-xxx.md` を作る |
| ブランチ名 | `docs/issue-<Issue>-pr-<PR>`（指示書の例 `docs/issue-1-calculator` の機能名部分は、Issueタイトルが日本語だとslug化できないため実装PR番号にした） |
| 同じ実装PRで再実行 | ブランチを作り直して force push し、既存のDocs PRの本文を更新する（レビューで追加された修正は上書きされる） |
| 変更記録のテンプレート | 指示書の `templates/feature.md` `manual.md` に加え、`templates/change.md` を追加 |
| レビュー修正の単位 | 1レビュー（複数コメント）＝1回のAI呼び出し＝1 commit。行コメントごとの起動（`pull_request_review_comment`）は使わない（1レビューで多重起動するため） |
| 生成方式 | 差分パッチではなくファイル全文を生成。PoCのドキュメント規模では最も単純で壊れにくい |
| 静的サイト化 | 今回は行わない。Docsはリポジトリ内相対リンクのプレーンMarkdownで、MkDocs等の `docs_dir` に `overview/` `features/` `manual/` `changes/` を載せれば `main → Docs Build → Static HTML → Hosting` に拡張できる |
