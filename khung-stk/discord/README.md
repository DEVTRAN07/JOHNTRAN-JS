# Discord STK frames

The five Discord-inspired frame presets are rendered at runtime by `core/stickerFrames.js`.
Each preset is a 512×512 transparent PNG overlay; the centre stays transparent so the input image/video remains visible.
The rendered overlays are written to `assets/cache/sticker/` and composited into every output frame by `core/stickerService.js`.

| ID | Preset | Style |
|---:|---|---|
| 1 | Discord Classic | Blurple identity frame |
| 2 | Discord Nitro | Purple/pink neon halo |
| 3 | Midnight Discord | Navy and electric blue |
| 4 | Discord Neon | Cyan, violet and magenta |
| 5 | Discord Hologram | Lavender and icy cyan |

Use `/stk khung` to display the available presets.