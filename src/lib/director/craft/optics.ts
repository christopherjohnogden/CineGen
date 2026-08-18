/**
 * Lens control distilled from CINEDANCE V4 (references/optics.md).
 *
 * Seedance responds to observable optical outcomes, not to camera metadata, so
 * millimetres and f-stops are deliberately absent from everything here.
 */

/** The only diagonal fields of view the shotlist job is allowed to choose from. */
export const FOV_ANCHORS = [8, 18, 29, 47, 84, 107] as const;

export type FovAnchor = (typeof FOV_ANCHORS)[number];

const FOV_BLOCKS: Record<FovAnchor, string> = {
  8: '8° diagonal field of view, super-telephoto observation lens character, camera 20 to 25 meters from subject. Extreme background compression, background flattened into a soft colour wash, only the subject is sharp. Foreground occlusion is mandatory: blurred foreground objects occupy the lower 30 to 45 percent of frame as oversized dark bokeh shapes.',
  18: '18° diagonal field of view, classic telephoto lens character, camera 6 to 8 meters from subject. Strong background compression, distant elements stacked closer behind the subject, razor-thin focus isolating the eyes, foreground and background melting into soft bokeh, the image feels observed from a distance.',
  29: '29° diagonal field of view, short telephoto portrait lens character, camera 4 to 6 meters from subject. Close framing achieved through lens reach, not physical proximity. Subject razor-sharp, background compressed and dissolved into creamy bokeh, face proportions flattering and stable.',
  47: '47° diagonal field of view, standard normal lens character, camera 3 to 5 meters from subject, natural human-eye perspective. Zero obvious distortion, natural face and body proportions, comfortable depth of field, background readable but not exaggerated.',
  84: '84° diagonal field of view, classic wide-angle lens character, camera 1 to 1.5 meters from subject. Strong but natural perspective expansion, foreground body presence larger and closer, environment visible to the frame edges, straight architectural lines stay rectilinear, no fisheye curve.',
  107: '107° diagonal field of view, wide rectilinear lens character, camera 0.5 to 0.8 meters from foreground subject. Immediate foreground looms large, environment spreads wide to all frame edges, deep edge-to-edge focus, straight lines remain straight, no circular vignette, no fisheye bubble.',
};

export function isFovAnchor(value: number): value is FovAnchor {
  return (FOV_ANCHORS as readonly number[]).includes(value);
}

/** The written lens character for one of the six anchors. */
export function fovBlock(fov: FovAnchor): string {
  return FOV_BLOCKS[fov];
}

/** Snap an arbitrary FOV to the nearest anchor so drift-prone values never ship. */
export function nearestFovAnchor(value: number): FovAnchor {
  return FOV_ANCHORS.reduce((best, anchor) => (
    Math.abs(anchor - value) < Math.abs(best - value) ? anchor : best
  ), FOV_ANCHORS[0]);
}

/**
 * The anti-drift lock for a chosen FOV. Telephoto and wide drift toward a
 * comfortable normal lens unless the wrong outcome is named next to the right one.
 */
export function opticsAntiDriftLock(fov: FovAnchor): string {
  if (fov <= 29) {
    return 'No part of this shot becomes wide-angle or normal-lens coverage. Wider framing comes from the camera moving farther away with the same long-lens reach, never from switching lenses. The background stays compressed and dissolved in every frame.';
  }
  if (fov >= 84) {
    return 'No part of this shot becomes telephoto portrait coverage. The environment stays visible around the subject, the camera stays physically close, and the image keeps its wide-angle spatial expansion with deep readable context.';
  }
  return 'No extreme wide distortion and no telephoto compression. The image stays natural, grounded and human-eye neutral.';
}

/** Compile a ready OPTICS block for a clip. */
export function opticsBlock(fov: FovAnchor): string {
  return `${fovBlock(fov)} ${opticsAntiDriftLock(fov)}`;
}

/** Doctrine handed to the shotlist job so it picks a lens by content type. */
export const OPTICS_DOCTRINE = `OPTICS — the video model reads observable lens results, never camera metadata. Do not use millimetres, f-stops, ISO or lens brand names as the primary control. Choose one diagonal field of view per shot from this bank and write its visible outcome:
- 8° super-telephoto observation — distant hidden watching, paparazzi, surveillance. Foreground occlusion mandatory.
- 18° classic telephoto — tight emotional close-up, observed from a distance.
- 29° short telephoto portrait — medium portrait, close framing through lens reach rather than proximity.
- 47° standard normal — natural documentary action, human-eye perspective.
- 84° classic wide — wide environmental action, foreground body presence, environment to the frame edges.
- 107° wide rectilinear — large-scale geography and immersion, immediate foreground looming.
Match the lens to the content: portrait, isolation and observation go telephoto; environmental, spatial and immersive action go wide; a detail insert gets its own beat and its own lens. Never mix a face portrait, environmental geography and macro detail inside one beat — that is what causes lens drift. On a multi-shot clip give each shot its own field of view and cut hard between them; inside a shot the field of view never changes.`;
