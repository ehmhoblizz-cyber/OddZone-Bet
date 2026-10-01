-- Diagnostics: what actually exists in the live database right now?
select
  table_schema,
  table_name
from information_schema.tables
where table_schema not in ('pg_catalog','information_schema')
order by table_schema, table_name;
