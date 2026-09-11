# Seedance 2.5 / Topview 1080p investigation

Checked September 11, 2026.

## Live Topview website

The signed-in Board → Video → Clip Edit screen offers Seedance 2.5 with 480p, 720p, and 1080p. The model configuration returned by the website's `aiVideo.getAiVideoConfig` request lists all three resolutions under `videoEdit`, `canvasVideoEdit`, `textToVideo`, `canvasTextToVideo`, `imageToVideo`, and `canvasImageToVideo`.

Clip Edit applies extra input-video limits to the same `seedance-2.5` model entry. Its form adds a source video and an export range. The resolution choices are not exclusive to Clip Edit. Auto Upscale is a separate option in ordinary generation; selecting 1080p does not establish that Auto Upscale is required.

## Published API and CineGen

[Topview's official video API documentation](https://docs.topview.ai/reference/image-to-video-v2-text-to-video-omni-reference-api-usage) still lists only 480 and 720 for Seedance 2.5, including its Omni Reference / Video Edit table. The generic resolution field also mentions 1080; the model-specific table is more restrictive. The public API index does not document a separate Clip Edit endpoint.

CineGen already routes video-reference requests through `omni_reference`. Audio references can use its existing Canvas bridge, which reads `get_topview_canvas_generation_capabilities` and validates the requested settings before submission. Changing the display label to Clip Edit would not change that contract.

The first connector reads failed because OAuth authorization had expired. Topview was subsequently reauthenticated successfully. A fresh authenticated MCP connection returned the live configurations below. The original task connection retained stale authorization state; the fresh connection verified that the saved sign-in works. That initial capability check did not submit a generation. The user subsequently authorized the render test documented below.

## Verified authenticated MCP contract

`topview_get_generation_config`, refreshed for each of `text_to_video`, `image_to_video`, and `omni_reference`, returns Seedance 2.5 with resolutions `[480, 720, 1080]`. With raw configuration enabled, `submitParameterOptions` uses JSON references into `raw.parameters`; resolve those references rather than treating them as absent options. The current model supports prompts up to 20,000 characters.

The existing CineGen references Canvas also exposes Seedance 2.5 through `get_topview_canvas_generation_capabilities` with `taskType: "video_edit"`. Its live schema explicitly supports:

- `resolution: 1080`
- `omniReferenceTaskType: "auto" | "edit" | "extend"`
- For actual Clip Edit: `omniReferenceTaskType: "edit"`, `duration: -1`, and `aspectRatio: "adaptive"`
- Image, video, and audio reference roles; this Canvas capability allows one source video and requires at least an image or video.

The capability description distinguishes `auto` (generate with references) from `edit` (edit the supplied video) and `extend` (viral remake). A generic `video_edit` task alone defaults to `auto`; it does not select Clip Edit. CineGen now exposes this subtype explicitly in the working tree; the integration is described below.

## Conclusion

**Completed 1080p Seedance 2.5 Clip Edits are verified through both Canvas MCP and the regular Board Clip Edit website route**, with downloaded outputs measured at 1920×1080. The standalone public REST endpoint still rejects 1080p despite the live MCP catalog advertising it. Clip Edit has distinct submission contracts; it is not a separate model name. Neither test enabled Auto Upscale or resized the returned output. The Board route requires a website session and is not currently exposed as a standalone MCP tool. Do not silently downgrade resolution or switch billing routes.

## Authorized render test — September 11, 2026

The user subsequently requested a real 1080p edit test. One source football clip and its existing character-replacement prompt/reference were submitted through `submit_topview_canvas_generation_task` using `model: "seedance-2.5"`, `taskType: "video_edit"`, `resolution: 1080`, `omniReferenceTaskType: "edit"`, `duration: -1`, and `aspectRatio: "adaptive"`.

The first source was 640×360 (230,400 pixels), 8.475 seconds. Submission was accepted, but the provider rejected the render because the input video must contain at least **407,696 pixels per frame** for this route. The failure explicitly reported a refund, and the account balance returned to its pre-test value. Selecting a larger output resolution does not satisfy the input-video size requirement. That minimum is not present in the returned Canvas capability schema.

For the corrected test, only the source was resized to 1280×720, keeping its content and audio. A new generation was accepted with the same 1080p edit parameters. Retrying the failed generation card with a new command ID returned its old failed task without another charge, so the corrected run uses a new output card and command ID. Do not treat a returned receipt for an old terminal task as a newly started render.

The corrected job completed successfully. The authorized download was saved and measured directly with FFprobe:

| Property | Verified result |
| --- | --- |
| Output dimensions | **1920×1080** |
| Video codec / frame rate | HEVC / 24 fps |
| Container duration | 8.384 seconds |
| Audio track | AAC present |
| File size | 16,503,413 bytes |
| Successful task ID | `d84c2efc9c5d4242ab318add56d40a29` |
| Saved output filename | `CineGen-Seedance-2.5-1080p-Clip-Edit-test-2026-09-11.mp4` |
| Account credit change | 433.97 → 405.62 (28.35 credits) |

A decoded output frame showed the requested character replacement on player 13. The 720p input preparation was necessary only because this particular source was below the provider's input minimum; no local upscaling was applied to the output. The source preparation produced an 8.500-second clip, while the provider returned 8.384 seconds at 24 fps, so `duration: -1` should not be presented as a guarantee of frame-exact duration preservation.


## CineGen integration — September 11, 2026

Implemented in the working tree (deployment and a packaged Mac release are separate):

- Canvas: Topview Seedance 2.5 has **Video mode → Clip Edit** and a typed **Video to edit** port. Image and audio references remain separate optional inputs.
- Studio: the existing **Edit video** mode now selects the actual Canvas Clip Edit subtype. Resolution includes 1080p; duration and aspect ratio controls are hidden because the source controls them.
- Desktop and hosted provider transports route explicit edits directly to the live Canvas capability, without consulting the legacy generation parameter list. Ordinary generation retains its existing route. A missing Canvas connection fails before submission instead of switching billing to REST.
- MCP: use `inputs.video_mode: "edit"`, `inputs.source_video: "https://…/source.mp4"`, and `inputs.resolution: "1080"`. `image_url` and `audio_references` remain available. Cloud discovery also returns `clipEditConnection` with the route requirements and endpoint prompt limit.
- Preflight checks readable MP4/MOV track dimensions and rejects sources below 407,696 pixels/frame before a paid submission. Use a 720p or larger source. CineGen does not silently resize or downgrade the requested edit.
- Completed jobs use the existing persisted Canvas receipt and authorized download path. Polling resumes that receipt; it never submits another render. Explicit edits are excluded from the legacy inherited-duration automatic retry.

Validation: focused frontend/workflow tests, hosted provider tests, remote MCP tests, application TypeScript, and web/backend/MCP builds passed. The MP4 preflight reader also correctly measured the actual previously generated test output at 1920×1080. No additional paid generation was submitted for the integration tests.

The separate Electron-only TypeScript configuration currently fails on repository-wide Electron type declarations (`app`, `ipcMain`, and other Electron exports); the changed desktop adapter bundles and its targeted tests pass.

## Non-Canvas routes — September 11, 2026

The refreshed standalone MCP catalog still lists `[480, 720, 1080]` for Seedance 2.5 in `videoEdit`, with `omniReferenceTaskType: "edit"`. This is capability advertising, not proof that a submit endpoint accepts 1080p.

A direct request to the documented REST endpoint `POST https://api.topview.ai/v1/common_task/omni_reference/task/submit`, authenticated with the user's saved API credentials, returned exactly:

```json
{"code":"4000","message":"seedance-2.5 supports resolutions: 480, 720.","result":null}
```

The request specified the published display model `Seedance 2.5`, the user's source file ID, `resolution: 1080`, `omniReferenceTaskType: "edit"`, `duration: -1`, `aspectRatio: "adaptive"`, and one generation. No task was created. The same account currently has separate reported balances for API-key requests (2.13) and subscription MCP/website requests (405.62 before the Board test); the rejection was resolution validation, not insufficient credits.

The regular **Board → Video → Clip Edit** website uses a different route:

```text
POST https://www.topview.ai/api/trpc/videoClipEdit.submitTask?batch=1
```

Observed request structure (source path and task ID omitted):

```json
{
  "0": {
    "videoPath": "<uploaded source path>",
    "clipStartSec": 0,
    "clipEndSec": 4,
    "model": "seedance-2.5",
    "resolution": "1080",
    "expectStitchedFullVideo": false,
    "prompt": "Edit source video <<<Video1>>> according to the user prompt below.\n\nKeep the same scene, subject, motion, lighting and audio from the source video. Make no creative changes.",
    "inputImages": [],
    "inputVideos": [],
    "inputAudios": [],
    "videoWidth": 1280,
    "videoHeight": 720,
    "sourceDurationSec": 4.208333,
    "keepOriginalSound": "yes",
    "clipEditPipeline": "omni_reference",
    "imageMode": "multiImage",
    "source": "board",
    "boardTaskId": "<created Board task ID>"
  }
}
```

The UI first creates a Board task with `board.task.create` and `toolType: "clip-edit"`. It does not create a Canvas or Canvas node. The Board source occupies `videoPath`; additional video references belong in `inputVideos`.

An authorized four-second test completed successfully with Clip Edit task `d3a5f0f31b2c479dbf4fec4a9ed7aab4` and Board task `4098d92c81e04f6d860ae277b495de62`. The output was downloaded through its authorized URL and measured with FFprobe:

| Property | Verified result |
| --- | --- |
| Output dimensions | **1920×1080** |
| Video codec / frame rate | H.264 / 24 fps |
| Container duration | 3.712 seconds |
| Audio track | AAC present |
| File size | 4,210,099 bytes |
| Saved output filename | `CineGen-Seedance-2.5-1080p-Board-Clip-Edit-test-2026-09-11.mp4` |
| Subscription credit change | 405.62 → 394.82 (**10.8 credits**) |

The UI estimated 13.5 credits before submission; the final credit log reports 10.8 for the underlying video task `d95a096e57a948a8a40cc5c11035efee`. The Board task's `creditsCost: 0` field is therefore not reliable billing evidence. No Auto Upscale option was enabled and no output resizing was performed. The selected input range was four seconds, while the returned container was 3.712 seconds; exact duration preservation is not guaranteed here either.

This is an authenticated website route, not a currently exposed standalone MCP tool or documented public REST endpoint. A read-only request to the website's `board.task.getBatchDetail` with the API key returned HTTP 401 `UNAUTHORIZED`, while the same read succeeds through the signed-in website/MCP. Do not treat the website route as a drop-in replacement for Claude's `topview_generate_video` or copy browser session credentials into CineGen. The existing CineGen Canvas integration remains unchanged by this investigation.
