import type { ScriptScene } from './scene-split';
import type { ScreenplayElement } from './screenplay';

export interface SceneScriptItem {
  id: string;
  element: ScreenplayElement;
  scene: ScriptScene;
  sceneIndex: number;
}

export function sceneScriptItems(scenes: ScriptScene[], filter: 'all' | number): SceneScriptItem[] {
  const visibleScenes = filter === 'all'
    ? scenes
    : scenes.filter((scene) => scene.index === filter);

  return visibleScenes.flatMap((scene) => scene.elements.map((element) => ({
    // Prefixing with the scene index keeps pagination measurements stable even
    // when an imported screenplay contains repeated source element IDs.
    id: `${scene.index}:${element.id}`,
    element,
    scene,
    sceneIndex: scene.index,
  })));
}
