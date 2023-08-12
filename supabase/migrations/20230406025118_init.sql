-- Enable pgvector extension
create extension if not exists vector with schema public;

-- Create tables 
create table "public"."nods_page" (
  id bigserial primary key,
  parent_page_id bigint references public.nods_page,
  path text not null unique,
  checksum text,
  meta jsonb,
  type text,
  source text
  -- TODO: test this
  -- project_id bigint not null references public.projects on delete cascade
);
alter table "public"."nods_page" enable row level security;

create table "public"."nods_page_section" (
  id bigserial primary key,
  page_id bigint not null references public.nods_page on delete cascade,
  content text,
  token_count int,
  embedding vector(1536),
  slug text,
  heading text
);
alter table "public"."nods_page_section" enable row level security;

-- TODO: test this
-- create table "public"."projects" (
--   id bigserial primary key,
--   url text not null unique
-- )
-- alter table "public"."projects" enable row level security

-- Create embedding similarity search functions
create or replace function match_page_sections(embedding vector(1536), match_threshold float, match_count int, min_content_length int)
-- create or replace function match_page_sections(embedding vector(1536), match_threshold float, match_count int, min_content_length int, project_id bigint)
returns table (id bigint, page_id bigint, slug text, heading text, content text, similarity float)
language plpgsql
as $$
#variable_conflict use_variable
begin
  return query
  -- Selecting required fields from the nods_page_section table
  select
    nods_page_section.id,
    nods_page_section.page_id,
    nods_page_section.slug,
    nods_page_section.heading,
    nods_page_section.content,
    -- Calculating similarity between the input embedding and the stored embedding
    (nods_page_section.embedding <#> embedding) * -1 as similarity
  from nods_page_section

  -- We only care about sections that have a useful amount of content
  where length(nods_page_section.content) >= min_content_length

  -- Filtering out sections with similarity less than the match threshold
  -- The dot product is negative because of a Postgres limitation, so we negate it
  and (nods_page_section.embedding <#> embedding) * -1 > match_threshold

  -- TODO: test this
  -- Filter by project_id
  -- and nods_page_section.project_id = project_id

  -- OpenAI embeddings are normalized to length 1, so
  -- cosine similarity and dot product will produce the same results.
  -- Using dot product which can be computed slightly faster.
  --
  -- For the different syntaxes, see https://github.com/pgvector/pgvector
  order by nods_page_section.embedding <#> embedding
  
  limit match_count;
end;
$$;

create or replace function get_page_parents(page_id bigint)
returns table (id bigint, parent_page_id bigint, path text, meta jsonb)
language sql
as $$
  with recursive chain as (
    select *
    from nods_page 
    where id = page_id

    union all

    select child.*
      from nods_page as child
      join chain on chain.parent_page_id = child.id 
  )
  select id, parent_page_id, path, meta
  from chain;
$$;
