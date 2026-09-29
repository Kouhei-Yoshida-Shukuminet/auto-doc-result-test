以下は実装リポジトリで main にマージされた変更と、ドキュメント管理リポジトリの現在のドキュメントです。

{{source_context}}

{{existing_docs}}

## タスク

この変更がドキュメントに与える影響を分析し、更新が必要なドキュメントを判定してください。まだ文章は書きません。

判定の基準：

- `overview`：機能の追加・削除・名称変更など、機能一覧に載る情報が変わる場合、または関連Issueへの導線を追加する場合に required。候補：{{overview_files}}
- `feature_spec`：利用者から観測できる振る舞い（入力・出力・エラー・制約）が変わる場合に required。候補：{{feature_spec_files}}（新しい機能で既存ページに収まらない場合のみ `features/` 配下の新規ファイルを提案してよい）
- `manual`：利用者の操作手順や画面表示が変わる場合に required。候補：{{manual_files}}（新規ファイルの扱いは feature_spec と同じ）
- `change_log`：常に required。ファイルは `{{change_log_file}}` とする。

内部リファクタリングやテストのみの変更など、利用者から見た振る舞いが変わらない場合は、change_log 以外を required: false にしてください。

`update_instructions` には、required にした各ファイルについて「どの節に・何を・なぜ」反映すべきかを、diff の根拠とともに具体的に書いてください。
`summary` は、Docs PRの「Change Summary」としてレビュアーが読む日本語の要約（2〜4文）にしてください。
