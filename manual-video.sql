create table public.manju_manual_videos (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  inputs jsonb not null,
  state text not null default 'pending' check (state in ('pending','ready','failed')),
  output_path text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((state = 'ready') = (output_path is not null))
);
alter table public.manju_manual_videos enable row level security;
revoke all on public.manju_manual_videos from public, anon, authenticated;
grant select, insert, update on public.manju_manual_videos to service_role;
create unique index manju_manual_video_one_pending
  on public.manju_manual_videos(owner_id) where state = 'pending';
create index manju_manual_video_queue
  on public.manju_manual_videos(created_at) where state = 'pending';

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('manju-manual-videos','manju-manual-videos',false,41943040,array['video/mp4']);
