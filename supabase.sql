create table subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);
create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  text text not null,
  due date,
  done boolean not null default false,
  pri text not null default 'mid' check (pri in ('low','mid','high')),
  created_at timestamptz default now()
);
alter table subjects enable row level security;
alter table tasks enable row level security;
create policy "own subjects" on subjects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own tasks" on tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);