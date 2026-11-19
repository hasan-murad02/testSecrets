import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Logger } from '@nestjs/common';

export const SECRET_NAME = 'NysoHub-Prod';
export const SECRETS_REGION = 'ap-south-1'; // locates Secrets Manager only; unrelated to the AWS_REGION key inside the secret
export const REQUIRED_KEYS = ['AWS_REGION', 'AWS_S3_BUCKET', 'AWS_S3_BASE_URL'];

// Default credential chain (env, shared config, then EC2 instance role).
const client = new SecretsManagerClient({ region: SECRETS_REGION });

export type Stage = 'not_run' | 'retrieval_failed' | 'parse_failed' | 'missing_keys' | 'ok';

export interface Status {
  stage: Stage;
  retrievalSucceeded: boolean;
  parsingSucceeded: boolean;
  allRequiredKeysPresent: boolean;
  missingKeys: string[];
  errorType?: string;
  awsRequestId?: string;
}

let cache: Record<string, string> = {};
let status: Status = {
  stage: 'not_run',
  retrievalSucceeded: false,
  parsingSucceeded: false,
  allRequiredKeysPresent: false,
  missingKeys: [...REQUIRED_KEYS],
};
const logger = new Logger('SecretsManager');

export const getStatus = (): Status => ({ ...status, missingKeys: [...status.missingKeys] });
export const getSecret = (key: string): string | undefined => cache[key];

/** Never throws: on any failure it logs a safe diagnostic, clears the cache and returns. */
export async function initSecretsManager(c: { send: (cmd: any) => Promise<any> } = client): Promise<void> {
  const started = Date.now();
  let awsRequestId: string | undefined;
  cache = {};
  status = { ...status, stage: 'not_run', retrievalSucceeded: false, parsingSucceeded: false, allRequiredKeysPresent: false, missingKeys: [...REQUIRED_KEYS], errorType: undefined, awsRequestId: undefined };
  const log = (level: 'log' | 'error', msg: string, extra: Record<string, unknown> = {}) =>
    logger[level](`${msg} ${JSON.stringify({ secretName: SECRET_NAME, region: SECRETS_REGION, durationMs: Date.now() - started, awsRequestId, ...extra })}`);

  let secretString: string | undefined;
  try {
    const res = await c.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }));
    awsRequestId = res?.$metadata?.requestId;
    secretString = res?.SecretString;
  } catch (err: any) {
    awsRequestId = err?.$metadata?.requestId;
    const errorType = String(err?.name ?? 'UnknownError');
    status = { ...status, stage: 'retrieval_failed', errorType, awsRequestId };
    log('error', 'Secret retrieval failed', { errorType });
    return;
  }
  status = { ...status, retrievalSucceeded: true, awsRequestId };

  try {
    const parsed = JSON.parse(secretString as string); // throws on undefined (binary secret) too
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string' && v !== '') cache[k] = v;
  } catch {
    // Deliberately drop the error: JSON.parse messages can quote secret content.
    cache = {};
    status = { ...status, stage: 'parse_failed', errorType: 'SecretParseError' };
    log('error', 'Secret parsing failed', { errorType: 'SecretParseError' });
    return;
  }

  const missingKeys = REQUIRED_KEYS.filter((k) => !(k in cache));
  status = { ...status, parsingSucceeded: true, missingKeys, allRequiredKeysPresent: missingKeys.length === 0, stage: missingKeys.length ? 'missing_keys' : 'ok' };
  log(missingKeys.length ? 'error' : 'log', missingKeys.length ? 'Secret loaded but incomplete' : 'Secret loaded', { missingKeys });
}
