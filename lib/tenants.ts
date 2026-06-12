import { readFileSync } from 'fs';
import { join } from 'path';

export interface TenantConfig {
  sfmc_subdomain: string;
  sfmc_client_id: string;
  sfmc_client_secret: string;
  sfmc_content_folder_id: number;
  sfmc_images_folder_id: number;
}

type TenantsMap = Record<string, TenantConfig>;

function loadTenants(): TenantsMap {
  // En prod (Vercel) : variable d'env TENANTS_CONFIG contenant le JSON
  if (process.env.TENANTS_CONFIG) {
    return JSON.parse(process.env.TENANTS_CONFIG) as TenantsMap;
  }
  // En dev local : fichier tenants.json à la racine
  try {
    const file = readFileSync(join(process.cwd(), 'tenants.json'), 'utf-8');
    return JSON.parse(file) as TenantsMap;
  } catch {
    return {};
  }
}

export function getDomainFromEmail(email: string): string {
  return email.split('@')[1]?.toLowerCase() || '';
}

export function getTenantConfig(email: string): TenantConfig | null {
  const domain = getDomainFromEmail(email);
  if (!domain) return null;
  const tenants = loadTenants();
  return tenants[domain] ?? null;
}

export function isAuthorizedDomain(email: string): boolean {
  return getTenantConfig(email) !== null;
}
