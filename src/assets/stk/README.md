# STK Discord avatar frames

This directory contains the complete local asset set for the /stk command.

## Bundled files

- 200 PNG avatar-decoration frames, numbered 1–200.
- menu.jpg: STK menu preview.
- assets-manifest.json: pinned source commit, dimensions, file sizes and SHA-256 checksums.

All 200 frames and the menu image are committed in this repository. A normal git clone or git pull includes them; no separate download is needed.

## Download or repair a missing asset

From the project root:

```bash
npm run assets:stk
```

The startup hook checks the local directory and downloads only missing assets. Verify the set with:

```bash
npm run check:stk-assets
```

## Source

The bundled assets were obtained from DEVTRAN07/Discord-decor at commit 745a7ad1d155d03bda4466a92e52c3c578f279ab.
