# ARCHITECTURE_COMPLETE.md

## 1. Legend

```mermaid
flowchart LR
    subgraph Legend
        A[Hệ Thống Ngoại]:::ext
        B[Dịch Vụ Nội Bộ]:::int
        C[Kho Dữ Liệu]:::store
        D[Tiến Trình/Luồng]:::proc
        E[Cấu Hình]:::cfg
    end

    classDef ext fill:#e8f4fd,stroke:#2196f3,stroke-width:2px;
    classDef int fill:#e8f5e9,stroke:#4caf50,stroke-width:2px;
    classDef store fill:#fff3e0,stroke:#ff9800,stroke-width:2px;
    classDef proc fill:#fce4ec,stroke:#e91e63,stroke-width:2px;
    classDef cfg fill:#f3e5f5,stroke:#9c27b0,stroke-width:2px;
```

## 2. Current System Overview

```mermaid
flowchart TB
    subgraph External["Hệ Thống Ngoại"]
        Zalo["Zalo Platform
(WebSocket)"]
        SoundCloud["SoundCloud API"]
        TikTokAPI["TikTok API
(tikwm + fallback)"]
        MediaDL["Media Downloader
(endpoint tùy chọn)"]
        Supabase["Supabase
(PostgreSQL)"]
        UptimeRobot["UptimeRobot
(health ping)"]
        GitHubPages["GitHub Pages
(Panel UI)"]
        Render["Render.com
(Docker Host)"]
    end

    subgraph BotRuntime["JOHNTRAN Bot Runtime (Node.js v20+)"]
        direction TB

        subgraph Entry["Entry Point (CommonJS)"]
            Index["index.js
(supervisor)"]
            JohnTran["JohnTran.js
(bot entry, spawn)"]
        end

        subgraph Core["core/"]
            Config["config.yml + env
(JT_*) → Immutable"]
            HTTP["HTTP Client
(timeout, retry, privacy guard)"]
            Services["Services Config
(endpoints từ config)"]
            AI["AI Module
(Gemini TTS /noi)"]
            Music["Music Registry
(Track + SoundCloud + Lyrics)"]
            Message["Message Helper
(reply, card, reaction)"]
            Canvas["Canvas Renderer
(theme, vip, menu, music)"]
            Cache["LRU Cache TTL
(group, user, music)"]
            Storage["Storage Abstraction
(JSON local + Supabase)"]
            Metrics["Metrics + Audit Log
(data/audit.log)"]
            HotReload["Hot Reload
(plugin watcher)"]
            Health["Health Server
(/health endpoint)"]
            Bootstrap["Bootstrap
(account/cookie/env restore)"]
        end

        subgraph Pipeline["core/handle/"]
            Resolve["Resolve Command"]
            AntiSpam["Anti-Spam Check"]
            Permission["Permission Check
(role 0/1/2)"]
            Cooldown["Cooldown Check"]
            Execute["Execute Command"]
        end

        subgraph Loader["core/loader/"]
            CmdLoader["Command Loader"]
            EventLoader["Event Loader"]
            PluginDeps["pluginDeps.js
(extractDependencies,
installMissingDeps)"]
        end

        subgraph Utils["utils/" (tách thành 5 module)"]
            UFile["file.js
(saveBase64Image,
getJsonData, tryUnlink)"]
            UConfig["config.js
(updateConfigArray,
reloadConfig)"]
            UMsgCache["messageCache.js
(RAM + debounce disk)"]
            UMedia["media.js
(processVideo,
processAudio, ...)"]
            UQR["qr.js
(decodeQR, generateQR,
displayQR)"]
            UIndex["index.js
(re-export 35 dòng)"]
        end

        subgraph Controller["core/controller/"]
            Users["Users Controller"]
            Threads["Threads Controller"]
        end
    end

    subgraph Panel["panel/"]
        BotManager["Bot Manager
(spawn/stop/restart/logs/QR)"]
        PanelServer["Panel API Server
(zero-dep, không Express)"]
    end

    subgraph Plugins["plugins/"]
        Commands["commands/ (23 lệnh)
scl, lyric, noi, stats, menu,
spam, spamsticker, card, tiktok,
infofb, getavt, autodown, events..."]
        Events["events/ (đã bỏ v3)
Pure command-based bot"]
    end

    subgraph Assets["assets/"]
        Spam["spam/*.txt
(vi, en, zh, ja, ko, th, mix)"]
        MediaData["autosend.json
girl.json
vdgirl.json"]
        BadWords["spam/badwords.txt"]
        BG["bg/theme.jpg"]
        Fonts["fonts/ (8 family)"]
    end

    subgraph Data["data/"]
        Store["store.json
(JSON atomic store)"]
        AuditLog["audit.log"]
        CacheDir["cache/"]
    end

    subgraph RuntimeArtifacts["Runtime Artifacts (bị gitignore)"]
        CacheAssets["core/assets/cache/"]
        Session["*.session"]
        Tmp["*.tmp"]
        Scratch["*.scratch"]
    end

    Zalo ---|WebSocket| BotRuntime
    SoundCloud ---|REST| Music
    TikTokAPI ---|REST| Commands
    MediaDL ---|REST| Commands
    Supabase ---|PostgreSQL| Storage
    UptimeRobot ---|HTTP /health| Health
    GitHubPages ---|HTTPS| PanelServer
    Render ---|Docker| BotRuntime

    Index -->|spawn| JohnTran

    classDef ext fill:#e8f4fd,stroke:#2196f3;
    classDef int fill:#e8f5e9,stroke:#4caf50;
    classDef store fill:#fff3e0,stroke:#ff9800;
    classDef proc fill:#fce4ec,stroke:#e91e63;
    classDef cfg fill:#f3e5f5,stroke:#9c27b0;

    class Zalo,SoundCloud,TikTokAPI,MediaDL,Supabase,UptimeRobot,GitHubPages,Render ext
    class Config,HTTP,Services,AI,Music,Message,Canvas,Cache,Storage,Metrics,HotReload,Health,Bootstrap,Resolve,AntiSpam,Permission,Cooldown,Execute,CmdLoader,EventLoader,PluginDeps,Users,Threads,BotManager,PanelServer,UFile,UConfig,UMsgCache,UMedia,UQR,UIndex int
    class Store,AuditLog,CacheDir,Supabase store
    class Commands,Events proc
    class Spam,MediaData,BadWords,BG,Fonts cfg
    class CacheAssets,Session,Tmp,Scratch store
```

## 3. Current Internal Architecture

```mermaid
flowchart TB
    subgraph Entry["Entry Point (CommonJS)"]
        Index["index.js
(supervisor - khởi động panel hoặc
spawn JohnTran.js)"]
        JohnTran["JohnTran.js
(bot entry - login, loader,
listener, panelBridge)"]
    end

    subgraph Bootstrap["Bootstrap Sequence"]
        B1["Load config.yml"]
        B2["Áp dụng ghi đè JT_* env"]
        B3["Validate & Freeze Config
(immutable)"]
        B4["Khôi phục account.json
từ JT_ACCOUNT_JSON"]
        B5["Khôi phục cookie.json
từ JT_COOKIE_JSON"]
        B6["Khởi tạo Storage
(JSON hoặc Supabase)"]
        B7["Khởi động Health Server
(PORT env)"]
        B8["Kết nối Zalo WebSocket"]
        B9["Load Plugins
(commands + events)"]
        B10["Bắt Hot Reload Watcher"]
        B11["Bắt Metrics Collector"]
    end

    subgraph Runtime["Runtime Core"]
        ZaloClient["Zalo Client
(WebSocket connection)"]
        EventLoop["Event Loop
(message, reaction, etc.)"]
    end

    subgraph CommandPipeline["Command Pipeline (core/handle/)"]
        CP1["Resolve Command
(prefix + alias)"]
        CP2["Anti-Spam Check
(per user/group)"]
        CP3["Permission Check
(role: 0=member, 1=support, 2=admin)"]
        CP4["Cooldown Check
(per command/user)"]
        CP5["Execute Handler
(async, wrapped)"]
        CP6["Reaction Feedback
👍 → ✅/😢"]
        CP7["Auto Recall
(1 min undo)"]
    end

    subgraph Services["Core Services"]
        S1["HTTP Client
(retry, timeout, privacy)"]
        S2["Music Provider
(SoundCloud + Lyrics)"]
        S3["Canvas Renderer
(theme, fonts, layout)"]
        S4["Cache Manager
(LRU TTL)"]
        S5["Storage Adapter
(JSON <-> Supabase)"]
        S6["Sticker Store
(effectId > 0)"]
        S7["Media Downloader
(meta + endpoint)"]
    end

    subgraph DataLayer["Data Layer (core/controller/)"]
        DL1["Users Controller
(get/set/all)"]
        DL2["Threads Controller
(get/set/all)"]
    end

    subgraph Utils["Utils Layer (utils/)"]
        U1["file.js - saveBase64Image,
getJsonData, tryUnlink"]
        U2["config.js - updateConfigArray,
reloadConfig"]
        U3["messageCache.js - RAM +
debounce disk"]
        U4["media.js - processVideo,
processAudio, extractThumbnail,
uploadFile"]
        U5["qr.js - decodeQRFromBase64,
generateQRCodeInTerminal,
displayQRCodeInConsole"]
        U6["index.js - re-export 5 module +
convertTimestamp inline"]
    end

    subgraph CacheLayer["Cache Layer (core/cache/)"]
        C1["lru.js - LRUCache class +
createCache (tách ra)"]
        C2["cache.js - import từ ./lru,
re-export tất cả, giữ instances +
cleanup"]
    end

    subgraph LoaderLayer["Loader Layer (core/loader/)"]
        L1["pluginDeps.js - extractDependencies,
installMissingDeps, SUSPICIOUS_DEP,
DEP_PAIR (chia sẻ)"]
        L2["loaderCommand.js - import
từ ./pluginDeps"]
        L3["loaderEvent.js - import
từ ./pluginDeps"]
    end

    subgraph PanelSystem["Panel System (panel/)"]
        PS1["Bot Manager
(spawn/stop/restart)"]
        PS2["Panel API
(/api/*)"]
        PS3["WebSocket Logs
(realtime)"]
        PS4["QR Display"]
        PS5["Metrics Dashboard"]
        PS6["Audit Log Viewer"]
        PS7["Watchdog
(crash-loop detection)"]
    end

    Index -->|spawn JohnTran.js| JohnTran
    JohnTran --> B1 --> B2 --> B3 --> B4 --> B5 --> B6 --> B7 --> B8 --> B9 --> B10 --> B11
    B8 --> ZaloClient
    ZaloClient --> EventLoop
    EventLoop --> CP1 --> CP2 --> CP3 --> CP4 --> CP5 --> CP6 --> CP7
    CP5 --> S1 & S2 & S3 & S4 & S5 & S6 & S7
    CP5 --> DL1 & DL2
    CP5 --> U1 & U2 & U3 & U4 & U5 & U6
    S4 --> C1 & C2
    L2 --> L1
    L3 --> L1
    B9 --> Commands
    B7 --> PS2
    PS1 --> PS2 & PS3 & PS4 & PS5 & PS6 & PS7

    classDef entry fill:#e3f2fd,stroke:#1976d2;
    classDef boot fill:#e8f5e9,stroke:#388e3c;
    classDef rt fill:#fff3e0,stroke:#f57c00;
    classDef pipe fill:#fce4ec,stroke:#c2185b;
    classDef svc fill:#f3e5f5,stroke:#7b1fa2;
    classDef data fill:#e0f2f1,stroke:#00695c;
    classDef panel fill:#f1f8e9,stroke:#558b2f;
    classDef util fill:#e1f5fe,stroke:#0277bd;
    classDef cache fill:#fff8e1,stroke:#f9a825;
    classDef loader fill:#f3e5f5,stroke:#7b1fa2;

    class Index,JohnTran entry
    class B1,B2,B3,B4,B5,B6,B7,B8,B9,B10,B11 boot
    class ZaloClient,EventLoop rt
    class CP1,CP2,CP3,CP4,CP5,CP6,CP7 pipe
    class S1,S2,S3,S4,S5,S6,S7 svc
    class DL1,DL2 data
    class U1,U2,U3,U4,U5,U6 util
    class C1,C2 cache
    class L1,L2,L3 loader
    class PS1,PS2,PS3,PS4,PS5,PS6,PS7 panel
```

## 4. Request Flow

```mermaid
sequenceDiagram
    participant User as Zalo User
    participant Zalo as Zalo Platform
    participant WS as WebSocket Listener
    participant Pipeline as Command Pipeline
    participant Resolve as Resolve Command
    participant AntiSpam as Anti-Spam
    participant Perm as Permission Check
    participant CD as Cooldown Check
    participant Handler as Command Handler
    participant Services as Core Services
    participant Storage as Storage Layer
    participant Canvas as Canvas Renderer
    participant React as Reaction Feedback
    participant Recall as Auto Recall

    User->>Zalo: Gửi tin nhắn "/scl Sơn Tùng MTP"
    Zalo->>WS: WebSocket push (message event)
    WS->>Pipeline: Forward event

    Pipeline->>Resolve: Phân tích prefix + command + args
    Resolve-->>Pipeline: Command: "scl", args: ["Sơn Tùng MTP"]

    Pipeline->>AntiSpam: Kiểm tra giới hạn tốc độ user/group
    alt Spam phát hiện
        AntiSpam-->>Pipeline: Chặn + log
        Pipeline->>React: reaction buồn
    else OK
        AntiSpam-->>Pipeline: Pass
        Pipeline->>Perm: Kiểm tra vai trò (0/1/2)
        alt Quyền không đủ
            Perm-->>Pipeline: Từ chối
            Pipeline->>React: reaction buồn
        else OK
            Perm-->>Pipeline: Pass
            Pipeline->>CD: Kiểm tra cooldown lệnh
            alt Đang cooldown
                CD-->>Pipeline: Bỏ qua
                Pipeline->>React: reaction buồn
            else OK
                CD-->>Pipeline: Pass
                Pipeline->>Handler: Thực thi handler scl
                Handler->>React: reaction thumbsup (bắt đầu)

                Handler->>Services: Tìm kiếm SoundCloud
                Services-->>Handler: Danh sách bài hát (20 kết quả)

                Handler->>Canvas: Render lưới nhạc (4 cột)
                Canvas-->>Handler: Buffer PNG (lossless)

                Handler->>Storage: Cache kết quả (LRU, TTL 5 phút)
                Handler->>Zalo: Gửi ảnh + văn bản (trang 1/3)

                Handler->>React: reaction check (thành công)

                par Auto Recall (1 phút)
                    Recall->>Zalo: Undo tin nhắn (của bot)
                end
            end
        end
    end
```

## 5. Worker Pool

```mermaid
flowchart TB
    subgraph MainProcess["Quy Trình Chính (Node.js)"]
        EventLoop["Event Loop
(single-threaded)"]
        WorkerThreads["Worker Threads
(nếu bật)"]
    end

    subgraph PanelWorkers["Quy Trình Con Quản Lý Bởi Panel"]
        direction TB

        subgraph Bot1["Bot Instance 1 (PID: xxx)"]
            B1Main["Main Thread"]
            B1Handle["Command Handler"]
            B1Canvas["Canvas Worker
(offload render)"]
            B1Music["Music Worker
(fetch + cache)"]
        end

        subgraph Bot2["Bot Instance 2 (PID: yyy)"]
            B2Main["Main Thread"]
            B2Handle["Command Handler"]
            B2Canvas["Canvas Worker"]
            B2Music["Music Worker"]
        end

        subgraph BotN["Bot Instance N (PID: zzz)"]
            BNMain["Main Thread"]
            BNHandle["Command Handler"]
            BNCanvas["Canvas Worker"]
            BNMusic["Music Worker"]
        end
    end

    subgraph SharedResources["Tài Nguyên Chia Sẻ (mỗi instance bot)"]
        SR1["LRU Cache
(group, user, music)"]
        SR2["JSON Store
(data/store_{pid}.json)"]
        SR3["Supabase Pool
(nếu cấu hình)"]
        SR4["Sticker Catalog
(cache 30 phút)"]
        SR5["Font Registry
(8 family)"]
    end

    subgraph PanelManager["Bot Manager (panel/botManager.js)"]
        PM1["Spawn
(node JohnTran.js)"]
        PM2["Stop (SIGTERM)"]
        PM3["Restart
(graceful)"]
        PM4["Logs Stream
(stdout/stderr)"]
        PM5["QR Code
(hiển thị)"]
        PM6["Health Check
(/health ping)"]
        PM7["Watchdog
(crash-loop > 3)"]
        PM8["Auto-Restart
(khi crash)"]
        PM9["Metrics Collect
(cpu, mem, uptime)"]
    end

    EventLoop -->|spawns| Bot1
    EventLoop -->|spawns| Bot2
    EventLoop -->|spawns| BotN

    Bot1 --> SR1 & SR2 & SR3 & SR4 & SR5
    Bot2 --> SR1 & SR2 & SR3 & SR4 & SR5
    BotN --> SR1 & SR2 & SR3 & SR4 & SR5

    PanelManager --> PM1 & PM2 & PM3 & PM4 & PM5 & PM6 & PM7 & PM8 & PM9
    PanelManager -.->|quản lý| Bot1
    PanelManager -.->|quản lý| Bot2
    PanelManager -.->|quản lý| BotN

    classDef main fill:#e3f2fd,stroke:#1976d2;
    classDef bot fill:#e8f5e9,stroke:#388e3c;
    classDef shared fill:#fff3e0,stroke:#f57c00;
    classDef mgr fill:#fce4ec,stroke:#c2185b;

    class EventLoop,WorkerThreads main
    class Bot1,Bot2,BotN,B1Main,B1Handle,B1Canvas,B1Music,B2Main,B2Handle,B2Canvas,B2Music,BNMain,BNHandle,BNCanvas,BNMusic bot
    class SR1,SR2,SR3,SR4,SR5 shared
    class PM1,PM2,PM3,PM4,PM5,PM6,PM7,PM8,PM9,PanelManager mgr
```

## 6. Refactoring Summary

Dưới đây là tóm tắt các thay đổi refactoring đã thực hiện đối với mã nguồn JOHNTRAN-JS:

### 6.1 package.json
- `main`: `dist/index.js` → `index.js`
- `start`: `node dist/index.js` → `node index.js`
- `dev`: `ts-node src/index.ts` → `nodemon JohnTran.js`
- `start:prod`: `NODE_ENV=production node dist/index.js` → `NODE_ENV=production node JohnTran.js`
- Xóa script `build: tsc`
- Xóa `typescript` và `ts-node` khỏi `devDependencies`
- Entry point hiện là CommonJS: `index.js` (supervisor) → `JohnTran.js` (bot)

### 6.2 .gitignore
- Thêm các runtime artifacts vào danh sách bỏ qua: `core/assets/cache/`, `*.session`, `*.tmp`, `*.scratch`

### 6.3 Xóa file rác
- `core/music/index.js.bak`
- `scripts/benchmark.py`
- `write_bench.py`
- `deploy/edge/*.py` (4 file)
- `scripts/__dbg.js`
- `scripts/_smoke_monitor.js`
- `scripts/_fix-sticker.js`
- `fix.js`

### 6.4 core/loader/pluginDeps.js (mới)
- Tạo module chia sẻ cho cài đặt dependency của plugin
- Xuất: `extractDependencies`, `installMissingDeps`, `SUSPICIOUS_DEP`, `DEP_PAIR`

### 6.5 core/loader/loaderCommand.js
- Xóa code trùng lặp `extractDependencies`, `SUSPICIOUS_DEP`, `DEP_PAIR`
- Nhập từ `./pluginDeps`

### 6.6 core/loader/loaderEvent.js
- Xóa code trùng lặp `extractDependencies`, `SUSPICIOUS_DEP`, `DEP_PAIR`
- Nhập từ `./pluginDeps`

### 6.7 core/cache/lru.js (mới)
- Tách lớp `LRUCache` và hàm `createCache` ra module riêng

### 6.8 core/cache.js
- Nhập `{ LRUCache, createCache }` từ `./lru` và re-export tất cả
- Giữ nguyên tất cả cache instances và hàm cleanup

### 6.9 utils/ (chia utils/index.js 455 dòng thành 5 module + index re-export 35 dòng)
- `utils/file.js` - `saveBase64Image`, `getJsonData`, `tryUnlink`
- `utils/config.js` - `updateConfigArray`, `reloadConfig`
- `utils/messageCache.js` - message cache (RAM + debounce disk)
- `utils/media.js` - `processVideo`, `processAudio`, `extractThumbnail`, `uploadFile`, v.v.
- `utils/qr.js` - `decodeQRFromBase64`, `generateQRCodeInTerminal`, `displayQRCodeInConsole`
- `utils/index.js` - re-export từ 5 module trên + hàm `convertTimestamp` giữ nguyên inline

## 7. Target File Structure

```text
JOHNTRAN-JS/
├── index.js                      # Supervisor (entry point, CommonJS)
│                                  # Chế độ panel: khởi động PanelServer + BotManager
│                                  # Chế độ bot đơn: spawn JohnTran.js
├── JohnTran.js                   # Bot entry (được spawn bởi index.js)
│                                  # Login, loader, listener, panelBridge, stats
├── package.json                  # main: index.js; start: node index.js
│                                  # dev: nodemon JohnTran.js
│                                  # start:prod: NODE_ENV=production node JohnTran.js
│                                  # Không có build: tsc, không có typescript/ts-node
├── .gitignore                    # + core/assets/cache/, *.session, *.tmp, *.scratch
├── config.yml
├── .env.example
├── account.json
├── cookie.json
├── qr.png
├── tsconfig.json                 # Giữ lại (không dùng cho build)
├── nodemon.json
├── Dockerfile
├── Dockerfile.prod
├── docker-compose.prod.yml
├── render.yaml
├── core/
│   ├── bootstrap.js              # Khôi phục account/cookie/env
│   ├── cache.js                  # Import từ ./cache/lru, re-export tất cả,
│   │                               giữ instances + cleanup (threadCache, userCache, …)
│   ├── cache/
│   │   └── lru.js                # LRUCache class + createCache (đã tách ra)
│   ├── config/                   # Cấu hình hệ thống
│   ├── controller/
│   │   ├── controllerUsers.js    # Users Controller (get/set/all)
│   │   └── controllerThreads.js  # Threads Controller (get/set/all)
│   ├── handle/                   # Command pipeline (resolve, anti-spam, permission, cooldown, execute)
│   ├── health.js                 # Health Server (/health)
│   ├── hotReload.js              # Hot Reload Watcher
│   ├── listen.js                 # Zalo WebSocket listener
│   ├── login.js                  # Đăng nhập Zalo
│   ├── message.js                # Message Helper (reply, card, reaction)
│   ├── metrics.js                # Metrics + Audit Log
│   ├── monitoring.js             # Giám sát hệ thống
│   ├── panelBridge.js            # Cầu nói panel (chat Zalo thu nhỏ, localhost)
│   ├── stats.js                  # Thu thập thống kê bot
│   ├── videoMeta.js              # Thông tin video
│   ├── workerPool.js             # Quản lý worker pool
│   ├── ai/                       # AI Module (Gemini TTS /noi)
│   ├── canvas/                   # Canvas Renderer (theme, vip, menu, music)
│   ├── commands/                 # Lệnh nội bộ core
│   ├── http/                     # HTTP Client (retry, timeout, privacy guard)
│   ├── lazyLoader.js             # Preload heavy modules nền
│   ├── mediaCache.js             # Media cache
│   ├── mediaDownloader.js        # Media Downloader (meta + endpoint)
│   ├── mediaReply.js             # Trả lời media
│   ├── mentions.js               # Xử lý mentions
│   ├── music/                    # Music Registry (Track + SoundCloud + Lyrics)
│   ├── pixelfx/                  # Hiệu ứng pixel
│   ├── services.js               # Services Config
│   ├── socialFetch.js            # Lấy dữ liệu mạng xã hội
│   ├── socialInfo.js             # Thông tin mạng xã hội
│   ├── stickerConvert.js         # Chuyển đổi sticker
│   ├── stickerCreate.js          # Tạo sticker
│   ├── stickerFactory.js         # Xưởng sticker
│   ├── stickerFrames.js          # Khung sticker
│   ├── stickerStore.js           # Sticker Store (effectId > 0)
│   ├── storage/                  # Storage Abstraction (JSON local + Supabase)
│   ├── styled.js                 # Định dạng estil
│   ├── tiktok.js                 # TikTok API
│   ├── workers/                  # Worker threads
│   └── assets/
│       └── cache/                # Runtime cache (bị gitignore)
│   └── loader/
│       ├── loaderCommand.js      # Command Loader (import từ ./pluginDeps)
│       ├── loaderEvent.js        # Event Loader (import từ ./pluginDeps)
│       └── pluginDeps.js         # extractDependencies, installMissingDeps,
│                                  # SUSPICIOUS_DEP, DEP_PAIR (chia sẻ)
├── core/assets/cache/            # Bị gitignore - runtime artifacts
├── panel/
│   ├── botManager.js             # Bot Manager (spawn/stop/restart/logs/QR/watchdog)
│   └── server/                   # Panel API Server (zero-dep, không Express)
├── plugins/
│   ├── commands/                 # 23 lệnh (scl, lyric, noi, stats, menu, …)
│   └── events/                   # Đã bỏ v3 (pure command-based bot)
├── utils/
│   ├── index.js                  # 35 dòng, re-export từ 5 module + convertTimestamp inline
│   ├── file.js                   # saveBase64Image, getJsonData, tryUnlink
│   ├── config.js                 # updateConfigArray, reloadConfig
│   ├── messageCache.js           # Message cache (RAM + debounce disk)
│   ├── media.js                  # processVideo, processAudio, extractThumbnail,
│   │                               uploadFile, convertDurationToFiveDigits, convertMp3ToAac
│   ├── qr.js                     # decodeQRFromBase64, generateQRCodeInTerminal,
│   │                               displayQRCodeInConsole
│   ├── logger.js                 # Ghi log hệ thống
│   ├── db.js                     # Kết nối database
│   └── batchDb.js                # Ghi batch database
├── assets/
│   ├── spam/*.txt                # (vi, en, zh, ja, ko, th, mix)
│   ├── autosend.json
│   ├── girl.json
│   ├── vdgirl.json
│   ├── bg/theme.jpg
│   └── fonts/                    # 8 family
├── data/
│   ├── store.json                # JSON atomic store
│   ├── audit.log
│   └── cache/
├── scripts/
├── test/
├── deploy/
├── docs/
├── reference-images/
├── khung-stk/
├── native/
├── vendor/
│   └── zalo-client/
├── bots/
├── .tmp/                         # Bị gitignore
└── .tmpscratch/                  # Bị gitignore
```

Luồng khởi động: `npm start` → `index.js` (supervisor) → spawn `JohnTran.js` (bot entry). Trong chế độ panel, `index.js` khởi động `PanelServer` và `BotManager` thay vì spawn bot trực tiếp.
