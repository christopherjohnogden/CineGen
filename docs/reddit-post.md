# I built an open-source video editor with AI built in — node-based generation, multi-track timeline, and an LLM that knows your project

Hey everyone, I've been working on **CineGen** — a desktop video editor where AI isn't a sidebar feature, it's woven into every part of the editing workflow. It's open source and free.

---

## What makes it different from other AI video tools

Most AI video tools are either generators (type a prompt, get a video) or editors (import footage, cut it together). CineGen is both in one app. You generate your footage, edit it on a real timeline, and export — without leaving the window.

---

## Spaces — Node-Based AI Workflows

This is where you build your shots. It's a visual node editor (like ComfyUI or Blender's shader nodes) where you connect prompts, models, elements, and outputs. Over 50 AI models across image, video, and audio — FLUX, Kling 3.0, Runway Gen-4, Veo 3.1, Sora 2, and more.

![Node-based workflow editor](https://raw.githubusercontent.com/christopherjohnogden/CineGen/main/screenshots/spaces.png)

The **Storyboarder node** is probably my favorite — describe a scene and an LLM breaks it into sequential shots with camera directions, then generates all the images/videos. One click imports the whole sequence to the timeline.

Preview and arrange your generated clips directly on the canvas before sending them to the full editor:

![Spaces timeline preview](https://raw.githubusercontent.com/christopherjohnogden/CineGen/main/screenshots/spaces_timeline.png)

**SAM3 segmentation** is built right in — segment objects from generated images with text, click, or box prompts. Multiple display modes for checking your masks:

![SAM3 cloud segmentation](https://raw.githubusercontent.com/christopherjohnogden/CineGen/main/screenshots/spaces_sam3_2.png)

---

## Elements — Visual Consistency Across Shots

Create characters, locations, props, and vehicles with reference panels. The app generates **7 angles per element** (front, profile, back, detail, etc.) and uses the first panel as a reference for the rest so everything stays consistent. Type `@` in any prompt to pull in an element by name.

![Element creation](https://raw.githubusercontent.com/christopherjohnogden/CineGen/main/screenshots/element_create.png)

![Element reference panels](https://raw.githubusercontent.com/christopherjohnogden/CineGen/main/screenshots/element_new.png)

![Elements library](https://raw.githubusercontent.com/christopherjohnogden/CineGen/main/screenshots/elements.png)

---

## Edit — Actual NLE, Not a Toy Timeline

Multi-track timeline with **10 editing tools** (select, blade, ripple trim, roll, slip, slide, plus AI tools). Dual source/timeline viewers, keyframe animation, transitions, waveforms, audio sync — the stuff you'd expect from a real editor.

![Dual viewer editing](https://raw.githubusercontent.com/christopherjohnogden/CineGen/main/screenshots/edit_dual%20viewer.png)

![Single viewer editing](https://raw.githubusercontent.com/christopherjohnogden/CineGen/main/screenshots/edit_single%20viewer.png)

### AI Tools Built Into the Timeline

Here's where it gets interesting — the AI tools are built directly into the timeline:

**Fill Gap** — select a gap between two clips, it analyzes the adjacent frames and generates new footage to bridge them:

![Fill gap tool](https://raw.githubusercontent.com/christopherjohnogden/CineGen/main/screenshots/edit_fill_gap.png)

**Music Generation** — generate a soundtrack from your video with genre/mood/tempo controls:

![Music generation](https://raw.githubusercontent.com/christopherjohnogden/CineGen/main/screenshots/edit_music.png)

**Extend** — lengthen a clip in either direction using 9 different video models:

![Extend tool](https://raw.githubusercontent.com/christopherjohnogden/CineGen/main/screenshots/edit_extend.png)

**Auto Mask** — mask objects with SAM3 right in the source viewer with red overlay, white-on-black, and transparent preview modes:

![Mask tool](https://raw.githubusercontent.com/christopherjohnogden/CineGen/main/screenshots/edit_mask.png)

---

## LLM Chat — An Assistant That Actually Knows Your Project

This isn't a generic chatbot. The LLM has full context of your assets, timelines, transcripts, and elements. Four modes:

- **Ask** — project-aware Q&A (summarize this scene, suggest a prompt, etc.)
- **Search** — find quotes and moments with clickable timestamp citations that jump to that point in the editor
- **Cut** — describe what you want and it proposes rough cuts from your transcripts, then applies them as a new timeline
- **Timeline** — reason about your edit structure, suggest trims, pacing changes

Works with Gemini, Claude, GPT-4, or locally via Ollama.

![LLM chat interface](https://raw.githubusercontent.com/christopherjohnogden/CineGen/main/screenshots/LLM.png)

---

## Tech Stack

Electron, React 19, TypeScript, React Flow, SQLite, FFmpeg, AVFoundation (macOS native video). All AI calls go through fal.ai, kie.ai, or RunPod — bring your own API keys, nothing is stored on any server.

---

## It's Open Source (MIT)

I'm actively working on this and would love contributors, feature requests, or just feedback. If you've ever wanted an editing app that treats AI as a first-class tool instead of a gimmick, give it a look.

**GitHub**: https://github.com/christopherjohnogden/CineGen

---

*Built on macOS. Requires Node.js 18+ to run from source.*
