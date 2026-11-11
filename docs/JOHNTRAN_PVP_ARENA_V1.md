# JOHNTRAN Tu Tiên V5 — PvP, Media & Tranh Đoạt

## Commands

- `/tutien pvp @uid`: gửi lời thách đấu tới người đã tạo nhân vật.
- `/tutien pvp chapnhan`: chấp nhận lời mời còn hiệu lực (120 giây).
- `/tutien pvp tuchoi`: từ chối lời mời.
- `/tutien pvp danh`: đánh thường.
- `/tutien pvp skill`: Thiên Lôi Chưởng, tiêu hao 20 khí.
- `/tutien pvp ultimate`: Cửu Trọng Kiếm Quyết, tiêu hao 45 khí.
- `/tutien pvp defend`: phòng thủ và hồi khí.
- `/tutien pvp status`: xem HP, khí và lượt hiện tại.
- `/tutien bxh [rating|wins|power|seasonPoints|bestStreak]`: bảng xếp hạng.
- `/tutien tranhdoat thamgia`: ghi danh mùa hiện tại.
- `/tutien tranhdoat`: xem bảng tranh đoạt mùa.

## Combat rules

- Power is derived from the player's actual realm index, attack, defense and cultivation.
- Challenge is rejected for self-targeting, missing character, existing opponent battle, or a power gap above 65%.
- A challenge expires after 120 seconds; an active match expires after 10 minutes.
- Only the current fighter can act. Each turn alternates between the two players.
- Normal attack, skill, ultimate and defend are supported; hit, dodge and critical outcomes are deterministic from the injected random value in the engine.
- Winner gains 25 rating and 30 normal spirit stones; loser loses 15 rating (floor 500). Season points are awarded only to players who joined the current season.
- The current weekly season is calculated in UTC+7.

## Real media output

- Every PvP turn renders a 16-frame GIF using Canvas + `ffmpeg-static`.
- On match completion, the bot also renders MP4, uploads it and sends it with a real image thumbnail using the installed `zalo-client` `uploadAttachment` / `sendVideo` APIs.
- GIF is sent as a local `.gif` attachment through `sendMessage`.
- Rendering runs in the bounded `canvas` job queue lane. Temporary files are removed in a `finally` block.
- If media rendering or sending fails, the command catches the media error and still sends the text combat result.
- No live Zalo production account test has been performed. CI tests validate engine rules and generated GIF/MP4 artifacts; an online smoke test is still required after deployment.

## Data

PvP statistics are stored under `Users.data.tuTien.arena`: rating, wins, losses, streak, best streak, season points, pending challenge, current battle and last result. The active battle snapshot is stored for both fighters so either participant can inspect the current state.

## Known limitations to address in the next iteration

- A season's final reward payout/claim flow is not yet automated.
- PvP persistence uses the existing Users data controller; it is not a database transaction. Simultaneous opposing commands across multiple bot processes need a shared atomic lock/transaction before horizontal scaling.
- Media sizes and upload limits are governed by the installed Zalo client/account settings.
