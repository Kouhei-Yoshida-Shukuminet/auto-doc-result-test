// Claude API 呼び出し。AUTO_DOC_AI_MODE=mock でAPIを呼ばない決定的な応答に切り替えられる（ローカル確認・テスト用）
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';

export function createAi(config, { mode = process.env.AUTO_DOC_AI_MODE ?? 'anthropic' } = {}) {
  if (mode === 'mock') return { mode, structured: mockStructured };
  if (mode !== 'anthropic') throw new Error(`Unknown AUTO_DOC_AI_MODE: ${mode}`);

  const client = new Anthropic();
  return {
    mode,
    async structured({ stage, system, user, schema }) {
      const response = await client.beta.messages.parse({
        model: config.model,
        max_tokens: config.maxTokens,
        // 安全分類器による拒否時は、サーバ側で自動的に代替モデルへフォールバックする
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: config.effort[stage], format: betaZodOutputFormat(schema) },
        system,
        messages: [{ role: 'user', content: user }],
      });
      const { input_tokens, output_tokens } = response.usage;
      console.log(`[ai] stage=${stage} model=${response.model} stop=${response.stop_reason} in=${input_tokens} out=${output_tokens}`);

      if (response.stop_reason === 'refusal') {
        throw new Error(`AI refused the request (${stage}): ${JSON.stringify(response.stop_details)}`);
      }
      if (response.stop_reason === 'max_tokens') {
        throw new Error(`AI output hit max_tokens (${config.maxTokens}) at stage ${stage}`);
      }
      if (!response.parsed_output) throw new Error(`AI returned no parseable output at stage ${stage}`);
      return response.parsed_output;
    },
  };
}

// ---- mock ----------------------------------------------------------------

const mocks = {
  analyze({ targets }) {
    const doc = (files) => ({ required: true, files, reason: 'mock: 常に更新対象とする' });
    return {
      summary: 'mock: 実装変更の要約',
      change_type: 'feature',
      user_facing: true,
      breaking_change: false,
      migration_required: false,
      affected_documents: {
        overview: doc(targets.overview),
        feature_spec: doc(targets.feature_spec),
        manual: doc(targets.manual),
        change_log: doc(targets.change_log),
      },
      update_instructions: [],
    };
  },
  generate({ path, current, context }) {
    const pr = context.pullRequest;
    const note = `<!-- mock update: ${context.sourceRepo}#${pr.number} ${pr.title} -->`;
    return { content: `${(current ?? `# ${path}\n`).trimEnd()}\n\n${note}\n`, summary: `mock: ${path} を更新` };
  },
  reviewFix({ comments, docs }) {
    const targets = [...new Set(comments.filter((c) => c.path && docs[c.path] != null).map((c) => c.path))];
    return {
      edits: targets.map((path) => ({
        path,
        content: `${docs[path].trimEnd()}\n\n<!-- mock fix: ${comments.filter((c) => c.path === path).length} comment(s) -->\n`,
        summary: `mock: ${path} へのコメントに対応`,
      })),
      reply: `mock: ${comments.length}件のコメントに対応しました。`,
    };
  },
};

async function mockStructured({ stage, mockInput }) {
  return mocks[stage](mockInput);
}
