# Human stand-in

Source: Quaternius, **Universal Base Characters**, Standard pack, `Superhero_Male_FullBody.gltf` (2025-11-14 asset).

- Author/source: https://quaternius.com/packs/universalbasecharacters.html
- Official download: https://quaternius.itch.io/universal-base-characters
- License: CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/
- Original license notice: [LICENSE.txt](./LICENSE.txt)

CineGen removes textures, uses neutral materials, relaxes the T-pose, and bakes standing, walking, sitting, and kneeling poses. Standing height is normalized to one unit; every pose has its lowest vertex at zero. The shared triangle indices and rounded vertex positions are bundled locally in `poses.json`, so stand-ins need no network requests or asynchronous model loading.

To regenerate, download the Standard pack, extract the glTF and neighboring `.bin`, and run from the repository root:

```sh
node scripts/sets/bake-mannequin.mjs '/path/to/Superhero_Male_FullBody.gltf'
```
