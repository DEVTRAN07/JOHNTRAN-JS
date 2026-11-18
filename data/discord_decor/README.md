# STK Discord decoration assets

Place assets for the Python-style `stk dis` command in this directory.

- `menu.jpg` — image showing the 200 decoration choices.
- Frame files — names listed in `core/data/stkDiscord200.json`.

The bot accepts either the exact filename from the catalog or an alternate filename beginning with the matching numeric ID (for example `12_custom.gif`). Valid frame formats are PNG/APNG, GIF and WebP.

Expected composition: 288×288 canvas, circular 240×240 avatar at offset (24,24), Discord frame layered above it, animated WebP output capped at 512 KB.

After copying the assets from the Python bot's `data/discord_decor/` directory, run:

```bash
npm run check:stk-assets
```

The checker validates the menu image and all 200 frame IDs. It lists every missing frame file. This repository currently contains only the catalog and this README; binary frame images and `menu.jpg` must still be copied in.
