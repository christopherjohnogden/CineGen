import { PromptNode } from './prompt-node';
import { AssetOutputNode } from './asset-output-node';
import { ShotPromptNode } from './shot-prompt-node';
import { CompositionPlanNode } from './composition-plan-node';
import { MusicPromptNode } from './music-prompt-node';
import { ElementNode } from './element-node';
import { FilePickerNode } from './file-picker-node';
import { ShotBoardNode } from './shot-board-node';
import { StoryboarderNode } from './storyboarder-node';
import { GroupNode } from './group-node';
import { ModelNode } from './model-node';
import { getAllModelNodeTypes } from '@/lib/fal/models';

const modelEntries = getAllModelNodeTypes().reduce<Record<string, typeof ModelNode>>(
  (acc, nodeType) => {
    acc[nodeType] = ModelNode;
    return acc;
  },
  {},
);

export const nodeTypes: Record<string, React.ComponentType<any>> = {
  group: GroupNode,
  prompt: PromptNode,
  assetOutput: AssetOutputNode,
  shotPrompt: ShotPromptNode,
  compositionPlan: CompositionPlanNode,
  musicPrompt: MusicPromptNode,
  element: ElementNode,
  filePicker: FilePickerNode,
  shotBoard: ShotBoardNode,
  storyboarder: StoryboarderNode,
  ...modelEntries,
};

export { BaseNode } from './base-node';
