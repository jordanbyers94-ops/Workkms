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
  rate_per_km   numeric(5,2) not null default 0.88
);
insert into settings (id) values (1) on conflict do nothing;
