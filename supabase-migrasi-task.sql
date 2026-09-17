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
