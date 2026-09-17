-- ============================================================
-- PERBAIKAN: struktur tabel targets
--
-- Tabel targets terlanjur dibuat dengan struktur lama (hanya per cabang).
-- Padahal target Crackling bentuknya campuran: dine-in dipecah per cabang,
-- sedangkan Gojek/Grab dan Paper digabung. Tabel dibuat ulang dengan
-- kunci (bulan, sumber, cabang), lalu langsung diisi angka dari owner.
--
-- Aman dijalankan: tabel lama masih kosong, tidak ada data yang hilang.
-- ============================================================

drop table if exists targets;

create table targets (
  month text not null,                          -- '2026-09'
  source text not null,                         -- 'esb' | 'gojek_grab' | 'paper'
  branch text not null default 'semua',         -- 'gading_serpong' | 'kelapa_gading' | 'semua'
  revenue_target numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (month, source, branch)
);

alter table targets enable row level security;

create policy "target: lihat" on targets for select using (sees_money());
create policy "target: isi" on targets for insert with check (sees_money());
create policy "target: ubah" on targets for update using (sees_money()) with check (sees_money());

-- Target bulan berjalan sesuai ketetapan owner:
-- Dine-in GS 300jt, Dine-in KG 200jt, Gojek/Grab 60jt, Paper 60jt.
insert into targets (month, source, branch, revenue_target) values
  (to_char(current_date, 'YYYY-MM'), 'esb',        'gading_serpong', 300000000),
  (to_char(current_date, 'YYYY-MM'), 'esb',        'kelapa_gading',  200000000),
  (to_char(current_date, 'YYYY-MM'), 'gojek_grab', 'semua',           60000000),
  (to_char(current_date, 'YYYY-MM'), 'paper',      'semua',           60000000);

-- Beri peran owner ke akun uji Claude, supaya bisa menguji jalur owner
-- sampai tuntas tanpa perlu password pribadimu.
insert into profiles (id, name, role)
select id, 'Tes Owner', 'owner' from auth.users where email = 'tesowner@crackling.id'
on conflict (id) do update set name = excluded.name, role = excluded.role;

-- Periksa hasilnya
select month, source, branch, revenue_target from targets order by source, branch;
select u.email as login, p.name as nama, p.role as peran
from profiles p join auth.users u on u.id = p.id order by p.role;
