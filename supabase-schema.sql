-- ============================================================
-- Papan Marketing Crackling — skema Supabase
-- Jalankan SEKALI di: Supabase -> SQL Editor -> New query -> paste -> Run
-- ============================================================

-- ------------------------------------------------------------
-- 1. PROFIL & PERAN
--    Setiap akun login punya satu baris di sini yang menentukan
--    dia boleh melihat apa. Peran: owner | lead | ads | social
-- ------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'social' check (role in ('owner', 'lead', 'ads', 'social')),
  created_at timestamptz not null default now()
);

-- Fungsi bantu. SECURITY DEFINER penting: fungsi ini membaca tabel profiles
-- dengan melewati RLS, supaya aturan RLS yang memanggilnya tidak memanggil
-- dirinya sendiri tanpa henti.
create or replace function my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;

-- Boleh melihat angka uang (omzet, ringkasan) — hanya owner dan lead.
create or replace function sees_money()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from profiles where id = auth.uid()) in ('owner', 'lead'), false)
$$;

-- Boleh melihat data iklan — owner, lead, dan crew ads.
create or replace function sees_ads()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from profiles where id = auth.uid()) in ('owner', 'lead', 'ads'), false)
$$;

-- Boleh melihat data social media — owner, lead, dan crew social.
create or replace function sees_social()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from profiles where id = auth.uid()) in ('owner', 'lead', 'social'), false)
$$;

-- ------------------------------------------------------------
-- 2. DATA
-- ------------------------------------------------------------

-- Penjualan harian per cabang (ESB, Gojek/Grab, Paper)
create table sales_daily (
  entry_date date not null,
  branch text not null,                   -- 'gading_serpong' | 'kelapa_gading'
  esb numeric not null default 0,
  gojek_grab numeric not null default 0,
  paper numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (entry_date, branch)
);

-- Data iklan harian per channel.
-- Nama kolom mengikuti Meta Ads Manager supaya angkanya bisa disalin apa adanya.
-- CTR/CPC/CPM/CPA/ROAS tidak disimpan — dihitung di dashboard dari kolom ini.
create table ad_daily (
  entry_date date not null,
  channel text not null,                  -- 'meta' | 'tiktok' | 'kol'
  spend numeric not null default 0,       -- Amount spent
  impressions bigint not null default 0,  -- Impressions
  reach bigint not null default 0,        -- Reach
  clicks bigint not null default 0,       -- Link clicks
  results bigint not null default 0,      -- Results
  result_value numeric not null default 0,-- Conversion value
  updated_at timestamptz not null default now(),
  primary key (entry_date, channel)
);

-- Catatan promo / campaign yang jalan di tanggal tertentu
create table campaign_notes (
  entry_date date primary key,
  note text not null default '',
  updated_at timestamptz not null default now()
);

-- Budget iklan per bulan, format '2026-09'
create table monthly_budget (
  month text primary key,
  ad_budget numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- Angka social media harian
create table social_daily (
  entry_date date primary key,
  instagram integer not null default 0,
  tiktok integer not null default 0,
  threads integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Jadwal kerja. Setiap baris milik satu orang (user_id).
create table work_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  title text not null,
  scope text not null default 'pendek' check (scope in ('pendek', 'panjang')),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create index work_items_date_idx on work_items (work_date);
create index work_items_user_idx on work_items (user_id);

-- ------------------------------------------------------------
-- 3. ATURAN AKSES (Row Level Security)
--    Ini penguncian yang sebenarnya. Menyembunyikan menu di tampilan
--    tidak menghentikan siapa pun; aturan di bawah inilah yang menolak
--    permintaan data di tingkat database.
-- ------------------------------------------------------------
alter table profiles enable row level security;
alter table sales_daily enable row level security;
alter table ad_daily enable row level security;
alter table campaign_notes enable row level security;
alter table monthly_budget enable row level security;
alter table social_daily enable row level security;
alter table work_items enable row level security;

-- PROFIL: lihat profil sendiri; owner & lead lihat semua. Peran hanya bisa
-- diubah lewat SQL Editor (tidak ada policy update untuk pengguna biasa).
create policy "profil: lihat" on profiles for select
  using (id = auth.uid() or sees_money());

-- PENJUALAN: hanya owner & lead yang boleh MELIHAT.
-- Semua yang sudah login boleh MENGISI (input tanpa boleh lihat).
create policy "penjualan: lihat" on sales_daily for select using (sees_money());
create policy "penjualan: isi" on sales_daily for insert with check (auth.uid() is not null);
create policy "penjualan: ubah" on sales_daily for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- IKLAN: owner, lead, crew ads boleh melihat. Semua yang login boleh mengisi.
create policy "iklan: lihat" on ad_daily for select using (sees_ads());
create policy "iklan: isi" on ad_daily for insert with check (auth.uid() is not null);
create policy "iklan: ubah" on ad_daily for update using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "promo: lihat" on campaign_notes for select using (sees_ads());
create policy "promo: isi" on campaign_notes for insert with check (auth.uid() is not null);
create policy "promo: ubah" on campaign_notes for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- BUDGET: crew ads boleh melihat (itu pekerjaannya), tapi hanya owner & lead
-- yang boleh mengubah besarannya.
create policy "budget: lihat" on monthly_budget for select using (sees_ads());
create policy "budget: isi" on monthly_budget for insert with check (sees_money());
create policy "budget: ubah" on monthly_budget for update using (sees_money()) with check (sees_money());

-- SOCIAL MEDIA: owner, lead, crew social boleh melihat. Semua yang login boleh mengisi.
create policy "socmed: lihat" on social_daily for select using (sees_social());
create policy "socmed: isi" on social_daily for insert with check (auth.uid() is not null);
create policy "socmed: ubah" on social_daily for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- JADWAL KERJA: masing-masing hanya melihat dan mengubah miliknya sendiri.
-- Owner & lead melihat jadwal semua orang.
create policy "jadwal: lihat" on work_items for select
  using (user_id = auth.uid() or sees_money());
create policy "jadwal: isi" on work_items for insert
  with check (user_id = auth.uid());
create policy "jadwal: ubah" on work_items for update
  using (user_id = auth.uid() or sees_money());
create policy "jadwal: hapus" on work_items for delete
  using (user_id = auth.uid() or sees_money());

-- ------------------------------------------------------------
-- 4. SETELAH INI — BUAT AKUN
--
--    Tim login pakai USERNAME saja. Supabase tetap menyimpannya sebagai email,
--    jadi saat membuat akun tulis: username@crackling.id
--    Tidak ada email yang dikirim ke alamat itu; hanya label internal.
--
--    a. Authentication -> Users -> Add user
--       Email    : sulthan@crackling.id     (orangnya cukup mengetik "sulthan")
--       Password : bebas
--       CENTANG "Auto Confirm User" — kalau tidak, akunnya tidak bisa dipakai.
--
--    b. Tetapkan peran untuk tiap akun, satu perintah per orang:
--
--    insert into profiles (id, name, role)
--    select id, 'Eric', 'owner' from auth.users where email = 'eric@crackling.id';
--
--    insert into profiles (id, name, role)
--    select id, 'Sulthan', 'lead' from auth.users where email = 'sulthan@crackling.id';
--
--    Peran yang tersedia: 'owner', 'lead', 'ads', 'social'
--
--    Ganti peran seseorang:
--    update profiles set role = 'lead'
--    where id = (select id from auth.users where email = 'sulthan@crackling.id');
--
--    Lihat siapa saja yang sudah punya peran:
--    select p.name, p.role, u.email from profiles p join auth.users u on u.id = p.id;
-- ------------------------------------------------------------
