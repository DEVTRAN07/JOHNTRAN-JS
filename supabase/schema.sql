-- Schema cho JOHNTRAN Bot — chạy 1 lần trong Supabase SQL Editor
-- Bot chỉ cần service_role key (điền vào env SUPABASE_SERVICE_KEY trên Koyeb)

-- Bảng settings của nhóm (prefix, anti_*, auto_down, auto_send, ban...)
create table if not exists bot_threads (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Bảng dữ liệu user (ban, lịch sử AI...)
create table if not exists bot_users (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Bảng metrics theo ngày
create table if not exists bot_metrics (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Cache media metadata (được SupabaseStore.TABLE_MAP quản lý).
create table if not exists bot_media_cache (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Index sắp theo thời gian cập nhật (cho audit/cleanup sau này)
create index if not exists bot_threads_updated_idx on bot_threads (updated_at desc);
create index if not exists bot_users_updated_idx on bot_users (updated_at desc);

-- Bật RLS: service_role mặc định bỏ qua RLS nên bot vẫn đọc/ghi được,
-- trong khi anon key (nếu lỡ dùng) sẽ bị chặn hoàn toàn
alter table bot_threads enable row level security;
alter table bot_users enable row level security;
alter table bot_metrics enable row level security;

-- Bảng thống kê bot con (panel quản lý đọc)
create table if not exists bot_stats (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table bot_stats enable row level security;
alter table bot_media_cache enable row level security;

-- Backend JOHNTRAN-JS dùng service-role key ở server; không cấp quyền
-- đọc/ghi cho anon hoặc authenticated client.
grant usage on schema public to service_role;
grant all privileges on table
  public.bot_threads,
  public.bot_users,
  public.bot_metrics,
  public.bot_stats,
  public.bot_media_cache
to service_role;

