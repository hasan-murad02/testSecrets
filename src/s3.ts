import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { fromInstanceMetadata } from '@aws-sdk/credential-providers';
import { Body, Controller, HttpException, Post } from '@nestjs/common';
import { getSecret } from './secrets';

let s3: S3Client | undefined;

@Controller()
export class S3Controller {
  // Test-only: writes a small object using settings cached from the secret.
  @Post('s3-upload')
  async upload(@Body() body?: { content?: string }) {
    const region = getSecret('AWS_REGION');
    const bucket = getSecret('AWS_S3_BUCKET');
    const baseUrl = getSecret('AWS_S3_BASE_URL');
    const missingKeys = [['AWS_REGION', region], ['AWS_S3_BUCKET', bucket], ['AWS_S3_BASE_URL', baseUrl]].filter(([, v]) => !v).map(([k]) => k);
    if (missingKeys.length) throw new HttpException({ ok: false, error: 'SecretSettingsMissing', missingKeys }, 503);

    const content = typeof body?.content === 'string' ? body.content.slice(0, 1000) : 'hello from secrets test';
    const key = `secret-test/${Date.now()}.txt`;
    s3 ??= new S3Client({ region, credentials: fromInstanceMetadata() }); // same pattern as the repo's S3 upload client
    try {
      const res = await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: content, ContentType: 'text/plain' }));
      return { ok: true, bucket, key, url: `${baseUrl!.replace(/\/$/, '')}/${key}`, awsRequestId: res.$metadata.requestId };
    } catch (err: any) {
      throw new HttpException({ ok: false, error: String(err?.name ?? 'UnknownError'), awsRequestId: err?.$metadata?.requestId }, 502);
    }
  }
}
