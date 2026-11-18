# External media commands

## /ảnh [từ khóa]

Searches Openverse for an open-licensed image, downloads the Openverse thumbnail proxy and sends it as a Zalo attachment. Requests explicitly set mature=false and filter_dead=true. The caption includes the title, creator, licence and source page so the original work can be credited.

The command is available as /ảnh, /anh, /image and /photo. Without a keyword it searches for nature images.

## /vd 18+ [từ khóa]

Uses the AdultEmbed API catalogue and returns up to five player links. With no keyword it asks for one random result. It does not download, mirror or re-upload adult video files.

This mode works in one-to-one chats and in Zalo groups when invoked by a configured bot administrator (admin_bot). In groups, the bot posts an explicit 18+ warning and the player links into that group. Non-admin callers in groups are refused. It is the only private-message command allowed through when allow_private_command: false; other private commands remain blocked.

The 18+ token is a self-attestation, not identity or government age verification. Users must be adults and must access the content only where lawful. Group administrators should warn members before using this command and must not expose minors to the results.

## Existing /vd behavior

/vd without the 18+ argument remains the existing reply-to-video command: it sends the replied video in its original file form.
