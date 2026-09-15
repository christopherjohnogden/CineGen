import { FOV_ANCHORS, fovBlock, nearestFovAnchor, opticsAntiDriftLock, type FovAnchor } from '@/lib/director/craft/optics';
import { FULL_FRAME, diagonalFov, framePosition, heightDescriptor, shotSize, verticalFov, type SensorSize } from './optics';
import type { StandIn } from './scene';

/**
 * The camera block Shape Shot appends to a generation prompt.
 *
 * The viewer's controls are millimetres and sensor sizes, but this repo's
 * OPTICS_DOCTRINE is explicit that the model reads observable lens results and
 * that millimetres must not be the control. So the lens is translated, never
 * quoted: a true diagonal FOV is computed from focal + sensor, snapped to one of
 * the doctrine's six anchors, and emitted as that anchor's written lens
 * character.
 *
 * One conflict has to be resolved deliberately. Each anchor's block asserts its
 * own camera-to-subject range ("camera 3 to 5 meters from subject") because the
 * shotlist job has no real geometry. Here there IS real geometry, and the two
 * can disagree — a 50mm at 12m is still a 47° lens but is nowhere near the 3-5m
 * the block claims. The measured distance wins, stated explicitly after the
 * lens character so it reads as the correction rather than a contradiction.
 */

export interface CameraPromptInput {
  focalMm: number;
  sensor?: SensorSize;
  /** Metres. */
  cameraHeightM: number;
  /** Metres from camera to the subject it was framed on. */
  subjectDistanceM?: number;
  /** 0..1 across the frame. */
  subjectFrameX?: number;
  subject?: StandIn;
  /** Which way the subject faces relative to camera. */
  subjectFacing?: 'toward camera' | 'away from camera' | 'in profile' | 'three-quarters toward camera';
}

export interface CameraPrompt {
  block: string;
  fovAnchor: FovAnchor;
  shotSize: string;
  measuredDistanceM?: number;
}

/** Required by the brief: without it, models render the mannequin. */
export const MANNEQUIN_EXCLUSION =
  'The gray mannequin in @image2 and @image4 is a placement guide only and must not appear in the shot.';

const ENVIRONMENT_LOCK =
  'Environment exactly as shown in @image1, with no added buildings, signage, or objects.';

function roundMetres(value: number): string {
  return value >= 10 ? `${Math.round(value)}` : `${Math.round(value * 10) / 10}`;
}

/**
 * Drop the anchor block's own distance claim.
 *
 * Every FOV_BLOCKS entry embeds a ", camera N to M meters from subject" clause.
 * When a real measurement exists that clause is the one thing in the block that
 * can be wrong, so it is removed rather than left to argue with the measurement.
 */
function stripAssertedDistance(block: string): string {
  return block.replace(/,?\s*camera\s+[\d.]+\s+to\s+[\d.]+\s+meters?\s+from\s+(?:the\s+)?(?:foreground\s+)?subject/i, '');
}

export function buildCameraPrompt(input: CameraPromptInput): CameraPrompt {
  const sensor = input.sensor ?? FULL_FRAME;
  const trueFov = diagonalFov(input.focalMm, sensor);
  const anchor = nearestFovAnchor(trueFov);

  const subjectHeight = input.subject?.heightM ?? 1.8;
  const distance = input.subjectDistanceM;
  const size = distance !== undefined
    ? shotSize(subjectHeight, distance, verticalFov(input.focalMm, sensor))
    : undefined;

  const lensCharacter = distance !== undefined ? stripAssertedDistance(fovBlock(anchor)) : fovBlock(anchor);

  const sentences: string[] = [lensCharacter];

  const framing: string[] = [];
  if (size) framing.push(`Framed as a ${size}`);
  if (input.subjectFrameX !== undefined) framing.push(`subject ${framePosition(input.subjectFrameX)}`);
  if (input.subjectFacing) framing.push(`facing ${input.subjectFacing}`);
  if (distance !== undefined) framing.push(`about ${roundMetres(distance)} metres from camera`);
  if (framing.length) sentences.push(`${framing.join(', ')}.`);

  sentences.push(`${capitalise(heightDescriptor(input.cameraHeightM, subjectHeight))}.`);
  sentences.push(opticsAntiDriftLock(anchor));
  sentences.push(ENVIRONMENT_LOCK);
  sentences.push(MANNEQUIN_EXCLUSION);

  return {
    block: sentences.join(' ').replace(/\s+/g, ' ').trim(),
    fovAnchor: anchor,
    shotSize: size ?? '',
    ...(distance !== undefined ? { measuredDistanceM: distance } : {}),
  };
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The per-slot tags the brief fixes, in reference order. */
export const REFERENCE_TAGS: Record<string, string> = {
  plate: '@image1 is the background environment. Match its layout, architecture, and set dressing exactly.',
  composite: '@image2 shows the exact camera framing and subject placement.',
  depth: '@image3 is a depth map for spatial layout and subject distance.',
  standin: '@image4 shows character position, scale, and pose in frame.',
};

export { FOV_ANCHORS };
