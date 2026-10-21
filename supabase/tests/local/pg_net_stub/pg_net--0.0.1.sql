create schema net;
create table net.http_request_queue (
  id bigserial primary key,
  method text not null,
  url text not null,
  headers jsonb,
  body jsonb,
  timeout_milliseconds integer,
  created_at timestamptz not null default now()
);
create function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint language sql as $$
  insert into net.http_request_queue (method, url, headers, body, timeout_milliseconds)
  values ('POST', url, headers, body, timeout_milliseconds)
  returning id
$$;
grant usage on schema net to postgres, service_role;
grant execute on all functions in schema net to postgres, service_role;
grant select on net.http_request_queue to postgres;
