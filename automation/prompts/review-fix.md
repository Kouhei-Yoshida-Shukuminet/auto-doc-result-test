あなたが作成したドキュメント更新PR（Docs PR）に、人間のレビュアーから修正指示がありました。

## 元になった実装変更

{{source_context}}

## Docs PR

<docs_pull_request number="{{docs_pr_number}}" url="{{docs_pr_url}}">
# {{docs_pr_title}}
</docs_pull_request>

このDocs PRで変更されているファイル：
{{pr_files}}

## 現在のドキュメント（Docs PRのブランチ上の内容。行番号付き）

{{current_docs}}

## レビュー

<review author="{{review_author}}" state="{{review_state}}">
{{review_body}}
</review>

<review_comments>
{{review_comments}}
</review_comments>

## タスク

レビューコメントの指示に従ってドキュメントを修正してください。

- 各コメントの `path` と `line` は、上記の行番号付きドキュメントの該当行を指します（`diff_hunk` はコメント時点の差分です）。
- 修正したファイルだけを `edits` に含め、`content` にはファイル全体（行番号を除いた、そのまま保存できる完成形）を入れる。修正不要なら `edits` は空にする。
- 修正できるのは上記の現在のドキュメントとして示したファイルだけ。新規ファイルは作らない。
- 指示が実装内容（diff）と矛盾する、または意図が曖昧な場合は、推測で書き換えずに `reply` でその旨と確認したい点を述べる。
- `reply` はDocs PRにコメントとして投稿されます。対応した内容（コメントごと）と、対応しなかったものはその理由を日本語で簡潔に書く。
