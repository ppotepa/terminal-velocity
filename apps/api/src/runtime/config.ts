export interface ApiConfig { readonly host: '127.0.0.1'; readonly port: number; }

export function readApiConfig(environment: Readonly<Record<string, string | undefined>>): ApiConfig {
  const raw = environment['PORT'] ?? '3000';
  if (!/^[1-9][0-9]{0,4}$/.test(raw)) throw new Error('PORT must be a decimal integer from 1 to 65535.');
  const port = Number(raw);
  if (port > 65_535) throw new Error('PORT must be a decimal integer from 1 to 65535.');
  return { host: '127.0.0.1', port };
}
