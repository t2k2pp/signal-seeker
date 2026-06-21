// lllmAgents の CredentialVault.resolve() を簡略化。
// "env:NAME" を環境変数解決、それ以外は平文。暗号化キーは初期スコープ外。

export function resolveApiKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw.startsWith("env:")) {
    const name = raw.slice(4);
    return process.env[name];
  }
  return raw;
}
