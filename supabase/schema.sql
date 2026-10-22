-- Run once in your OWN Supabase project's SQL Editor. No personal data or secrets belong here.
create table if not exists public.shixu_entries (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  payload jsonb not null,
  updated_at timestamptz not null,
  primary key (user_id, id)
);
alter table public.shixu_entries enable row level security;
drop policy if exists "Own entries only" on public.shixu_entries;
create policy "Own entries only" on public.shixu_entries for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.shixu_entries to authenticated;
revoke all on public.shixu_entries from anon;

create or replace function public.sync_entries(incoming jsonb)
returns table(payload jsonb) language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(incoming) <> 'array' or jsonb_array_length(incoming) > 10000 then raise exception 'Invalid entries'; end if;
  insert into public.shixu_entries as existing (user_id, id, payload, updated_at)
    select auth.uid(), item->>'id', item, (item->>'updatedAt')::timestamptz
    from jsonb_array_elements(incoming) as item
    where length(item->>'id') between 1 and 100
    and length(item::text) < 100000
  on conflict (user_id, id) do update set payload = excluded.payload, updated_at = excluded.updated_at
    where excluded.updated_at > existing.updated_at;
  return query select e.payload from public.shixu_entries e where e.user_id = auth.uid();
end;
$$;
revoke all on function public.sync_entries(jsonb) from public, anon;
grant execute on function public.sync_entries(jsonb) to authenticated;
