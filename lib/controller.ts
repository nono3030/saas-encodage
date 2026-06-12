import { extractDocContent, extractDocIdFromUrl } from './google-docs';
import { processHtml } from './service-ai';
import { uploadImage, upsertAsset, getTemplateInfo } from './service-sfmc';
import type { TenantConfig } from './tenants';
import type { ProcessConfig, ProcessResult, ProgressEvent } from './types';

type SendFn = (event: ProgressEvent) => void;

// ─── Template style helpers (ported from Controller_App.gs) ──────────────────

const TYPO_PROPS = ['color', 'font-family', 'font-size', 'font-weight', 'line-height',
  'letter-spacing', 'text-decoration', 'font-style'];

function stripTypoStyles(html: string): string {
  html = html.replace(/<(h[1-6]|p|li|ul|ol)(\s[^>]*)?>/gi, (_, tag: string, attrs: string) => {
    if (!attrs) return `<${tag}>`;
    attrs = attrs.replace(/style="([^"]*)"/i, (_m: string, styleVal: string) => {
      const parts = styleVal.split(';').filter(rule => {
        const prop = rule.split(':')[0].trim().toLowerCase();
        return rule.trim() !== '' && !TYPO_PROPS.includes(prop);
      });
      return parts.length > 0 ? `style="${parts.join(';')}"` : '';
    });
    return `<${tag}${attrs}>`;
  });

  html = html.replace(/<span\s+style="([^"]*)">/gi, (_: string, styleVal: string) => {
    const parts = styleVal.split(';').filter(rule => {
      const prop = rule.split(':')[0].trim().toLowerCase();
      return rule.trim() !== '' && !TYPO_PROPS.includes(prop);
    });
    return parts.length > 0 ? `<span style="${parts.join(';')}">` : '<span>';
  });

  return html;
}

function applyTemplateStyles(html: string, globalStyles: Record<string, Record<string, string>>): string {
  function objToCss(s: Record<string, string>): string {
    return Object.entries(s).map(([k, v]) => `${k}:${v}`).join(';');
  }

  function injectOnTag(h: string, tagName: string, styleObj: Record<string, string>): string {
    const newCss = objToCss(styleObj);
    return h.replace(new RegExp(`<(${tagName})(\\s[^>]*)?>`, 'gi'), (_: string, tag: string, attrs = '') => {
      let existing = '';
      const m = attrs.match(/style="([^"]*)"/i);
      if (m) {
        existing = m[1].replace(/;+$/, '');
        attrs = attrs.replace(/\s*style="[^"]*"/i, '');
      }
      const merged = (existing ? existing + ';' : '') + newCss;
      return `<${tag}${attrs} style="${merged}">`;
    });
  }

  for (const tag of ['h1', 'h2', 'h3']) {
    if (globalStyles[tag]) html = injectOnTag(html, tag, globalStyles[tag]);
  }
  if (globalStyles.body) {
    html = injectOnTag(html, 'p', globalStyles.body);
    html = injectOnTag(html, 'li', globalStyles.body);
  }
  if (globalStyles.links) html = injectOnTag(html, 'a', globalStyles.links);

  return html;
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function executeProcess(
  config: ProcessConfig,
  accessToken: string,
  tenant: TenantConfig,
  send: SendFn
): Promise<ProcessResult> {
  const log = (message: string, progress?: number) => send({ type: 'log', message, progress });

  // Date prefix
  const now = new Date();
  const datePrefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

  let { assetName, assetId, templateId, docUrl } = config;

  if (assetName && !assetId && !assetName.startsWith(datePrefix)) {
    assetName = `${datePrefix} - ${assetName.trim()}`;
  }
  if (!assetId && !assetName) {
    throw new Error('Vous devez donner un NOM pour créer un nouveau bloc.');
  }

  // 1. Scan
  log('Scan du document...', 10);
  const docId = extractDocIdFromUrl(docUrl);
  const scanResult = await extractDocContent(docId, accessToken);
  log('Scan terminé.', 30);

  // 2. Template info
  let templateInfo = null;
  let htmlRaw = scanResult.htmlRaw;

  if (templateId) {
    log('Récupération des infos du template SFMC...', 35);
    try {
      templateInfo = await getTemplateInfo(templateId, tenant);
      if (templateInfo) {
        htmlRaw = stripTypoStyles(htmlRaw);
        log(`Template prêt (slot: "${templateInfo.slotName}"). Styles inline supprimés.`, 40);
      } else {
        log('Template introuvable → mode freeform.', 40);
      }
    } catch {
      log('Erreur récupération template → mode freeform.', 40);
    }
  }

  // 3. AI cleanup
  log('Nettoyage IA (Gemini)...', 42);
  let finalHtml = htmlRaw;
  try {
    finalHtml = await processHtml(htmlRaw);
    log('IA : Succès.', 60);
  } catch (e) {
    log(`IA échouée → HTML brut utilisé. (${(e as Error).message})`, 60);
    finalHtml = htmlRaw;
  }

  // 4. Upload images
  const imageEntries = Object.entries(scanResult.images);
  log(`Upload de ${imageEntries.length} image(s) vers SFMC...`, 65);
  let imgCount = 0;

  for (const [token, imgData] of imageEntries) {
    try {
      const url = await uploadImage(imgData.base64, imgData.name, imgData.mimeType, tenant);
      finalHtml = finalHtml.split(token).join(url);
      imgCount++;
    } catch (e) {
      log(`Erreur upload image: ${imgData.name} — ${(e as Error).message}`);
    }
  }
  log(`${imgCount} image(s) traitée(s).`, 85);

  // 5. Apply template styles
  if (templateInfo?.globalStyles) {
    log('Injection des styles du template...', 88);
    finalHtml = applyTemplateStyles(finalHtml, templateInfo.globalStyles);
  }

  // 6. Push to SFMC
  log('Envoi vers SFMC...', 90);
  const res = await upsertAsset(
    finalHtml,
    assetName,
    tenant,
    assetId ? parseInt(assetId, 10) : undefined
  );
  log(`TERMINÉ ! Asset ID : ${res.id}`, 100);

  return { success: true, assetId: res.id, assetName: res.name, previewHtml: finalHtml };
}
