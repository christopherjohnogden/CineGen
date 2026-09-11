/** Small, labeled snapshots shared by the assistant's vision transports. */
export interface LlmImageAttachment {
  label: string;
  dataUrl: string;
}

export const MAX_ASSISTANT_IMAGES = 18;
export const MAX_ASSISTANT_IMAGE_BYTES = 24 * 1024 * 1024;
