import { describe, expect, it, vi } from 'vitest';
import { TOOL_CATALOG } from '../../../mcp/tool-catalog.mjs';

vi.mock('@/lib/fal/models', () => ({
  ALL_MODELS: {},
  getModelDefinition: () => undefined,
  getAllModelNodeTypes: () => [],
  getModelsByProvider: () => [],
  installTopviewModelCatalog: () => {},
}));
vi.mock('@/lib/workflows/provider-model-options', () => ({
  modelProviderLabel: () => '',
  providerModelOptions: () => [],
}));

import { createMcpHandlers } from '@/lib/mcp/handlers';
import { createEmptyDirectorShow } from '@/lib/director/create-show';

const handlerNames = Object.keys(createMcpHandlers({
  getState: () => ({
    nodes: [], edges: [], spaces: [], activeSpaceId: '', elements: [],
    assets: [], timelines: [], activeTimelineId: '', director: createEmptyDirectorShow(),
  }),
  dispatch: () => {},
  runNode: () => {},
})).sort();

describe('MCP tool catalogue', () => {
  it('advertises exactly the tools the app implements', () => {
    // The catalogue is what the MCP server hands to the model; a name in one and
    // not the other is a tool that fails only once someone calls it.
    expect(TOOL_CATALOG.map((tool) => tool.name).sort()).toEqual(handlerNames);
  });

  it('gives every tool a description and an object schema', () => {
    for (const tool of TOOL_CATALOG) {
      expect(tool.name, `${tool.name} name`).toMatch(/^cinegen_[a-z_]+$/);
      expect(tool.description.length, `${tool.name} description`).toBeGreaterThan(40);
      expect(tool.inputSchema.type, `${tool.name} schema`).toBe('object');
      expect(tool.inputSchema).toHaveProperty('properties');
    }
  });

  it('marks the arguments a tool cannot work without', () => {
    const required = (name: string) => {
      const schema = TOOL_CATALOG.find((tool) => tool.name === name)?.inputSchema as { required?: string[] };
      return schema?.required ?? [];
    };
    expect(required('cinegen_generate')).toEqual(['prompt']);
    expect(required('cinegen_load_script')).toEqual(['text']);
    expect(required('cinegen_set_shotlist')).toEqual(['shotlist']);
    expect(required('cinegen_create_element')).toEqual(['name']);
    expect(required('cinegen_get_context')).toEqual([]);
  });
});
