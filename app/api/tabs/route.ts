import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { fetchDocTabs } from '@/lib/google-docs';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const docUrl = searchParams.get('docUrl');
  if (!docUrl) return Response.json([]);

  try {
    const tabs = await fetchDocTabs(docUrl, session.accessToken);
    console.log('[/api/tabs] returning', tabs.length, 'tabs');
    return Response.json(tabs);
  } catch (e) {
    console.error('[/api/tabs] error', e);
    return Response.json([]);
  }
}
