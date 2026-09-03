/**
 * The CineGen MCP tool catalogue.
 *
 * One source of truth, in plain JavaScript so three consumers can read it
 * without a build step: the stdio server (`cinegen-mcp.mjs`), the app's handler
 * map, and the test that asserts the two agree.
 *
 * Tools are deliberately deterministic app operations. The thinking — writing a
 * breakdown, inventing a shot list, choosing a prompt — belongs to the model on
 * the other end of the connection, which is already a good writer. Asking the
 * app to call its own LLM for that would spend credits to do worse.
 */

/** @typedef {{ name: string, description: string, inputSchema: Record<string, unknown> }} McpTool */

const string = (description) => ({ type: 'string', description });
const optionalString = string;

/** @type {McpTool[]} */
export const TOOL_CATALOG = [
  {
    name: 'cinegen_get_context',
    description:
      'Read the open CineGen project: its Spaces, Elements (characters, locations, props), timelines, recent generations, and the Director script state. Call this first — every other tool takes names or ids from here.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'cinegen_list_models',
    description:
      'List the generation models available for a kind of output, with the provider and what each one accepts (duration, references, frames). Use it before cinegen_generate when the user names a look or a model.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['video', 'image'], description: 'Which kind of model to list. Defaults to video.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'cinegen_generate',
    description:
      'Generate one or more images or videos in the open project. Each version becomes its own clip in the Space feed, exactly as if it had been started from the Studio. Returns immediately with node ids; poll cinegen_get_generations for the results.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: string('What to generate. Write it as a shot description: subject, action, camera, lighting, mood.'),
        kind: { type: 'string', enum: ['video', 'image'], description: 'Defaults to video.' },
        model: optionalString('Model name or node type, e.g. "Seedance 2.5". Defaults to the project default for the kind.'),
        elements: {
          type: 'array',
          items: { type: 'string' },
          description: 'Element names to use as references, e.g. ["Hazmat", "Dr-Jordan"]. They must already exist; check cinegen_get_context.',
        },
        count: { type: 'integer', minimum: 1, maximum: 4, description: 'How many versions to make at once. Defaults to 1.' },
        durationSec: { type: 'integer', description: 'Video length in seconds. Ignored by models with a fixed length.' },
        aspectRatio: optionalString('e.g. "16:9", "9:16".'),
        resolution: optionalString('e.g. "720p", "1080p".'),
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'cinegen_get_generations',
    description:
      'The most recent generations with their status and media URL. Use it to report progress, or to check whether the clips a previous call started have finished.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many to return, newest first. Defaults to 10.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'cinegen_create_space',
    description:
      'Create a new Space (a canvas of connected nodes) from a template, optionally pre-filled with a list of shot prompts. Use this to lay out a sequence the user can then run shot by shot.',
    inputSchema: {
      type: 'object',
      properties: {
        name: string('The Space name, e.g. "Opening sequence".'),
        template: {
          type: 'string',
          enum: ['storyboard', 'storyboard-images', 'shot-ideas', 'multi-shot', 'b-roll', 'video-from-shot-list'],
          description: 'Which layout to build. Defaults to multi-shot.',
        },
        prompts: {
          type: 'array',
          items: { type: 'string' },
          description: 'One prompt per shot. Each becomes a node wired to a model.',
        },
        elements: { type: 'array', items: { type: 'string' }, description: 'Element names to attach as references.' },
        scene: optionalString('A short scene description shown on the Space.'),
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'cinegen_create_element',
    description:
      'Create an Element — a character, location, prop or vehicle that generations can reference by name to keep it consistent across shots.',
    inputSchema: {
      type: 'object',
      properties: {
        name: string('e.g. "Dr Jordan".'),
        type: { type: 'string', enum: ['character', 'location', 'prop', 'vehicle'], description: 'Defaults to character.' },
        description: optionalString('What it looks like. This is what a model reads when the Element is used as a reference.'),
        imageUrl: optionalString('An https image URL to attach as its first reference image.'),
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'cinegen_load_script',
    description:
      'Load a screenplay or treatment into Director and return the deterministic first pass: the scenes it split, and the characters, locations, props and vehicles it found. Read the result, then send a better breakdown back with cinegen_set_breakdown and a shot list with cinegen_set_shotlist.',
    inputSchema: {
      type: 'object',
      properties: {
        text: string('The full script text.'),
        title: optionalString('A title for the show.'),
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'cinegen_set_breakdown',
    description:
      'Replace or extend the Director breakdown with your own reading of the script. Items you send are merged by name over what the deterministic pass found.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'The breakdown items.',
          items: {
            type: 'object',
            properties: {
              name: string('e.g. "DR JORDAN".'),
              kind: { type: 'string', enum: ['character', 'location', 'prop', 'vehicle'] },
              description: optionalString('Appearance, wardrobe, condition — what a model needs to draw it.'),
            },
            required: ['name', 'kind'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  {
    name: 'cinegen_set_shotlist',
    description:
      'Import a shot list you wrote into Director. Send the CineGen shotlist JSON: an object with a "scenes" array, each scene holding "clips", each clip holding numbered "beats". Existing clips for the scenes you cover are replaced.',
    inputSchema: {
      type: 'object',
      properties: {
        shotlist: string('The shot list as a raw JSON string.'),
      },
      required: ['shotlist'],
      additionalProperties: false,
    },
  },
  {
    name: 'cinegen_generate_shots',
    description:
      'Generate video for shots already in the Director shot list. Each clip is compiled into its full prompt — style, camera, acting, references — and sent as its own generation, so the results land in the Space feed.',
    inputSchema: {
      type: 'object',
      properties: {
        clipIds: { type: 'array', items: { type: 'string' }, description: 'Which clips to generate. Defaults to every clip without a take.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Cap how many are started at once. Defaults to 4.' },
        model: optionalString('Model name to use. Defaults to the project default video model.'),
      },
      additionalProperties: false,
    },
  },
];

/** @type {Set<string>} */
export const TOOL_NAMES = new Set(TOOL_CATALOG.map((tool) => tool.name));
