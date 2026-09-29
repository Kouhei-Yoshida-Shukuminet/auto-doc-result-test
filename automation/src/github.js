// GitHub REST / GraphQL の最小ラッパー（依存を増やさないため fetch を直接使う）

export function createGitHub({ token, apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com' }) {
  if (!token) throw new Error('GitHub token is required (GITHUB_TOKEN)');

  async function request(method, path, { body, accept = 'application/vnd.github+json' } = {}) {
    const url = path.startsWith('http') ? path : `${apiUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        accept,
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`GitHub API ${method} ${path} failed: ${res.status} ${await res.text()}`);
    }
    return { res, data: accept.includes('json') ? await res.json() : await res.text() };
  }

  return {
    async get(path) {
      return (await request('GET', path)).data;
    },
    async getText(path, accept) {
      return (await request('GET', path, { accept })).data;
    },
    async paginate(path) {
      const items = [];
      let next = `${path}${path.includes('?') ? '&' : '?'}per_page=100`;
      while (next) {
        const { res, data } = await request('GET', next);
        items.push(...data);
        next = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
      }
      return items;
    },
    async graphql(query, variables) {
      const { data } = await request('POST', `${apiUrl.replace(/\/v3$/, '')}/graphql`, { body: { query, variables } });
      if (data.errors) throw new Error(`GitHub GraphQL failed: ${JSON.stringify(data.errors)}`);
      return data.data;
    },
  };
}

export function splitRepo(fullName) {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) throw new Error(`Invalid repository name: ${fullName}`);
  return { owner, repo };
}
