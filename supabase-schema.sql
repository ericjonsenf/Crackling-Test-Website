-- Papan Harian Crackling — skema Supabase
-- Jalankan sekali di: Supabase project -> SQL Editor -> New query -> paste -> Run

-- 1. Penjualan harian per cabang (tiga sumber: ESB, Gojek/Grab, Paper)
create table sales_daily (
  entry_date date not null,
  branch text not null,              -- 'gading_serpong' | 'kelapa_gading'
  esb numeric not null default 0,
  gojek_grab numeric not null default 0,
  paper numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (entry_date, branch)
);

-- 2. Data iklan harian per channel.
--    Nama kolomnya mengikuti Meta Ads Manager supaya angkanya bisa disalin apa adanya.
--    CTR / CPC / CPM / CPA / ROAS tidak disimpan — dihitung di dashboard dari kolom ini.
create table ad_daily (
  entry_date date not null,
  channel text not null,                  -- 'meta' | 'tiktok' | 'kol'
  spend numeric not null default 0,       -- Amount spent
  impressions bigint not null default 0,  -- Impressions
  reach bigint not null default 0,        -- Reach
  clicks bigint not null default 0,       -- Link clicks
  results bigint not null default 0,      -- Results (konversi sesuai objective)
  result_value numeric not null default 0,-- Conversion value (untuk ROAS platform)
  updated_at timestamptz not null default now(),
  primary key (entry_date, channel)
);

-- Catatan promo / campaign yang jalan di tanggal tertentu (level brand)
create table campaign_notes (
  entry_date date primary key,
  note text not null default '',
  updated_at timestamptz not null default now()
);

-- 3. Budget iklan per bulan (untuk melihat pemakaian budget)
create table monthly_budget (
  month text primary key,            -- format '2026-09'
  ad_budget numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- 4. Angka social media harian
create table social_daily (
  entry_date date primary key,
  instagram integer not null default 0,
  tiktok integer not null default 0,
  threads integer not null default 0,
  updated_at timestamptz not null default now()
);

-- 5. Jadwal kerja — Sulthan isi sendiri: tanggal, pekerjaan, jangka pendek/panjang
create table work_items (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  title text not null,
  scope text not null default 'pendek',   -- 'pendek' | 'panjang'
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create index work_items_date_idx on work_items (work_date);

-- Akses: dashboard dipakai lewat anon key, jadi izinkan baca/tulis.
-- Cukup untuk alat internal di balik link privat; bisa diperketat nanti kalau perlu login.
alter table sales_daily enable row level security;
alter table ad_daily enable row level security;
alter table campaign_notes enable row level security;
alter table monthly_budget enable row level security;
alter table social_daily enable row level security;
alter table work_items enable row level security;

create policy "anon rw sales_daily" on sales_daily for all using (true) with check (true);
create policy "anon rw ad_daily" on ad_daily for all using (true) with check (true);
create policy "anon rw campaign_notes" on campaign_notes for all using (true) with check (true);
create policy "anon rw monthly_budget" on monthly_budget for all using (true) with check (true);
create policy "anon rw social_daily" on social_daily for all using (true) with check (true);
create policy "anon rw work_items" on work_items for all using (true) with check (true);
