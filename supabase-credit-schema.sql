create schema if not exists manju_private;
revoke all on schema manju_private from public, anon, authenticated;
grant usage on schema manju_private to service_role;

create table manju_private.wallets (
  uid uuid primary key references auth.users(id) on delete restrict,
  units bigint not null default 0 check (units >= 0),
  has_recharged boolean not null default false
);
create table manju_private.generations (
  id uuid primary key,
  uid uuid not null references manju_private.wallets(uid),
  units integer not null check (units > 0),
  state text not null default 'reserved' check (state in ('reserved','completed','refunded')),
  created_at timestamptz not null default now()
);
create table manju_private.payments (
  channel text not null check (channel in ('wechat','alipay')),
  transaction_id text not null,
  uid uuid not null references manju_private.wallets(uid),
  administrator uuid not null,
  package_id text not null,
  amount_fen integer not null check (amount_fen > 0),
  units integer not null check (units > 0),
  created_at timestamptz not null default now(),
  primary key (channel, transaction_id)
);
alter table manju_private.wallets enable row level security;
alter table manju_private.generations enable row level security;
alter table manju_private.payments enable row level security;
grant select, insert, update on all tables in schema manju_private to service_role;

create function public.manju_wallet(p_uid uuid)
returns jsonb language sql security invoker set search_path = ''
as $$
  select coalesce((select jsonb_build_object('balance', units / 10.0, 'firstRecharge', not has_recharged)
  from manju_private.wallets where uid = p_uid), '{"balance":0,"firstRecharge":true}'::jsonb);
$$;

create function public.manju_reserve(p_uid uuid, p_id uuid, p_units integer)
returns boolean language plpgsql security invoker set search_path = ''
as $$
begin
  if p_units is null or p_units <= 0 then raise exception 'Invalid cost'; end if;
  update manju_private.wallets set units = units - p_units where uid = p_uid and units >= p_units;
  if not found then return false; end if;
  insert into manju_private.generations(id, uid, units) values (p_id, p_uid, p_units);
  return true;
end;
$$;

create function public.manju_settle(p_id uuid, p_success boolean)
returns void language plpgsql security invoker set search_path = ''
as $$
declare entry manju_private.generations%rowtype;
begin
  update manju_private.generations set state = case when p_success then 'completed' else 'refunded' end
  where id = p_id and state = 'reserved' returning * into entry;
  if found and not p_success then
    update manju_private.wallets set units = units + entry.units where uid = entry.uid;
  end if;
end;
$$;

create function public.manju_topup(p_uid uuid, p_admin uuid, p_channel text, p_transaction text,
  p_package text, p_amount integer, p_units integer, p_first boolean)
returns text language plpgsql security invoker set search_path = ''
as $$
declare entry manju_private.payments%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_channel || ':' || p_transaction));
  select * into entry from manju_private.payments where channel = p_channel and transaction_id = p_transaction;
  if found then
    if entry.uid = p_uid and entry.package_id = p_package and entry.amount_fen = p_amount then return 'duplicate'; end if;
    return 'conflict';
  end if;
  insert into manju_private.wallets(uid) values (p_uid) on conflict do nothing;
  update manju_private.wallets set units = units + p_units, has_recharged = true
    where uid = p_uid and (not p_first or not has_recharged);
  if not found then return 'first_used'; end if;
  insert into manju_private.payments values (p_channel, p_transaction, p_uid, p_admin, p_package, p_amount, p_units, default);
  return 'credited';
exception when foreign_key_violation then
  return 'invalid_user';
end;
$$;

revoke execute on function public.manju_wallet(uuid), public.manju_reserve(uuid,uuid,integer),
  public.manju_settle(uuid,boolean), public.manju_topup(uuid,uuid,text,text,text,integer,integer,boolean)
  from public, anon, authenticated;
grant execute on function public.manju_wallet(uuid), public.manju_reserve(uuid,uuid,integer),
  public.manju_settle(uuid,boolean), public.manju_topup(uuid,uuid,text,text,text,integer,integer,boolean)
  to service_role;
