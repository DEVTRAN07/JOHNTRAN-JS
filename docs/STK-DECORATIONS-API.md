# Discord Decorations API for /stk

JOHNTRAN-JS exposes a cached catalog backed by the public
[uhidontkno/DiscordAvatarDecorations](https://github.com/uhidontkno/DiscordAvatarDecorations)
asset archive. This is a community-maintained archive, not an official Discord API.

## Authentication

All /api/* endpoints use the Panel Bearer token:

    Authorization: Bearer <JT_PANEL__TOKEN>

Do not put the token in a public URL or share it in a chat.

## Endpoints

### List decorations

    GET /api/stk/decorations?limit=30&offset=0

Optional filters: q (search), category (shop/archive/etc or collection), animated (true/false), limit (1–100), offset (zero-based).

Example:

    GET /api/stk/decorations?q=anime&limit=15

Response includes total, sourceSha, cachedAt, stale, and decorations. Each decoration has a stable ID, display name, collection, static image URL, optional animated URL, and source link.

### Get one decoration

    GET /api/stk/decorations/shop-anime-in-love

### Refresh catalog

    POST /api/stk/decorations/refresh

Refresh pulls the GitHub repository tree and replaces the local catalog snapshot. Normal reads use a six-hour cache with stale-while-revalidate behavior.

## Bot commands

Reply to an image, GIF, or video, then use:

- /stk list [page]: browse the catalog, 15 entries per page.
- /stk find <keyword>: search by name or collection.
- /stk <decoration-id>: apply the selected decoration.
- /stk random: pick a random decoration from the cached catalog.
- /stk khung or /stk 1 … /stk 5: use the original five built-in frames.

Decoration image files are downloaded only when first selected and then kept in the local sticker asset cache for seven days. GIF/WebP/APNG overlays are kept animated when FFmpeg supports the required codecs. All generated sticker outputs continue to respect the existing 512 KB size cap.