import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import {
  createCutWorkflowHandlers,
  cutWorkflowCapabilities,
} from './cut-workflow.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => (
    fsp.rm(directory, { recursive: true, force: true })
  )));
});

function insightIndex(projectId = 'project_1') {
  return {
    projectId,
    activeTimelineId: 'timeline_1',
    builtAt: '2026-08-17T00:00:00.000Z',
    stats: {
      assetCount: 99,
      transcriptReadyCount: 99,
      wordTimestampReadyCount: 99,
      videoCount: 99,
      audioCount: 0,
      visualSummaryReadyCount: 0,
    },
    moments: [
      {
        id: 'asset_1:moment-1',
        assetId: 'asset_1',
        assetName: 'Untrusted client name',
        text: 'The founder explains the turning point and why the team kept going.',
        sourceStart: 3,
        sourceEnd: 11,
        words: [
          { word: 'turning', start: 5, end: 5.4 },
          { word: 'point', start: 5.5, end: 5.9 },
        ],
        timelinePlacements: [{
          timelineId: 'timeline_1',
          timelineName: 'Untrusted timeline name',
          clipId: 'clip_1',
          clipName: 'Interview clip',
          timelineTime: 12,
          clipStartTime: 10,
        }],
        emotion: 'hopeful',
      },
      {
        id: 'asset_2:moment-1',
        assetId: 'asset_2',
        assetName: 'B-roll',
        text: 'A concise product reveal lands after the founder story.',
        sourceStart: 1,
        sourceEnd: 6,
        words: [],
        timelinePlacements: [],
      },
    ],
    referenceTimelines: [{
      timelineId: 'timeline_1',
      timelineName: 'Untrusted timeline name',
      duration: 45,
      clipCount: 2,
      primaryAssets: ['Founder Interview', 'Unknown asset'],
      structureSummary: 'A cold open followed by setup and reveal.',
      isActive: true,
    }],
    visualInputs: [],
    storyShape: {},
    relationMap: {},
  };
}

async function createFixture(overrides = {}) {
  const dataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'cinegen-cut-workflow-test-'));
  roots.push(dataRoot);
  const mediaRoot = path.join(dataRoot, 'media');
  const projectId = 'project_1';
  const framePath = path.join(mediaRoot, 'projects', projectId, 'imported', 'asset_1', 'frame.jpg');
  await fsp.mkdir(path.dirname(framePath), { recursive: true });
  await fsp.writeFile(framePath, 'frame');
  const state = {
    project: { id: projectId, name: 'Launch Film' },
    assets: [
      { id: 'asset_1', project_id: projectId, name: 'Founder Interview', type: 'video', duration: 20 },
      { id: 'asset_2', project_id: projectId, name: 'Product Reveal', type: 'video', duration: 8 },
    ],
    timelines: [{ id: 'timeline_1', name: 'Launch Assembly' }],
  };
  const providerCalls = [];
  const stagedCalls = [];
  const context = {
    dataRoot,
    store: {
      async load(id) {
        if (id !== projectId) throw new Error(`Project not found: ${id}`);
        return state;
      },
    },
    pathForMediaReference(reference) {
      let pathname = reference;
      if (/^https?:\/\//i.test(reference)) pathname = new URL(reference).pathname;
      pathname = decodeURIComponent(pathname);
      if (!pathname.startsWith('/media/')) throw new Error('Only web media references are accepted');
      return path.resolve(mediaRoot, pathname.slice('/media/'.length));
    },
    async stageMedia(source, apiKey, label) {
      stagedCalls.push({ source, apiKey, label });
      return `https://fal.media/${encodeURIComponent(path.basename(source))}`;
    },
    async falSubscribe(endpoint, input, apiKey) {
      providerCalls.push({ endpoint, input, apiKey });
      throw new Error('No provider response was configured for this test.');
    },
    ...overrides,
  };
  return {
    context,
    dataRoot,
    mediaRoot,
    projectId,
    framePath,
    state,
    providerCalls,
    stagedCalls,
    handlers: createCutWorkflowHandlers(context),
  };
}

test('validates request-scoped credentials and project/index ownership before provider work', async () => {
  const fixture = await createFixture();
  await assert.rejects(
    fixture.handlers.runCutWorkflow({
      request: 'Build a short cut',
      projectId: fixture.projectId,
      activeTimelineId: 'timeline_1',
      index: insightIndex(),
    }),
    (error) => error.code === 'INVALID_INPUT' && /fal\.ai API key/.test(error.message),
  );
  await assert.rejects(
    fixture.handlers.runCutWorkflow({
      apiKey: 'request-secret',
      request: 'Build a short cut',
      projectId: fixture.projectId,
      activeTimelineId: 'timeline_1',
      index: insightIndex('project_2'),
    }),
    (error) => error.code === 'PROJECT_MISMATCH' && error.statusCode === 403,
  );
  const unknownAsset = insightIndex();
  unknownAsset.moments[0].assetId = 'asset_from_another_project';
  await assert.rejects(
    fixture.handlers.runCutWorkflow({
      apiKey: 'request-secret',
      request: 'Build a short cut',
      projectId: fixture.projectId,
      activeTimelineId: 'timeline_1',
      index: unknownAsset,
    }),
    (error) => error.code === 'PROJECT_MISMATCH' && /asset outside/.test(error.message),
  );
  assert.equal(fixture.providerCalls.length, 0);
  assert.equal(cutWorkflowCapabilities.retrieval, 'deterministic-project-index');
  assert.equal(cutWorkflowCapabilities.arbitraryFilesystemMedia, false);
});

test('maps brief inference to OpenRouter and normalizes the renderer brief-stage response', async () => {
  const fixture = await createFixture({
    async falSubscribe(endpoint, input, apiKey) {
      fixture.providerCalls.push({ endpoint, input, apiKey });
      return {
        data: {
          output: `Brief follows:\n\`\`\`json\n${JSON.stringify({
            pieceType: 'brand story',
            deliverable: '60-second launch film',
            audience: 'new customers',
            tone: 'hopeful',
            pacing: 'measured then energetic',
            targetDurationSeconds: 60,
            variantCount: 1,
            persona: 'brand-storyteller',
            storyGoal: 'Connect the founder turning point to the reveal.',
            hook: 'Open on the turning point.',
            formatNotes: 'Keep the founder in their own words.',
            qualityGoal: 'story',
            referenceTimelineId: 'timeline_1',
            referenceTimelineName: 'Spoofed name',
            useBrollPlaceholders: true,
            confidence: 1.5,
            rationale: 'The request is specific.',
            clarifyingQuestions: [{
              id: 'ending',
              question: 'Should the ending include a call to action?',
              options: [{ id: 'yes', label: 'Yes' }, { label: '' }],
            }],
          })}\n\`\`\``,
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.01 },
        },
      };
    },
  });

  const result = await fixture.handlers.runCutWorkflow({
    apiKey: 'request-secret',
    model: 'openai/gpt-5.2',
    systemPrompt: 'Favor emotional specificity.',
    request: 'Build a hopeful founder-led launch film around the turning point.',
    projectId: fixture.projectId,
    activeTimelineId: 'timeline_1',
    index: insightIndex(),
    confirmedBrief: false,
  });

  assert.equal(fixture.providerCalls.length, 1);
  const call = fixture.providerCalls[0];
  assert.equal(call.endpoint, 'openrouter/router');
  assert.equal(call.apiKey, 'request-secret');
  assert.equal(call.input.model, 'openai/gpt-5.2');
  assert.equal(call.input.max_tokens, 900);
  assert.equal(call.input.temperature, 0.35);
  assert.match(call.input.system_prompt, /Favor emotional specificity/);
  assert.match(call.input.prompt, /Assets: 2/);
  assert.doesNotMatch(call.input.prompt, /Assets: 99/);

  assert.equal(result.stage, 'brief');
  assert.equal(result.editorialBrief.variantCount, 1);
  assert.equal(result.editorialBrief.confidence, 1);
  assert.equal(result.editorialBrief.referenceTimelineName, 'Launch Assembly');
  assert.equal(result.clarifyingQuestions.length, 1);
  assert.equal(result.clarifyingQuestions[0].options.length, 1);
  assert.deepEqual(result.visualFindings, []);
  assert.deepEqual(result.variants, []);
  assert.equal(result.retrievalSummary.topMoments[0].assetName, 'Founder Interview');
  assert.equal(result.retrievalSummary.topMoments[0].timelinePlacements[0].timelineName, 'Launch Assembly');
  assert.match(result.retrievalSummary.note, /deterministic web index ranking/);
  assert.deepEqual(result.usage, { promptTokens: 10, completionTokens: 5, totalTokens: 15, cost: 0.01 });
});

test('runs hosted frame vision, normalizes generated edit citations, and ranks a confirmed variant', async () => {
  const providerCalls = [];
  const stagedCalls = [];
  const fixture = await createFixture({
    async stageMedia(source, apiKey, label) {
      stagedCalls.push({ source, apiKey, label });
      return 'https://fal.media/founder-frame.jpg';
    },
    async falSubscribe(endpoint, input, apiKey) {
      providerCalls.push({ endpoint, input, apiKey });
      if (endpoint === 'fal-ai/any-llm/vision') {
        return { data: { output: JSON.stringify({
          summary: 'A warm medium close-up of the founder in a workshop.',
          tone: ['warm', 'hopeful'],
          pacing: 'steady',
          shotTypes: ['medium close-up'],
          subjects: ['founder'],
          brollIdeas: ['hands at work'],
          confidence: 0.91,
        }) } };
      }
      if (input.prompt.includes('senior editorial strategist')) {
        return { data: { output: JSON.stringify({
          pieceType: 'brand story',
          deliverable: 'launch film',
          audience: 'customers',
          tone: 'hopeful',
          pacing: 'building',
          targetDurationSeconds: 30,
          variantCount: 3,
          persona: 'brand-storyteller',
          storyGoal: 'Tell the founder story.',
          hook: 'The turning point.',
          formatNotes: 'Use direct quotes.',
          qualityGoal: 'story',
          useBrollPlaceholders: true,
          confidence: 0.8,
          rationale: 'Grounded in transcript evidence.',
        }), usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, cost: 0.1 } } };
      }
      if (input.prompt.includes('lead editor creating one high-quality')) {
        return { data: { output: `Model preface\n${JSON.stringify({
          title: 'Turning Point',
          strategy: 'Founder-led reveal',
          summary: 'The founder carries us into the reveal.',
          rationale: 'The strongest quote motivates the product image.',
          proposals: [{
            summary: 'A tight story cut.',
            timeline_name: 'Founder Launch',
            should_create_timeline: true,
            segments: [
              {
                asset_id: 'asset_1',
                asset_name: 'Spoofed asset name',
                source_start: 3,
                source_end: 999,
                note: 'Use the turning-point quote.',
              },
              {
                asset_id: 'asset_not_owned',
                source_start: 0,
                source_end: 10,
              },
            ],
          }],
        })}\nEnd`, usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5, cost: 0.2 } } };
      }
      if (input.prompt.includes('finishing editor and quality judge')) {
        return { data: { output: JSON.stringify({
          ranked_variant_ids: ['unknown_variant', 'variant_1'],
          scorecards: [{
            variant_id: 'variant_1',
            overall: 120,
            storyArc: 95,
            pacing: -3,
            clarity: 91,
            visualFit: 89,
            completeness: 88,
            formatFit: 90,
            strengths: ['Clear emotional spine'],
            cautions: ['Check the final cadence'],
            rationale: 'Strong and usable.',
          }],
        }), usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7, cost: 0.3 } } };
      }
      throw new Error(`Unexpected provider request: ${endpoint}`);
    },
  });
  const index = insightIndex();
  index.visualInputs = [{
    assetId: 'asset_1',
    assetName: 'Spoofed visual name',
    assetType: 'video',
    framePaths: [`http://cinegen.test/media/projects/${fixture.projectId}/imported/asset_1/frame.jpg`],
  }];

  const result = await fixture.handlers.runCutWorkflow({
    apiKey: 'request-secret',
    model: 'anthropic/claude-sonnet-4.6',
    visionModel: 'google/gemini-2.5-flash',
    request: 'Create a founder-led story that lands on the product reveal.',
    projectId: fixture.projectId,
    activeTimelineId: 'timeline_1',
    index,
    confirmedBrief: true,
    briefOverride: { variantCount: 1, targetDurationSeconds: 24 },
    questionAnswers: { ending: 'End on the product reveal' },
  });

  assert.equal(result.stage, 'variants');
  assert.equal(result.variants.length, 1);
  assert.equal(result.visualFindings[0].status, 'ready');
  assert.equal(result.visualFindings[0].assetId, 'asset_1');
  assert.equal(result.retrievalSummary.visualSummaryStatus, 'partial');
  assert.match(result.editorialBrief.formatNotes, /End on the product reveal/);

  const segment = result.variants[0].proposals[0].segments[0];
  assert.deepEqual(segment, {
    asset_id: 'asset_1',
    asset_name: 'Founder Interview',
    source_start: 3,
    source_end: 20,
    note: 'Use the turning-point quote.',
  });
  assert.equal(result.variants[0].proposals[0].segments.length, 1);
  assert.equal(result.variants[0].scorecard.overall, 100);
  assert.equal(result.variants[0].scorecard.pacing, 0);
  assert.deepEqual(result.variants[0].scorecard.strengths, ['Clear emotional spine']);
  assert.deepEqual(
    { ...result.usage, cost: Number(result.usage.cost.toFixed(6)) },
    { promptTokens: 6, completionTokens: 9, totalTokens: 15, cost: 0.6 },
  );

  assert.deepEqual(stagedCalls.map(({ source, apiKey }) => ({ source, apiKey })), [{
    source: `/media/projects/${fixture.projectId}/imported/asset_1/frame.jpg`,
    apiKey: 'request-secret',
  }]);
  const visionCall = providerCalls.find(({ endpoint }) => endpoint === 'fal-ai/any-llm/vision');
  assert.equal(visionCall.input.model, 'google/gemini-2.5-flash');
  assert.deepEqual(visionCall.input.image_urls, ['https://fal.media/founder-frame.jpg']);
  assert.ok(providerCalls.every(({ apiKey }) => apiKey === 'request-secret'));
  const generationCall = providerCalls.find(({ input }) => input.prompt?.includes('lead editor creating one high-quality'));
  assert.match(generationCall.input.prompt, /\[asset:Founder Interview @ 3\.0\]/);
  assert.doesNotMatch(generationCall.input.prompt, /Untrusted client name/);
});

test('rejects cross-project and symlink-escaped frame references before any hosted call', async () => {
  const providerCalls = [];
  const fixture = await createFixture({
    async falSubscribe(...args) {
      providerCalls.push(args);
      throw new Error('Provider must not run.');
    },
  });
  const otherFrame = path.join(fixture.mediaRoot, 'projects', 'project_2', 'imported', 'asset_x', 'frame.jpg');
  await fsp.mkdir(path.dirname(otherFrame), { recursive: true });
  await fsp.writeFile(otherFrame, 'other project frame');

  const crossProject = insightIndex();
  crossProject.visualInputs = [{
    assetId: 'asset_1',
    assetName: 'Founder Interview',
    assetType: 'video',
    framePaths: ['/media/projects/project_2/imported/asset_x/frame.jpg'],
  }];
  await assert.rejects(
    fixture.handlers.runCutWorkflow({
      apiKey: 'request-secret',
      request: 'Build a cut',
      projectId: fixture.projectId,
      activeTimelineId: 'timeline_1',
      index: crossProject,
      confirmedBrief: true,
    }),
    (error) => error.code === 'PROJECT_MISMATCH' && error.statusCode === 403,
  );

  const outsideFrame = path.join(fixture.dataRoot, 'private-frame.jpg');
  const escapedFrame = path.join(fixture.mediaRoot, 'projects', fixture.projectId, 'imported', 'asset_1', 'escaped.jpg');
  await fsp.writeFile(outsideFrame, 'outside project media');
  await fsp.symlink(outsideFrame, escapedFrame);
  const symlinkEscape = insightIndex();
  symlinkEscape.visualInputs = [{
    assetId: 'asset_1',
    assetName: 'Founder Interview',
    assetType: 'video',
    framePaths: [`/media/projects/${fixture.projectId}/imported/asset_1/escaped.jpg`],
  }];
  await assert.rejects(
    fixture.handlers.runCutWorkflow({
      apiKey: 'request-secret',
      request: 'Build a cut',
      projectId: fixture.projectId,
      activeTimelineId: 'timeline_1',
      index: symlinkEscape,
      confirmedBrief: true,
    }),
    (error) => error.code === 'PROJECT_MISMATCH' && error.statusCode === 403,
  );
  assert.equal(providerCalls.length, 0);
});
