// Only the type nod's audio player takes from its attachment-images module.
export interface ImagePreview {
  id: string;
  url: string;
  name: string;
  size: number;
  mimeType?: string;
  downloadUrl?: string;
}
