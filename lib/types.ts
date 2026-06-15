export interface ProcessConfig {
  docUrl: string;
  assetName?: string;
  assetId?: string;
  templateId?: string;
  tabId?: string;
}

export interface DocTab {
  tabId: string;
  title: string;
  index: number;
}

export interface ProcessResult {
  success: boolean;
  assetId?: number;
  assetName?: string;
  previewHtml?: string;
  error?: string;
}

export interface ProgressEvent {
  type: 'log' | 'result' | 'error';
  message?: string;
  progress?: number;
  data?: ProcessResult;
}

export interface ImageData {
  base64: string;
  name: string;
  mimeType: string;
  hash: string;
}

export type ImageMap = Record<string, ImageData>;

export interface ScanResult {
  htmlRaw: string;
  images: ImageMap;
}

export interface SfmcTemplate {
  id: number;
  name: string;
}

export interface SfmcTemplateInfo {
  globalStyles: Record<string, Record<string, string>> | null;
  slots: string[];
  slotName: string;
}
