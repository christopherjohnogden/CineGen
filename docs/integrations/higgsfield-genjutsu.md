# Higgsfield Genjutsu

Verified September 11, 2026 using authenticated `model get` in Higgsfield CLI 1.1.23 and MCP `models_get`.

| CineGen option | Provider model ID | Purpose |
| --- | --- | --- |
| Genjutsu · Motion Transfer | `hf_mult_motion_control` | Transfer motion from a video to subjects in reference images. |
| Genjutsu · Object Replacement | `hf_mult_replace_object` | Replace objects in a video using reference images. |

Both models require exactly one source video and at least one reference image. The provider expresses these requirements as CEL rules, although the individual schema fields are marked optional. The prompt is optional. Resolution is `480p`, `720p` (default), or `1080p`. The verified schema has no aspect ratio, duration, or audio controls.

Canvas and Studio use the shared Higgsfield registry. Desktop submission sends `--image-references` and `--video-references`. Hosted submission calls Higgsfield MCP `generate_video` with media roles `image_references` and `video_references`.

CineGen MCP discovers both options through `cinegen_list_models` with `provider: "higgsfield"`. Generation inputs use `image_references` (HTTPS image URLs), `video_references` (one HTTPS video URL), optional `prompt`, and `resolution`. Node IDs are `hf-hf-mult-motion-control` and `hf-hf-mult-replace-object`.

Refresh these models without removing legacy catalog entries:

```sh
npm run higgsfield:catalog -- --model hf_mult_motion_control --model hf_mult_replace_object
```

The generator normalizes `job_type` to CineGen's `job_set_type`, preserves nullable parameters and provider rules, and leaves unrelated models intact during targeted refreshes. The catalog's CLI metadata records the most recent refresh. Contract tests cover reference separation, required inputs, 1080p, and outgoing CLI/MCP payloads. No paid Genjutsu generation was submitted as part of this integration.
