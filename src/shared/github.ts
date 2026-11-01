// Accesso all'API REST di GitHub dal browser con un "fine-grained personal access token"
// limitato al solo repository dell'app (permesso Contents: Read and write).
export const GITHUB_API = 'https://api.github.com';
export const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export type GitHubErrorKind = 'token' | 'permessi' | 'repo' | 'conflitto' | 'rete' | 'sconosciuto';

export class GitHubError extends Error {
  kind: GitHubErrorKind;
  status?: number;
  constructor(kind: GitHubErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'GitHubError';
    this.kind = kind;
    this.status = status;
  }
}

export interface GitHubOptions {
  token: string;
  /** "proprietario/repository" */
  repo: string;
  fetchImpl?: typeof fetch;
}

/** "Atisl-2026/SICUREZZA", URL o spazi → forma canonica owner/repo (o '' se non valida). */
export function normalizeRepo(s: string): string {
  const m = s.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').match(/^([\w.-]+)\/([\w.-]+)\/?$/);
  return m ? `${m[1]}/${m[2]}` : '';
}

/** Ricava owner/repo dall'indirizzo di GitHub Pages: https://owner.github.io/repo/ */
export function repoFromPagesUrl(href: string): string {
  try {
    const u = new URL(href);
    const owner = u.hostname.match(/^([\w-]+)\.github\.io$/i)?.[1];
    if (!owner) return '';
    const first = u.pathname.split('/').filter(Boolean)[0];
    return first ? `${owner}/${first}` : `${owner}/${owner}.github.io`;
  } catch {
    return '';
  }
}

export async function githubRequest<T>(path: string, opts: GitHubOptions, init: RequestInit = {}): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${GITHUB_API}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${opts.token.trim()}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers as Record<string, string> | undefined)
      },
      cache: 'no-store'
    });
  } catch {
    throw new GitHubError('rete', 'Impossibile contattare GitHub: controlla la connessione.');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* corpo vuoto */
  }
  if (!res.ok) throw classifyGitHubError(res.status, body);
  return body as T;
}

export function classifyGitHubError(status: number, body: unknown): GitHubError {
  const msg = (body as { message?: string })?.message ?? '';
  if (status === 401) return new GitHubError('token', 'Codice di accesso GitHub non valido o scaduto.', status);
  if (status === 403 && /not accessible|permission|forbidden/i.test(msg)) {
    return new GitHubError('permessi', 'Il codice di accesso non ha il permesso di scrittura: in GitHub deve avere "Contents: Read and write" su questo repository.', status);
  }
  if (status === 403 || status === 429) return new GitHubError('sconosciuto', `GitHub ha rifiutato la richiesta (${status})${msg ? `: ${msg}` : ''}. Riprova tra qualche minuto.`, status);
  if (status === 404) return new GitHubError('repo', 'Repository non trovato, oppure il codice di accesso non è autorizzato su questo repository.', status);
  if (status === 409 || status === 422) return new GitHubError('conflitto', 'Nel frattempo i dati su GitHub sono cambiati: aggiorna l\'app e riprova.', status);
  return new GitHubError('sconosciuto', `Errore GitHub (${status})${msg ? `: ${msg}` : ''}`, status);
}

interface RepoInfo {
  full_name: string;
  default_branch: string;
  private: boolean;
  permissions?: { push?: boolean; admin?: boolean };
}

/** Controlla che il codice di accesso veda il repository e possa scriverci. */
export async function verifyToken(opts: GitHubOptions): Promise<{ repo: string; branch: string }> {
  const info = await githubRequest<RepoInfo>(`/repos/${opts.repo}`, opts);
  if (info.permissions && info.permissions.push === false) {
    throw new GitHubError('permessi', 'Il tuo account GitHub non ha i permessi di scrittura su questo repository.');
  }
  return { repo: info.full_name, branch: info.default_branch || 'main' };
}

/** Contenuto JSON di un file del repository (null se non esiste). Legge da GitHub, non dalla copia di Pages. */
export async function readRepoJson<T>(opts: GitHubOptions, branch: string, path: string): Promise<T | null> {
  try {
    return await githubRequest<T>(
      `/repos/${opts.repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
      opts,
      { headers: { Accept: 'application/vnd.github.raw+json' } }
    );
  } catch (e) {
    if (e instanceof GitHubError && e.kind === 'repo') return null;
    throw e;
  }
}

export interface RepoFile {
  path: string;
  content: string;
}

/**
 * Scrive più file in un'unica modifica (commit) sul ramo indicato, con l'API Git di GitHub:
 * ref → commit → blob → tree → nuovo commit → aggiornamento del ref (senza forzare:
 * se nel frattempo qualcun altro ha pubblicato, GitHub rifiuta e nulla viene sovrascritto).
 */
export async function commitFiles(opts: GitHubOptions, branch: string, files: RepoFile[], message: string): Promise<{ sha: string; url: string }> {
  const r = `/repos/${opts.repo}/git`;
  const ref = await githubRequest<{ object: { sha: string } }>(`${r}/ref/heads/${encodeURIComponent(branch)}`, opts);
  const parent = await githubRequest<{ tree: { sha: string } }>(`${r}/commits/${ref.object.sha}`, opts);
  const tree = [];
  for (const f of files) {
    const blob = await githubRequest<{ sha: string }>(`${r}/blobs`, opts, {
      method: 'POST',
      body: JSON.stringify({ content: f.content, encoding: 'utf-8' })
    });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await githubRequest<{ sha: string }>(`${r}/trees`, opts, {
    method: 'POST',
    body: JSON.stringify({ base_tree: parent.tree.sha, tree })
  });
  const commit = await githubRequest<{ sha: string; html_url: string }>(`${r}/commits`, opts, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [ref.object.sha] })
  });
  await githubRequest(`${r}/refs/heads/${encodeURIComponent(branch)}`, opts, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false })
  });
  return { sha: commit.sha, url: commit.html_url };
}
