# STK Discord avatar frames

This directory is the local storage location for the 200 Discord avatar-decoration PNG frames used by the `/stk` command.

## Files

- `1_*.png` … `200_*.png`: downloaded frame images.
- `menu.jpg`: STK menu preview.
- `assets-manifest.json`: source commit, dimensions, file sizes and SHA-256 checksums.

## Download

From the project root:

```bash
npm run assets:stk
```

The normal startup commands (`npm start`, `npm run start:prod`, and `npm run dev`) also check this directory and download any missing assets before starting the bot.

Verify the local set:

```bash
npm run check:stk-assets
```

## Important

The image files are generated/downloaded locally from the pinned `DEVTRAN07/Discord-decor` source commit. They are intentionally ignored by Git to avoid adding roughly 200 MB of binary assets to this bot repository. This README is committed so the destination folder is visible on GitHub; the PNG files appear in this folder on the machine/container after the download command or first startup completes.
