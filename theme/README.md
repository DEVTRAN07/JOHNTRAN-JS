# JOHNTRAN photo themes

This folder stores the photographic backgrounds used below every JOHNTRAN Canvas card.

## Backgrounds

1. `hinh-nen-gai-xinh-sexy-27.jpg`
2. `hinh-nen-gai-xinh-sexy-18.jpg`
3. `hinh-nen-gai-xinh-sexy-16.jpg`

The source URLs and selection are managed by `core/canvas/themeBackgrounds.js`.
When a background file is missing, the Canvas worker attempts to fetch it from its configured source and saves it here for subsequent renders. The renderer falls back to the built-in dark Aurora gradient if the source host is temporarily unavailable.

The bot's selected background is stored in `selection.json` and is not required to be committed. The default mode is random rotation across the three images.

## Commands

- `/theme` — open the image gallery
- `/theme 1`, `/theme 2`, `/theme 3` — choose a background
- `/theme random` or `/theme reset` — use a random background
- `/theme next` — cycle to the next background

All cards share the same image layer, translucent dark glass, Aurora light, and cyan cyber borders.
