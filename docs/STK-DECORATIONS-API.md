# Discord Decorations API for /stk

JOHNTRAN-JS serves a bundled metadata snapshot of the community-maintained
[uhidontkno/DiscordAvatarDecorations](https://github.com/uhidontkno/DiscordAvatarDecorations)
archive. The catalog contains 136 decoration entries built from 202 PNG/GIF/WebP/APNG source assets at commit
`804611c782965a2c3a8050e1135c9a91882a8ce7`.

The manifest is included in the application at `core/data/discordDecorations.manifest.json`.
Normal catalog reads do not call GitHub or jsDelivr metadata APIs; this avoids GitHub API rate limits and HTTP 403 failures.

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

Response includes total, sourceSha, cachedAt, stale, and decorations. Each decoration has a stable ID, display name, collection, CDN image URL, raw GitHub fallback URL, optional animated URL, and source link.

### Get one decoration

    GET /api/stk/decorations/shop-anime-in-love

### Reload bundled catalog

    POST /api/stk/decorations/refresh

This endpoint only reloads the local manifest from disk. It does not call GitHub or an external metadata API. To update the source snapshot, update the bundled manifest in a reviewed repository commit.

## Bot commands

Reply to an image, GIF, or video, then use:

- `/stk list [page]`: browse the catalog, 15 entries per page.
- `/stk find <keyword>`: search by name or collection.
- `/stk <number>`: apply the selected decoration by its 1-based numeric ID as shown in `/stk list` or `/stk find`. Numeric IDs refer to the same position in the full bundled catalog across pages and search results.
- The stable string decoration ID remains internal and is still returned by the JSON API endpoints.
- `/stk random`: choose a random decoration from the local manifest.

The five old custom frames (Discord Classic/Nitro/Midnight/Neon/Hologram) have been removed from the command and renderer.

Decoration image files are downloaded only when first selected and then kept in the local sticker asset cache for seven days. The primary asset source is the pinned jsDelivr CDN URL; a pinned raw GitHub URL is used as fallback. GIF/WebP/APNG overlays are kept animated when FFmpeg supports the required codecs. All generated sticker outputs continue to respect the existing 512 KB size cap.
