-- Runs on every server start. Safe to re-run.

create table if not exists staff (
  id             uuid primary key default gen_random_uuid(),
  full_name      text not null,
  staff_code     text not null unique,
  role           text not null default 'tech' check (role in ('tech','admin')),
  secret_hash    text not null,
  active         boolean not null default true,
  token_version  int not null default 0,       -- bump to sign someone out everywhere
  failed_logins  int not null default 0,
  locked_until   timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists vehicles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  rego        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists trips (
  id          uuid primary key,                 -- generated on the phone so offline saves never duplicate
  user_id     uuid not null references staff(id),
  vehicle_id  uuid references vehicles(id),
  trip_date   date not null,
  started_at  timestamptz,
  ended_at    timestamptz,
  km          numeric(8,1) not null check (km >= 0 and km < 3000),
  start_odo   numeric(9,1),
  end_odo     numeric(9,1),
  source      text not null check (source in ('gps','odometer','manual')),
  gps_km      numeric(8,1),                     -- what GPS measured; never changes after first upload
  from_text   text,
  to_text     text,
  job_no      text,
  purpose     text,
  start_lat   double precision,
  start_lng   double precision,
  end_lat     double precision,
  end_lng     double precision,
  deleted     boolean not null default false,   -- soft delete; the office keeps the record
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists trips_user_date on trips (user_id, trip_date);
create index if not exists trips_date on trips (trip_date);

create table if not exists settings (
  id            int primary key default 1 check (id = 1),
  company_name  text not null default 'Aus Air Electrical',
  rate_per_km   numeric(5,2) not null default 0.91
);
insert into settings (id) values (1) on conflict do nothing;

-- ---------- ATO logbook additions (safe to re-run on an existing database) ----------

-- Cars belong to the tech who drives them (techs use their own cars).
alter table vehicles add column if not exists owner_id  uuid references staff(id);
alter table vehicles add column if not exists make      text;
alter table vehicles add column if not exists model     text;
alter table vehicles add column if not exists engine    text;            -- engine capacity, e.g. "2.8L" or "2755cc"
alter table vehicles add column if not exists is_car    boolean not null default true;  -- false = 1 tonne+ payload or 9+ seats
create index if not exists vehicles_owner on vehicles (owner_id);

-- Every journey: business or private, start/end date, start/end odometer
alter table trips add column if not exists trip_type text not null default 'business';
alter table trips add column if not exists end_date  date;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trips_trip_type_check') then
    alter table trips add constraint trips_trip_type_check check (trip_type in ('business','private'));
  end if;
end $$;
create index if not exists trips_vehicle on trips (vehicle_id, start_odo);

-- A logbook period (ATO: at least 12 continuous weeks) for one of the tech's cars
create table if not exists logbooks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references staff(id),
  vehicle_id  uuid not null references vehicles(id),
  start_date  date not null,
  start_odo   numeric(9,1) not null,
  end_date    date,
  end_odo     numeric(9,1),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists logbooks_user on logbooks (user_id);

-- Odometer readings outside trips: 30 June each year the logbook is relied on, etc.
create table if not exists odo_readings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references staff(id),
  vehicle_id    uuid not null references vehicles(id),
  reading_date  date not null,
  odo           numeric(9,1) not null,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists odo_readings_vehicle on odo_readings (vehicle_id, reading_date);

alter table settings add column if not exists ato_rate numeric(5,2) not null default 0.91;
