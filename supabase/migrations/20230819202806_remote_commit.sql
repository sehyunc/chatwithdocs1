create sequence "public"."projects_id_seq";

drop function if exists "public"."match_page_sections"(embedding vector, match_threshold double precision, match_count integer, min_content_length integer);

create table "public"."projects" (
    "id" bigint not null default nextval('projects_id_seq'::regclass),
    "name" text not null
);


alter table "public"."projects" enable row level security;

alter table "public"."nods_page" add column "project_id" bigint not null;

alter sequence "public"."projects_id_seq" owned by "public"."projects"."id";

CREATE UNIQUE INDEX projects_name_key ON public.projects USING btree (name);

CREATE UNIQUE INDEX projects_pkey ON public.projects USING btree (id);

alter table "public"."projects" add constraint "projects_pkey" PRIMARY KEY using index "projects_pkey";

alter table "public"."nods_page" add constraint "nods_page_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE not valid;

alter table "public"."nods_page" validate constraint "nods_page_project_id_fkey";

alter table "public"."projects" add constraint "projects_name_key" UNIQUE using index "projects_name_key";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.match_page_sections(embedding vector, match_threshold double precision, match_count integer, min_content_length integer, project_id_input bigint)
 RETURNS TABLE(id bigint, page_id bigint, slug text, heading text, content text, similarity double precision)
 LANGUAGE plpgsql
AS $function$
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
  -- JOIN with nods_page to filter by project_id
  JOIN nods_page ON nods_page_section.page_id = nods_page.id
  WHERE nods_page.project_id = project_id_input

     -- We only care about sections that have a useful amount of content
and length(nods_page_section.content) >= min_content_length

  -- Filtering out sections with similarity less than the match threshold
  -- The dot product is negative because of a Postgres limitation, so we negate it
  and (nods_page_section.embedding <#> embedding) * -1 > match_threshold

  -- OpenAI embeddings are normalized to length 1, so
  -- cosine similarity and dot product will produce the same results.
  -- Using dot product which can be computed slightly faster.
  --
  -- For the different syntaxes, see https://github.com/pgvector/pgvector
order by nods_page_section.embedding <#> embedding

    limit match_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_page_parents(page_id bigint)
 RETURNS TABLE(id bigint, parent_page_id bigint, path text, meta jsonb)
 LANGUAGE sql
AS $function$
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
$function$
;


