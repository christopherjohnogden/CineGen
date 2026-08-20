# Oneiric prompt skills

Source skills from Higgsfield’s Oneiric project. The `.skill` files are the installable packages (zip of the matching folder). Keep the unzipped `SKILL.md` so git can diff them.

| Package | Folder | Used in CineGen |
|---|---|---|
| `tig-acting-task.skill` | `tig-acting-task/` | Shotlist LLM doctrine + compiled `ACTING TASK` on each SEGMENT (scene direction, motive, goal, obstacle, tactic, moments, eye-life safety) |
| `tig-diagram.skill` | `tig-blocking-map/` (package name inside the zip) | Craft staging map: diagram prompt, `@staging_` / `@loc_` tags, connector in LOCATION MAP, staging still attached **last** on Generate |

To reinstall in Claude / Cursor, drop the `.skill` file onto the product, or zip the folder:

```sh
cd skills && zip -r tig-acting-task.skill tig-acting-task
cd skills && zip -r tig-diagram.skill tig-blocking-map
```
