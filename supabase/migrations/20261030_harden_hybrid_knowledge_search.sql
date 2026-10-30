create or replace function public.search_astracore_knowledge(search_query text, query_embedding extensions.vector default null, result_limit integer default 8)
returns table(chunk_id uuid, document_id uuid, title text, source text, url text, chunk_index integer, content text, keyword_score real, semantic_score real, combined_score real)
language sql stable security invoker set search_path = public, extensions as $$
  with keyword_hits as (
    select c.id chunk_id,c.document_id,d.title,d.source,d.url,c.chunk_index,c.content,
      ts_rank(to_tsvector('simple',c.content),websearch_to_tsquery('simple',search_query)) keyword_score
    from public.astracore_knowledge_chunks c join public.astracore_knowledge_documents d on d.id=c.document_id
    where c.user_id=(select auth.uid()) and to_tsvector('simple',c.content) @@ websearch_to_tsquery('simple',search_query)
    order by keyword_score desc limit greatest(result_limit*4,32)
  ), semantic_hits as (
    select c.id chunk_id,c.document_id,d.title,d.source,d.url,c.chunk_index,c.content,
      1-(c.embedding <=> query_embedding) semantic_score
    from public.astracore_knowledge_chunks c join public.astracore_knowledge_documents d on d.id=c.document_id
    where c.user_id=(select auth.uid()) and query_embedding is not null and c.embedding is not null
    order by c.embedding <=> query_embedding limit greatest(result_limit*4,32)
  ), combined as (
    select coalesce(k.chunk_id,s.chunk_id) chunk_id,coalesce(k.document_id,s.document_id) document_id,
      coalesce(k.title,s.title) title,coalesce(k.source,s.source) source,coalesce(k.url,s.url) url,
      coalesce(k.chunk_index,s.chunk_index) chunk_index,coalesce(k.content,s.content) content,
      coalesce(k.keyword_score,0)::real keyword_score,coalesce(s.semantic_score,0)::real semantic_score
    from keyword_hits k full outer join semantic_hits s using(chunk_id)
  )
  select chunk_id,document_id,title,source,url,chunk_index,content,keyword_score,semantic_score,
    (keyword_score*0.65+semantic_score*0.35)::real combined_score
  from combined order by combined_score desc,keyword_score desc,semantic_score desc
  limit greatest(1,least(result_limit,20));
$$;
revoke all on function public.search_astracore_knowledge(text,extensions.vector,integer) from public;
grant execute on function public.search_astracore_knowledge(text,extensions.vector,integer) to authenticated;
