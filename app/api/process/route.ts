import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { executeProcess } from '@/lib/controller';
import { extractDocxContent } from '@/lib/docx-parser';
import { getTenantConfig } from '@/lib/tenants';
import type { ProcessConfig, ProgressEvent, ScanResult } from '@/lib/types';

export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const tenant = getTenantConfig(session.user.email);
  if (!tenant) {
    return new Response(JSON.stringify({ error: 'Domaine non autorisé.' }), { status: 403 });
  }

  let config: ProcessConfig;
  let preParsedScan: ScanResult | undefined;
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return new Response(JSON.stringify({ error: 'Fichier manquant.' }), { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    preParsedScan = await extractDocxContent(buffer);
    config = {
      assetName: (formData.get('assetName') as string) || undefined,
      assetId: (formData.get('assetId') as string) || undefined,
    };
  } else {
    if (!session.accessToken) {
      return new Response(JSON.stringify({ error: 'Token Google manquant — reconnectez-vous.' }), { status: 401 });
    }
    config = await request.json();
    if (!config.docUrl) {
      return new Response(JSON.stringify({ error: 'docUrl requis' }), { status: 400 });
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ProgressEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const result = await executeProcess(config, session.accessToken ?? '', tenant, send, preParsedScan);
        send({ type: 'result', data: result });
      } catch (e) {
        send({ type: 'error', message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
