-- ============================================================
-- Migrasi: Jadwal kerja -> Task (dengan PIC, pemberi tugas, deadline)
-- Jalankan di: Supabase -> SQL Editor -> New query -> paste -> Run
-- ============================================================

-- 1. Semua orang yang sudah login boleh melihat daftar nama rekan setim.
--    Dibutuhkan supaya bisa memilih PIC saat membuat task.
--    Nama dan peran bukan data sensitif — yang dijaga tetap angka penjualan.
drop policy if exists "profil: lihat" on profiles;
create policy "profil: lihat" on profiles for select
  using (auth.uid() is not null);

-- 2. Tabel task menggantikan work_items
create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  detail text default '',
  assignee_id uuid references auth.users(id) on delete set null,  -- PIC, dikerjakan siapa
  created_by uuid references auth.users(id) on delete set null,   -- yang memberi tugas
  deadline date not null,                                          -- batas waktu, tampil di kalender
  scope text not null default 'pendek' check (scope in ('pendek', 'panjang')),
  status text not null default 'todo' check (status in ('todo', 'progress', 'done')),
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create index tasks_deadline_idx on tasks (deadline);
create index tasks_assignee_idx on tasks (assignee_id);

alter table tasks enable row level security;

-- Lihat: task yang jadi tanggung jawabmu, yang kamu berikan ke orang lain,
-- atau semuanya kalau kamu owner/lead.
create policy "task: lihat" on tasks for select
  using (assignee_id = auth.uid() or created_by = auth.uid() or sees_money());

-- Buat: siapa pun boleh memberi tugas, tapi tercatat atas namanya sendiri.
create policy "task: buat" on tasks for insert
  with check (created_by = auth.uid());

-- Ubah: PIC-nya, pemberi tugasnya, atau owner/lead.
create policy "task: ubah" on tasks for update
  using (assignee_id = auth.uid() or created_by = auth.uid() or sees_money());

-- Hapus: hanya pemberi tugas atau owner/lead. PIC tidak boleh menghapus
-- tugas yang diberikan kepadanya.
create policy "task: hapus" on tasks for delete
  using (created_by = auth.uid() or sees_money());

-- 3. Pindahkan data lama kalau ada, lalu buang tabel lamanya
insert into tasks (title, assignee_id, created_by, deadline, scope, status)
select title, user_id, user_id, work_date, scope,
       case when done then 'done' else 'todo' end
from work_items;

drop table work_items;

-- 4. Pastikan hasilnya
select t.title, t.deadline, t.status, t.scope,
       pa.name as pic, pc.name as pemberi
from tasks t
left join profiles pa on pa.id = t.assignee_id
left join profiles pc on pc.id = t.created_by
order by t.deadline;


-- ============================================================
-- 5. TARGET OMZET BULANAN
--    Bentuknya campuran, mengikuti cara Crackling menetapkan target:
--      - Dine-in (ESB) dipecah per cabang
--      - Gojek/Grab dan Paper targetnya total, tidak per cabang
--    Karena itu kolom branch memakai nilai 'semua' untuk yang tidak dipecah.
-- ============================================================
create table targets (
  month text not null,                          -- '2026-09'
  source text not null,                         -- 'esb' | 'gojek_grab' | 'paper'
  branch text not null default 'semua',         -- 'gading_serpong' | 'kelapa_gading' | 'semua'
  revenue_target numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (month, source, branch)
);

alter table targets enable row level security;

-- Target itu angka omzet, jadi hanya owner & lead yang boleh melihat
-- maupun mengubahnya.
create policy "target: lihat" on targets for select using (sees_money());
create policy "target: isi" on targets for insert with check (sees_money());
create policy "target: ubah" on targets for update using (sees_money()) with check (sees_money());

-- 6. Isi target bulan berjalan sesuai ketetapan owner:
--    Dine-in Gading Serpong 300jt, Dine-in Kelapa Gading 200jt,
--    Gojek/Grab 60jt, Paper 60jt. Total 620jt.
insert into targets (month, source, branch, revenue_target) values
  (to_char(current_date, 'YYYY-MM'), 'esb',        'gading_serpong', 300000000),
  (to_char(current_date, 'YYYY-MM'), 'esb',        'kelapa_gading',  200000000),
  (to_char(current_date, 'YYYY-MM'), 'gojek_grab', 'semua',           60000000),
  (to_char(current_date, 'YYYY-MM'), 'paper',      'semua',           60000000)
on conflict (month, source, branch) do update set revenue_target = excluded.revenue_target;

select month, source, branch, revenue_target from targets order by source, branch;
