import { createHash } from 'crypto';
import type { ImageData, ImageMap, ScanResult } from './types';

// ─── Google Docs API types (subset) ───────────────────────────────────────────

interface RgbColor { red?: number; green?: number; blue?: number }
interface Color { rgbColor?: RgbColor }
interface OptionalColor { color?: Color }
interface Dimension { magnitude?: number; unit?: string }

interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  foregroundColor?: OptionalColor;
  backgroundColor?: OptionalColor;
  fontSize?: Dimension;
  weightedFontFamily?: { fontFamily?: string };
  link?: { url?: string };
}

interface TextRun {
  content: string;
  textStyle?: TextStyle;
}

interface InlineObjectElement {
  inlineObjectId: string;
  textStyle?: TextStyle;
}

interface FootnoteReference {
  footnoteId: string;
  footnoteNumber?: string;
}

interface ParagraphElement {
  textRun?: TextRun;
  inlineObjectElement?: InlineObjectElement;
  footnoteReference?: FootnoteReference;
}

interface ParagraphStyle {
  namedStyleType?: string;
  alignment?: string;
  indentStart?: Dimension;
}

interface Bullet {
  listId: string;
  nestingLevel?: number;
}

interface Paragraph {
  elements: ParagraphElement[];
  paragraphStyle?: ParagraphStyle;
  bullet?: Bullet;
  positionedObjectIds?: string[];
}

interface TableCellStyle {
  backgroundColor?: OptionalColor;
  borderLeft?: { width?: Dimension; color?: OptionalColor; dashStyle?: string };
  borderRight?: { width?: Dimension; color?: OptionalColor; dashStyle?: string };
  borderTop?: { width?: Dimension; color?: OptionalColor; dashStyle?: string };
  borderBottom?: { width?: Dimension; color?: OptionalColor; dashStyle?: string };
}

interface TableCell {
  content: StructuralElement[];
  tableCellStyle?: TableCellStyle;
}

interface TableRow {
  tableCells: TableCell[];
}

interface Table {
  rows: number;
  columns: number;
  tableRows: TableRow[];
}

interface StructuralElement {
  paragraph?: Paragraph;
  table?: Table;
  tableOfContents?: object;
}

interface EmbeddedObject {
  imageProperties?: {
    contentUri?: string;
    sourceUri?: string;
    size?: { width?: Dimension; height?: Dimension };
  };
  title?: string;
  description?: string;
}

interface InlineObject {
  inlineObjectProperties?: { embeddedObject?: EmbeddedObject };
}

interface NestingLevel {
  glyphType?: string;
  glyphFormat?: string;
}

interface ListDefinition {
  listProperties?: { nestingLevels?: NestingLevel[] };
}

interface FootnoteContent {
  content?: StructuralElement[];
}

interface TabDocumentContent {
  body: { content: StructuralElement[] };
  inlineObjects?: Record<string, InlineObject>;
  positionedObjects?: Record<string, { positionedObjectProperties?: { embeddedObject?: EmbeddedObject } }>;
  lists?: Record<string, ListDefinition>;
  footnotes?: Record<string, FootnoteContent>;
}

interface DocTabRaw {
  tabProperties: { tabId: string; title: string; index: number };
  documentTab?: TabDocumentContent;
  childTabs?: DocTabRaw[];
}

interface DocsDocument {
  documentId: string;
  title: string;
  body: { content: StructuralElement[] };
  inlineObjects?: Record<string, InlineObject>;
  positionedObjects?: Record<string, { positionedObjectProperties?: { embeddedObject?: EmbeddedObject } }>;
  lists?: Record<string, ListDefinition>;
  footnotes?: Record<string, FootnoteContent>;
  tabs?: DocTabRaw[];
}

// ─── Context shared across recursive calls ────────────────────────────────────

interface ScanContext {
  images: ImageMap;
  footnotesData: string[];
  ctaCounter: number;
  inlineObjects: Record<string, InlineObject>;
  positionedObjects: DocsDocument['positionedObjects'];
  lists: Record<string, ListDefinition>;
  footnotes: Record<string, FootnoteContent>;
  accessToken: string;
  docId: string;
}

// ─── Allowed email-safe fonts (matches GAS version) ──────────────────────────

const ALLOWED_FONTS = new Set([
  'Arial', 'Arial Black', 'Calibri', 'Comic Sans MS', 'Courier New',
  'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode',
  'Palatino Linotype', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rgbToHex(c: RgbColor): string {
  const r = Math.round((c.red || 0) * 255);
  const g = Math.round((c.green || 0) * 255);
  const b = Math.round((c.blue || 0) * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function getColor(optColor?: OptionalColor): string | null {
  const rgb = optColor?.color?.rgbColor;
  if (!rgb) return null;
  const hex = rgbToHex(rgb);
  return hex === '#000000' ? null : hex;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function extractDocId(url: string): string {
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new Error(`URL Google Doc invalide : ${url}`);
  return m[1];
}

// ─── Image download & registration ───────────────────────────────────────────

async function downloadImage(uri: string, accessToken: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(uri, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    return { base64: buf.toString('base64'), mimeType };
  } catch {
    return null;
  }
}

async function registerImage(
  contentUri: string,
  altText: string,
  widthPt: number,
  heightPt: number,
  ctx: ScanContext
): Promise<{ token: string; width: number; height: number } | null> {
  const img = await downloadImage(contentUri, ctx.accessToken);
  if (!img) return null;

  const hash = createHash('md5').update(img.base64.substring(0, 500)).digest('hex').substring(0, 12);
  const token = `{{IMG_${hash}}}`;
  const ext = img.mimeType.split('/')[1]?.split('+')[0] || 'jpg';
  const width = Math.round(widthPt * 1.333);
  const height = Math.round(heightPt * 1.333);

  if (!ctx.images[token]) {
    ctx.images[token] = { base64: img.base64, name: altText || 'image', mimeType: img.mimeType, hash };
  }

  return { token, width, height };
}

// ─── Text content ─────────────────────────────────────────────────────────────

async function processTextContent(
  elements: ParagraphElement[],
  isHeading: boolean,
  ctx: ScanContext
): Promise<string> {
  let sb = '';

  for (const el of elements) {
    if (el.textRun) {
      const { content, textStyle } = el.textRun;
      if (!content || content === '\n') continue;

      const url = textStyle?.link?.url;
      const bold = textStyle?.bold;
      const italic = textStyle?.italic;
      const underline = textStyle?.underline && !url;
      const strike = textStyle?.strikethrough;
      const fgColor = !isHeading ? getColor(textStyle?.foregroundColor) : null;
      const bgColor = getColor(textStyle?.backgroundColor);
      const font = textStyle?.weightedFontFamily?.fontFamily;

      let prefix = '';
      let suffix = '';

      if (url) { prefix += `<a href="${url}" style="color:#0000EE;text-decoration:underline;">`; suffix = '</a>' + suffix; }
      if (bold) { prefix += '<b>'; suffix = '</b>' + suffix; }
      if (italic) { prefix += '<i>'; suffix = '</i>' + suffix; }
      if (underline) { prefix += '<u>'; suffix = '</u>' + suffix; }
      if (strike) { prefix += '<s>'; suffix = '</s>' + suffix; }

      const spanStyles: string[] = [];
      if (fgColor) spanStyles.push(`color:${fgColor}`);
      if (bgColor) spanStyles.push(`background-color:${bgColor}`);
      if (font && ALLOWED_FONTS.has(font) && !isHeading) spanStyles.push(`font-family:${font},sans-serif`);
      if (spanStyles.length > 0) { prefix += `<span style="${spanStyles.join(';')}">`;  suffix = '</span>' + suffix; }

      sb += prefix + escapeHtml(content) + suffix;

    } else if (el.inlineObjectElement) {
      const obj = ctx.inlineObjects[el.inlineObjectElement.inlineObjectId];
      const embedded = obj?.inlineObjectProperties?.embeddedObject;
      if (embedded?.imageProperties?.contentUri) {
        const widthPt = embedded.imageProperties.size?.width?.magnitude || 400;
        const heightPt = embedded.imageProperties.size?.height?.magnitude || 0;
        const alt = embedded.title || embedded.description || 'Image';
        const result = await registerImage(embedded.imageProperties.contentUri, alt, widthPt, heightPt, ctx);
        if (result) {
          sb += `<img src="${result.token}" alt="${escapeHtml(alt)}" width="${result.width}" height="${result.height || 'auto'}" style="display:inline-block;vertical-align:middle;" />`;
        }
      }

    } else if (el.footnoteReference) {
      const fn = ctx.footnotes[el.footnoteReference.footnoteId];
      if (fn?.content) {
        let fnText = '';
        for (const se of fn.content) {
          if (se.paragraph?.elements) {
            for (const fe of se.paragraph.elements) {
              if (fe.textRun?.content) fnText += fe.textRun.content;
            }
          }
        }
        ctx.footnotesData.push(fnText.trim());
        sb += `<sup>[${ctx.footnotesData.length}]</sup>`;
      }
    }
  }

  return sb;
}

// ─── CTA detection ────────────────────────────────────────────────────────────

function processCustomCTA(raw: string, ctaCounter: number): string {
  try {
    const clean = raw.replace(/[\r\n\v\f\t]+/g, ' ').trim();
    const content = clean.replace('[CTA:', '').replace(']', '').trim();
    const parts = content.split('|');
    const label = parts[0]?.trim() || 'Cliquez';
    const url = parts[1]?.trim() || '#';
    let textColor = '#ffffff';
    let bgColor = '#E30613';
    for (let i = 2; i < parts.length; i++) {
      const p = parts[i].trim();
      if (p.toLowerCase().startsWith('text:')) textColor = p.split(':')[1].trim();
      if (p.toLowerCase().startsWith('bg:')) bgColor = p.split(':')[1].trim();
    }
    return `<table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:20px 0;"><tr><td align="center"><table border="0" cellspacing="0" cellpadding="0"><tr><td align="center" bgcolor="${bgColor}" style="border-radius:4px;padding:12px 25px;"><a href="${url}" target="_blank" alias="Bouton ${ctaCounter}" conversion="true" title="${escapeHtml(label)}" style="font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:${textColor};text-decoration:none;display:inline-block;">${escapeHtml(label)}</a></td></tr></table></td></tr></table>`;
  } catch {
    return '';
  }
}

// ─── Paragraph ───────────────────────────────────────────────────────────────

async function processParagraph(p: Paragraph, ctx: ScanContext): Promise<string> {
  const elements = p.elements || [];
  const style = p.paragraphStyle;
  const namedStyle = style?.namedStyleType || 'NORMAL_TEXT';
  const alignment = style?.alignment;

  // Detect CTA
  const fullText = elements.map(e => e.textRun?.content || '').join('');
  if (fullText.trim().startsWith('[CTA:')) {
    const html = processCustomCTA(fullText, ctx.ctaCounter);
    ctx.ctaCounter++;
    return html;
  }

  // Skip empty paragraphs
  if (elements.every(e => !e.textRun?.content?.trim() && !e.inlineObjectElement && !e.footnoteReference)) {
    return '';
  }

  // Image-only paragraph → single table row with one <td> per image
  const hasText = elements.some(e => e.textRun?.content?.trim() || e.footnoteReference);
  const imageOnlyElements = elements.filter(e => e.inlineObjectElement);
  if (!hasText && imageOnlyElements.length > 0) {
    let cells = '';
    for (const el of imageOnlyElements) {
      const obj = ctx.inlineObjects[el.inlineObjectElement!.inlineObjectId];
      const embedded = obj?.inlineObjectProperties?.embeddedObject;
      if (embedded?.imageProperties?.contentUri) {
        const widthPt = embedded.imageProperties.size?.width?.magnitude || 400;
        const heightPt = embedded.imageProperties.size?.height?.magnitude || 0;
        const alt = embedded.title || embedded.description || '';
        const result = await registerImage(embedded.imageProperties.contentUri, alt, widthPt, heightPt, ctx);
        if (result) {
          const dimStyle = result.height > 0
            ? `height:${result.height}px;width:${result.width}px;`
            : `height:auto;width:${result.width}px;`;
          cells += `<td align="center" valign="top" style="padding:5px;"><img src="${result.token}" alt="${escapeHtml(alt)}" width="${result.width}" height="${result.height || 'auto'}" style="display:block;padding:0;max-width:100%;height:auto;" /></td>`;
        }
      }
    }
    if (cells) {
      return `<table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation" style="border-collapse:collapse;"><tr>${cells}</tr></table>`;
    }
  }

  // Positioned images (before the paragraph)
  let imgBuffer = '';
  if (p.positionedObjectIds) {
    for (const id of p.positionedObjectIds) {
      const posObj = ctx.positionedObjects?.[id];
      const embedded = posObj?.positionedObjectProperties?.embeddedObject;
      if (embedded?.imageProperties?.contentUri) {
        const widthPt = embedded.imageProperties.size?.width?.magnitude || 400;
        const heightPt = embedded.imageProperties.size?.height?.magnitude || 0;
        const alt = embedded.title || embedded.description || 'Image';
        const result = await registerImage(embedded.imageProperties.contentUri, alt, widthPt, heightPt, ctx);
        if (result) {
          const dimStyle = result.height > 0
            ? `height:${result.height}px;width:${result.width}px;`
            : `height:auto;width:${result.width}px;`;
          imgBuffer += `<table width="${result.width}" cellspacing="0" cellpadding="0" role="presentation" style="float:left;margin:0 15px 10px 0;border:0;"><tr><td><img src="${result.token}" alt="${escapeHtml(alt)}" height="${result.height || 'auto'}" width="${result.width}" style="display:block;padding:0;${dimStyle}" /></td></tr></table>`;
        }
      }
    }
  }

  const isHeading = namedStyle.startsWith('HEADING_');
  const tagMap: Record<string, string> = { HEADING_1: 'h1', HEADING_2: 'h2', HEADING_3: 'h3' };
  const tag = tagMap[namedStyle] || 'p';

  const css: string[] = [];
  if (alignment === 'CENTER') css.push('text-align:center');
  if (alignment === 'END') css.push('text-align:right');

  // Indent for normal text
  if (!isHeading && style?.indentStart?.magnitude) {
    css.push(`padding-left:${Math.round(style.indentStart.magnitude)}pt`);
  }

  // Heading color/font from first text run
  if (isHeading) {
    const firstText = elements.find(e => e.textRun)?.textRun;
    const color = getColor(firstText?.textStyle?.foregroundColor);
    const font = firstText?.textStyle?.weightedFontFamily?.fontFamily;
    if (color) css.push(`color:${color}`);
    if (font && ALLOWED_FONTS.has(font)) css.push(`font-family:${font},sans-serif`);
  }

  const styleAttr = css.length > 0 ? ` style="${css.join(';')}"` : '';
  const inner = await processTextContent(elements, isHeading, ctx);

  return `${imgBuffer}<${tag}${styleAttr}>${inner}</${tag}>`;
}

// ─── List item ────────────────────────────────────────────────────────────────

async function processListItem(p: Paragraph, ctx: ScanContext): Promise<string> {
  const list = ctx.lists[p.bullet!.listId];
  const level = p.bullet!.nestingLevel || 0;
  const nestingLevel = list?.listProperties?.nestingLevels?.[level];
  const glyphType = nestingLevel?.glyphType || nestingLevel?.glyphFormat || '';
  const isOrdered = /DECIMAL|ALPHA|ROMAN|\d/.test(glyphType);
  const tag = isOrdered ? 'ol' : 'ul';
  const inner = await processTextContent(p.elements || [], false, ctx);
  return `<${tag}><li style="margin-bottom:10px;">${inner}</li></${tag}>`;
}

// ─── Table ────────────────────────────────────────────────────────────────────

function borderStyle(cell: TableCellStyle | undefined, side: 'borderLeft' | 'borderRight' | 'borderTop' | 'borderBottom'): string {
  const b = cell?.[side];
  const w = b?.width?.magnitude || 0;
  const c = getColor(b?.color);
  if (w > 0 || c) {
    const finalW = w > 0 ? w : 1;
    const finalC = c || '#000000';
    const css = side.replace('border', 'border-').toLowerCase();
    return `${css}:${finalW}pt solid ${finalC}`;
  }
  return '';
}

async function processTableCell(cell: TableCell, ctx: ScanContext): Promise<string> {
  const s = cell.tableCellStyle;
  const styles: string[] = [];

  const bg = getColor(s?.backgroundColor);
  if (bg && bg !== '#ffffff') styles.push(`background-color:${bg}`);

  for (const side of ['borderLeft', 'borderRight', 'borderTop', 'borderBottom'] as const) {
    const b = borderStyle(s, side);
    if (b) styles.push(b);
  }

  const styleAttr = styles.length ? ` style="${styles.join(';')}"` : '';
  let inner = '';
  for (const se of cell.content || []) {
    if (se.paragraph) {
      if (se.paragraph.bullet) {
        inner += await processListItem(se.paragraph, ctx);
      } else {
        inner += await processParagraph(se.paragraph, ctx);
      }
    }
  }
  return `<td valign="top"${styleAttr}>${inner}</td>`;
}

async function processTable(table: Table, ctx: ScanContext): Promise<string> {
  let sb = '<table width="100%" border="0" cellpadding="5" cellspacing="0" role="presentation" style="border-collapse:collapse;margin-bottom:15px;">';
  for (const row of table.tableRows || []) {
    sb += '<tr>';
    for (const cell of row.tableCells || []) {
      sb += await processTableCell(cell, ctx);
    }
    sb += '</tr>';
  }
  sb += '</table>';
  return sb;
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export function extractDocIdFromUrl(url: string): string {
  return extractDocId(url);
}

export async function extractDocContent(docIdOrUrl: string, accessToken: string, tabId?: string): Promise<ScanResult> {
  const docId = docIdOrUrl.startsWith('http') ? extractDocId(docIdOrUrl) : docIdOrUrl;

  const url = `https://docs.googleapis.com/v1/documents/${docId}${tabId ? '?includeTabsContent=true' : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Impossible d'accéder au document (${res.status}): ${err.substring(0, 200)}`);
  }

  const doc: DocsDocument = await res.json();

  // Resolve content source: specific tab or root body
  let content: TabDocumentContent;
  if (tabId && doc.tabs?.length) {
    const allTabs = flattenTabs(doc.tabs);
    const tab = allTabs.find(t => t.tabProperties.tabId === tabId);
    if (!tab?.documentTab) throw new Error(`Onglet "${tabId}" introuvable dans le document.`);
    content = tab.documentTab;
  } else {
    content = { body: doc.body, inlineObjects: doc.inlineObjects, positionedObjects: doc.positionedObjects, lists: doc.lists, footnotes: doc.footnotes };
  }

  const ctx: ScanContext = {
    images: {},
    footnotesData: [],
    ctaCounter: 1,
    inlineObjects: content.inlineObjects || {},
    positionedObjects: content.positionedObjects || {},
    lists: content.lists || {},
    footnotes: content.footnotes || {},
    accessToken,
    docId,
  };

  const sb: string[] = [];

  for (const se of content.body.content || []) {
    try {
      if (se.paragraph) {
        if (se.paragraph.bullet) {
          sb.push(await processListItem(se.paragraph, ctx));
        } else {
          sb.push(await processParagraph(se.paragraph, ctx));
        }
      } else if (se.table) {
        sb.push(await processTable(se.table, ctx));
      }
    } catch (e) {
      console.error('Scan element error:', e);
    }
  }

  if (ctx.footnotesData.length > 0) {
    sb.push('<br><hr style="border:0;border-top:1px solid #eee;margin:20px 0;"><p style="font-size:12px;color:#666;"><b>Sources :</b></p>');
    ctx.footnotesData.forEach((fn, i) => {
      sb.push(`<p style="font-size:11px;color:#999;margin:0 0 5px 0;">[${i + 1}] ${fn}</p>`);
    });
  }

  return {
    htmlRaw: sb.filter(Boolean).join('\n'),
    images: ctx.images,
  };
}

function flattenTabs(tabs: DocTabRaw[]): DocTabRaw[] {
  const result: DocTabRaw[] = [];
  for (const tab of tabs) {
    result.push(tab);
    if (tab.childTabs?.length) result.push(...flattenTabs(tab.childTabs));
  }
  return result;
}

export async function fetchDocTabs(docIdOrUrl: string, accessToken: string): Promise<import('./types').DocTab[]> {
  const docId = docIdOrUrl.startsWith('http') ? extractDocId(docIdOrUrl) : docIdOrUrl;
  // includeTabsContent=true is required to populate the tabs array in the response.
  // The fields filter keeps the response small (tab metadata only, no content).
  const fields = encodeURIComponent('tabs(tabProperties,childTabs(tabProperties,childTabs(tabProperties)))');
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${docId}?includeTabsContent=true&fields=${fields}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return [];
  const doc = await res.json();
  if (!doc.tabs?.length) return [];
  return flattenTabs(doc.tabs).map((t: DocTabRaw) => ({
    tabId: t.tabProperties.tabId,
    title: t.tabProperties.title || `Onglet ${t.tabProperties.index + 1}`,
    index: t.tabProperties.index,
  }));
}
