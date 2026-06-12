import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getTenantConfig } from '@/lib/tenants';
import { getTemplates } from '@/lib/service-sfmc';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenant = getTenantConfig(session.user.email);
  if (!tenant) {
    return Response.json([], { status: 200 });
  }

  try {
    const templates = await getTemplates(tenant);
    return Response.json(templates);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
