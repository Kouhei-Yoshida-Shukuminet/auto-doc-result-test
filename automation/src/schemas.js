// AI出力の構造（Structured Outputs で強制し、zodで検証する）
import { z } from 'zod';

const DocTarget = z.object({
  required: z.boolean(),
  files: z.array(z.string()),
  reason: z.string(),
});

// Stage 1: 変更分析 + 更新対象判定
export const AnalysisSchema = z.object({
  summary: z.string(),
  change_type: z.enum(['feature', 'bugfix', 'improvement', 'refactor', 'docs', 'chore']),
  user_facing: z.boolean(),
  breaking_change: z.boolean(),
  migration_required: z.boolean(),
  affected_documents: z.object({
    overview: DocTarget,
    feature_spec: DocTarget,
    manual: DocTarget,
    change_log: DocTarget,
  }),
  update_instructions: z.array(z.object({ file: z.string(), instructions: z.string() })),
});

// Stage 2: ドキュメント生成（1ファイルずつ）
export const GeneratedDocSchema = z.object({
  content: z.string(),
  summary: z.string(),
});

// レビュー修正
export const ReviewFixSchema = z.object({
  edits: z.array(z.object({ path: z.string(), content: z.string(), summary: z.string() })),
  reply: z.string(),
});
