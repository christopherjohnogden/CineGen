import type { PortType } from '@/types/workflow';

const SPECIFIC_MEDIA_PORTS = new Set<PortType>(['image', 'video', 'audio']);

export function areWorkflowPortsCompatible(sourceType: PortType, targetType: PortType): boolean {
  if (sourceType === targetType) return true;
  if (targetType === 'media' && SPECIFIC_MEDIA_PORTS.has(sourceType)) return true;
  if (sourceType === 'media' && SPECIFIC_MEDIA_PORTS.has(targetType)) return true;
  return false;
}
