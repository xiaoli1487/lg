create table manju_private.credit_gifts (
  id uuid primary key,
  uid uuid not null references auth.users(id) on delete restrict,
  administrator uuid not null,
  units integer not null check (units > 0),
  note text not null check (char_length(btrim(note)) between 1 and 200),
  created_at timestamptz not null default now()
);

alter table manju_private.credit_gifts enable row level security;
grant select, insert on manju_private.credit_gifts to service_role;

create function public.manju_gift(p_id uuid, p_uid uuid, p_admin uuid, p_units integer, p_note text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing manju_private.credit_gifts%rowtype;
begin
  insert into manju_private.credit_gifts(id, uid, administrator, units, note)
    values (p_id, p_uid, p_admin, p_units, p_note)
    on conflict (id) do nothing;

  if not found then
    select * into existing from manju_private.credit_gifts where id = p_id;
    if (existing.uid, existing.administrator, existing.units, existing.note) =
       (p_uid, p_admin, p_units, p_note) then
      return 'duplicate';
    end if;
    return 'conflict';
  end if;

  insert into manju_private.wallets as wallet(uid, units) values (p_uid, p_units)
    on conflict (uid) do update set units = wallet.units + excluded.units;
  return 'credited';
exception when foreign_key_violation then
  return 'invalid_user';
end;
$$;

revoke execute on function public.manju_gift(uuid,uuid,uuid,integer,text) from public, anon, authenticated;
grant execute on function public.manju_gift(uuid,uuid,uuid,integer,text) to service_role;
