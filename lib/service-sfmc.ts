import { createHash } from 'crypto';
import type { TenantConfig } from './tenants';
import type { SfmcTemplate, SfmcTemplateInfo } from './types';

// ─── Token cache per tenant ───────────────────────────────────────────────────

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

// ─── Config builder ───────────────────────────────────────────────────────────

function buildConfig(tenant: TenantConfig) {
  const sub = tenant.sfmc_subdomain;
  return {
    authUrl: `https://${sub}.auth.marketingcloudapis.com/v2/token`,
    restUrl: `https://${sub}.rest.marketingcloudapis.com`,
    contentFolderId: tenant.sfmc_content_folder_id,
    imagesFolderId: tenant.sfmc_images_folder_id,
  };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getToken(tenant: TenantConfig): Promise<string> {
  const cacheKey = tenant.sfmc_client_id;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const config = buildConfig(tenant);
  const res = await fetch(config.authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: tenant.sfmc_client_id,
      client_secret: tenant.sfmc_client_secret,
    }),
  });

  if (!res.ok) {
    throw new Error(`SFMC Auth Fail (${res.status}): ${(await res.text()).substring(0, 300)}`);
  }
  const json = await res.json();
  tokenCache.set(cacheKey, { token: json.access_token, expiresAt: Date.now() + 14 * 60 * 1000 });
  return json.access_token;
}

// ─── Asset search ─────────────────────────────────────────────────────────────

async function findAssetByName(name: string, tenant: TenantConfig, assetTypeId?: number): Promise<{ id: number; url?: string } | null> {
  const token = await getToken(tenant);
  const config = buildConfig(tenant);
  let filter = `name eq '${name}'`;
  if (assetTypeId) filter += ` and assetType.id eq ${assetTypeId}`;

  const res = await fetch(
    `${config.restUrl}/asset/v1/content/assets?$filter=${encodeURIComponent(filter)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.items?.length) return null;
  return { id: json.items[0].id, url: json.items[0].fileProperties?.publishedURL };
}

// ─── Image upload ─────────────────────────────────────────────────────────────

const IMAGE_TYPE_MAP: Record<string, { id: number; name: string; ext: string }> = {
  jpeg: { id: 23, name: 'jpeg', ext: 'jpg' },
  jpg:  { id: 23, name: 'jpeg', ext: 'jpg' },
  png:  { id: 28, name: 'png',  ext: 'png' },
  gif:  { id: 20, name: 'gif',  ext: 'gif' },
};

function sfmcImageError(json: Record<string, unknown>): string {
  const validation = (json.validationErrors as { message: string }[] | undefined)
    ?.map(e => e.message).join('; ');
  return validation || (json.message as string) || JSON.stringify(json).substring(0, 200);
}

export async function uploadImage(base64: string, rawName: string, mimeType: string, tenant: TenantConfig): Promise<string> {
  const token = await getToken(tenant);
  const config = buildConfig(tenant);

  const rawExt = mimeType.split('/')[1]?.split('+')[0]?.toLowerCase() || 'jpg';
  const assetType = IMAGE_TYPE_MAP[rawExt] ?? IMAGE_TYPE_MAP.jpeg;
  const ext = assetType.ext;

  const cleanName = rawName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9\-_ ]/g, '').trim().substring(0, 40) || 'Image';
  const hash = createHash('md5').update(base64.substring(0, 500)).digest('hex').substring(0, 6);
  const finalName = `${cleanName}_${hash}.${ext}`;

  const existing = await findAssetByName(finalName, tenant);
  if (existing?.url) return existing.url;

  const payload = { name: finalName, assetType: { id: assetType.id, name: assetType.name }, file: base64, category: { id: config.imagesFolderId } };

  const res = await fetch(`${config.restUrl}/asset/v1/content/assets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (json.fileProperties?.publishedURL) return json.fileProperties.publishedURL;

  // Retry with timestamp name in case of name conflict
  const fallbackName = `${cleanName}_${Date.now()}.${ext}`;
  const retry = await fetch(`${config.restUrl}/asset/v1/content/assets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, name: fallbackName }),
  });
  const retryJson = await retry.json();
  if (retryJson.fileProperties?.publishedURL) return retryJson.fileProperties.publishedURL;
  throw new Error(`Image Upload Failed: ${sfmcImageError(retryJson)}`);
}

// ─── Upsert content block ────────────────────────────────────────────────────

export async function upsertAsset(html: string, name: string | undefined, tenant: TenantConfig, assetId?: number): Promise<{ id: number; name: string }> {
  const token = await getToken(tenant);
  const config = buildConfig(tenant);

  const sizeKB = Math.round(JSON.stringify({ content: html }).length / 1024);
  if (sizeKB > 3500) throw new Error(`HTML trop volumineux (${sizeKB} KB). Limite SFMC ~4MB.`);

  let targetId = assetId;
  if (!targetId && name) {
    const found = await findAssetByName(name, tenant);
    targetId = found?.id;
  }

  let endpoint = `${config.restUrl}/asset/v1/content/assets`;
  let method = 'POST';
  let body: object;

  if (targetId) {
    endpoint += `/${targetId}`;
    method = 'PATCH';
    body = { name, content: html };
  } else {
    body = { name, assetType: { name: 'freeformblock', id: 195 }, content: html, category: { id: config.contentFolderId } };
  }

  const res = await fetch(endpoint, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  const rawBody = await res.text();
  if (!rawBody.trim()) throw new Error(`SFMC réponse vide (HTTP ${res.status}).`);
  const json = JSON.parse(rawBody);
  if (res.ok) return { id: json.id, name: json.name };
  const detail = json.validationErrors?.map((e: { message: string }) => e.message).join('; ')
    || json.errors?.map((e: { message: string }) => e.message).join('; ')
    || json.message
    || `SFMC Error HTTP ${res.status}`;
  throw new Error(detail);
}

// ─── Templates ────────────────────────────────────────────────────────────────

export async function getTemplates(tenant: TenantConfig): Promise<SfmcTemplate[]> {
  try {
    const token = await getToken(tenant);
    const config = buildConfig(tenant);
    const allItems: SfmcTemplate[] = [];
    let page = 1;

    while (allItems.length < 500) {
      const res = await fetch(
        `${config.restUrl}/asset/v1/content/assets?$filter=assetType.id%20eq%204&$page=${page}&$pagesize=200&$orderby=name%20asc`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      const items: { id: number; name: string }[] = json.items || [];
      if (!items.length) break;
      for (const item of items) allItems.push({ id: item.id, name: item.name });
      const total = json.count || json.totalCount || items.length;
      if (allItems.length >= total || items.length < 200) break;
      page++;
    }
    return allItems;
  } catch {
    return [];
  }
}

export async function getTemplateInfo(templateId: string | number, tenant: TenantConfig): Promise<SfmcTemplateInfo | null> {
  if (!templateId) return null;
  try {
    const token = await getToken(tenant);
    const config = buildConfig(tenant);
    const res = await fetch(
      `${config.restUrl}/asset/v1/content/assets/${templateId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const json = await res.json();
    const slots = json.slots ? Object.keys(json.slots) : [];
    return { globalStyles: json.meta?.globalStyles || null, slots, slotName: slots[0] || 'body' };
  } catch {
    return null;
  }
}

export async function testConnection(tenant: TenantConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const token = await getToken(tenant);
    const config = buildConfig(tenant);
    const res = await fetch(`${config.restUrl}/asset/v1/content/assets?$pageSize=1`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return { ok: true, message: '✅ Connexion SFMC réussie !' };
    return { ok: false, message: `❌ SFMC Error ${res.status}` };
  } catch (e) {
    return { ok: false, message: '❌ ' + (e as Error).message };
  }
}
