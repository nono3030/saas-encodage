import { extractDocContent, extractDocIdFromUrl } from './google-docs';
import { processHtml } from './service-ai';
import { uploadImage, upsertAsset } from './service-sfmc';
import type { TenantConfig } from './tenants';
import type { ProcessConfig, ProcessResult, ProgressEvent, ScanResult } from './types';

type SendFn = (event: ProgressEvent) => void;

export async function executeProcess(
  config: ProcessConfig,
  accessToken: string,
  tenant: TenantConfig,
  send: SendFn,
  preParsedScan?: ScanResult
): Promise<ProcessResult> {
  const log = (message: string, progress?: number) => send({ type: 'log', message, progress });

  const now = new Date();
  const datePrefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

  let { assetName, assetId } = config;

  if (assetName && !assetId && !assetName.startsWith(datePrefix)) {
    assetName = `${datePrefix} - ${assetName.trim()}`;
  }
  if (!assetId && !assetName) {
    throw new Error('Vous devez donner un NOM pour créer un nouveau bloc.');
  }

  // 1. Scan
  let scanResult: ScanResult;
  if (preParsedScan) {
    scanResult = preParsedScan;
    log('Fichier DOCX chargé.', 30);
  } else {
    log('Scan du document...', 10);
    const docId = extractDocIdFromUrl(config.docUrl!);
    scanResult = await extractDocContent(docId, accessToken, config.tabId);
    log('Scan terminé.', 30);
  }

  // 2. Upload images (before AI so tokens are real URLs when Gemini runs)
  let htmlRaw = scanResult.htmlRaw;
  const imageEntries = Object.entries(scanResult.images);
  log(`Upload de ${imageEntries.length} image(s) vers SFMC...`, 42);
  let imgCount = 0;

  for (const [token, imgData] of imageEntries) {
    try {
      const url = await uploadImage(imgData.base64, imgData.name, imgData.mimeType, tenant);
      htmlRaw = htmlRaw.split(token).join(url);
      imgCount++;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('Category') || msg.includes('folder')) {
        log(`⚠️ Image ignorée : dossier SFMC introuvable — vérifiez sfmc_images_folder_id dans la config.`);
      } else {
        log(`⚠️ Image ignorée (upload échoué) : ${msg.substring(0, 120)}`);
      }
    }
  }
  log(`${imgCount} image(s) traitée(s).`, 60);

  // 3. AI cleanup
  log('Nettoyage IA (Gemini)...', 65);
  let finalHtml = htmlRaw;
  try {
    finalHtml = await processHtml(htmlRaw);
    log('IA : Succès.', 85);
  } catch (e) {
    log(`IA échouée → HTML brut utilisé. (${(e as Error).message})`, 85);
    finalHtml = htmlRaw;
  }

  // 4. Push to SFMC
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
