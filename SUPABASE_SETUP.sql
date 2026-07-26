-- ============================================================
-- ATLAS（筋トレアプリ）クラウド同期用テーブル
-- Supabase の SQL Editor に丸ごと貼り付けて Run するだけ。
-- ============================================================

-- 1) 記録を丸ごと1行で保存するテーブル（1ユーザー=1行）
create table if not exists public.gym_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  payload    jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2) 行レベルセキュリティ（自分の行だけ読み書きできる＝他人の記録は一切見えない）
alter table public.gym_state enable row level security;

drop policy if exists "own row select" on public.gym_state;
drop policy if exists "own row insert" on public.gym_state;
drop policy if exists "own row update" on public.gym_state;

create policy "own row select" on public.gym_state
  for select using (auth.uid() = user_id);

create policy "own row insert" on public.gym_state
  for insert with check (auth.uid() = user_id);

create policy "own row update" on public.gym_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
