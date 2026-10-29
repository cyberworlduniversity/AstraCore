-- AstraCore Steps 12-15: 384D pgvector + hybrid keyword/vector retrieval.
create index if not exists astracore_knowledge_chunks_embedding_hnsw_idx
  on public.astracore_knowledge_chunks using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

create or replace function public.search_astracore_knowledge(
  search_query text,
  query_embedding extensions.vector default null,
  result_limit integer default 8
)
returns table(chunk_id uuid, document_id uuid, title text, source text, url text, chunk_index integer, content text, keyword_score real, semantic_score real, combined_score real)
language sql stable
set search_path=pg_catalog,public,extensions,auth
as $$
with k as (
  select c.id chunk_id,c.document_id,d.title,d.source,d.url,c.chunk_index,c.content,
    ts_rank(to_tsvector('simple',c.content),websearch_to_tsquery('simple',coalesce(search_query,''))) keyword_score
  from public.astracore_knowledge_chunks c
  join public.astracore_knowledge_documents d on d.id=c.document_id
  where c.user_id=(select auth.uid()) and coalesce(search_query,'')<>''
    and to_tsvector('simple',c.content) @@ websearch_to_tsquery('simple',search_query)
  order by keyword_score desc limit greatest(result_limit*4,32)
),
s as (
  select c.id chunk_id,1-(c.embedding <=> query_embedding) semantic_score
  from public.astracore_knowledge_chunks c
  where c.user_id=(select auth.uid()) and query_embedding is not null and c.embedding is not null
  order by c.embedding <=> query_embedding limit greatest(result_limit*4,32)
),
x as (
  select coalesce(k.chunk_id,s.chunk_id) chunk_id,c.document_id,d.title,d.source,d.url,c.chunk_index,c.content,
    coalesce(k.keyword_score,0)::real keyword_score,coalesce(s.semantic_score,0)::real semantic_score
  from k full outer join s using(chunk_id)
  join public.astracore_knowledge_chunks c on c.id=coalesce(k.chunk_id,s.chunk_id)
  join public.astracore_knowledge_documents d on d.id=c.document_id
)
select chunk_id,document_id,title,source,url,chunk_index,content,keyword_score,semantic_score,
  (keyword_score*.65+semantic_score*.35)::real combined_score
from x
order by combined_score desc,keyword_score desc,semantic_score desc
limit greatest(least(result_limit,20),1);
$$;

revoke all on function public.search_astracore_knowledge(text,extensions.vector,integer) from public;
grant execute on function public.search_astracore_knowledge(text,extensions.vector,integer) to authenticated;
