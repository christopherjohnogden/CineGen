import { beforeEach, describe, expect, it } from 'vitest';
import { readLastSet, readViewerSession, viewerSessionKey, writeLastSet, writeViewerSession, type ViewerSession } from '@/lib/sets/viewer-session';
import { DEFAULT_SCAN_TUNING } from '@/lib/sets/scene';
import { FULL_FRAME } from '@/lib/sets/optics';

beforeEach(() => localStorage.clear());
describe('Set working view', () => {
  it('restores the full camera, lens and editing state independently of the saved starting view', () => {
    const session: ViewerSession = { camera: {position:[2,3,4],target:[1,2,0],up:[.3,.9,0],verticalFov:38}, focalMm:50,
      sensor:FULL_FRAME,navMode:'pan',tuning:DEFAULT_SCAN_TUNING,placementMode:'standin',selectedStandIn:'actor',
      floorGizmoMode:'tilt',standInGizmoMode:'size',openSections:['Lens','Stand-ins'],panelScroll:182 };
    const key=viewerSessionKey('project','room');
    writeViewerSession(key,session); writeLastSet('project','room');
    expect(readViewerSession(key)).toEqual(session);
    expect(readLastSet('project')).toBe('room');
    expect(readViewerSession(viewerSessionKey('other','room'))).toBeUndefined();
    expect(readLastSet('other')).toBeNull();
    writeLastSet('project',null); expect(readLastSet('project')).toBeNull();
    expect(readViewerSession(key)).toEqual(session);
  });
  it('ignores broken cached cameras', () => {
    const key=viewerSessionKey('p','s');
    for(const value of ['invalid', '{}', JSON.stringify({camera:{position:[1,null,3]}})]) {
      localStorage.setItem(key,value);expect(readViewerSession(key)).toBeUndefined();
    }
  });
});
