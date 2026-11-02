const TABLES={
  users:{table:'astracore_users',select:'id,auth_user_id,email,name,provider,is_admin,created_at,updated_at',order:'created_at.desc',editable:['name'],deletable:false},
  models:{table:'astracore_model_registry',select:'id,name,role,checkpoint,status,key_configured,created_at,updated_at',order:'updated_at.desc',editable:['name','role','status'],deletable:false},
  model_versions:{table:'astracore_model_versions',select:'id,model_id,display_name,architecture,status,parameter_count,vocab_size,context_length,embedding_dimension,layers,attention_heads,feed_forward_dimension,checkpoint_path,validation_loss,test_loss,perplexity,device,training_seed,training_metadata,created_at,updated_at',order:'created_at.desc',editable:['display_name','status','training_metadata'],deletable:false},
  tools:{table:'astracore_tool_registry',select:'name,description,input_schema,output_schema,permissions,risk_level,timeout_ms,authentication_requirements,status,created_at,updated_at',order:'name.asc',editable:['description','permissions','risk_level','timeout_ms','authentication_requirements','status'],deletable:false},
  capabilities:{table:'astracore_capabilities',select:'id,name,group_name,icon,status,description,sort_order,created_at,updated_at',order:'sort_order.asc',editable:['name','group_name','icon','status','description','sort_order'],deletable:false},
  projects:{table:'astracore_projects',select:'id,user_id,name,description,created_at,updated_at',order:'updated_at.desc',editable:['name','description'],deletable:true},
  files:{table:'astracore_cloud_files',select:'id,user_id,project_id,filename,mime_type,size_bytes,sha256,status,metadata,created_at,updated_at',order:'updated_at.desc',editable:['filename','status','metadata'],deletable:true},
  memory:{table:'astracore_memory_records',select:'memory_id,user_id,content,source,confidence,permission,expires_at,metadata,created_at,updated_at,consent_granted_at,consent_revoked_at',order:'created_at.desc',editable:['permission','expires_at','metadata'],deletable:true},
  conversations:{table:'astracore_conversations',select:'id,user_id,title,model,created_at,updated_at',order:'updated_at.desc',editable:['title'],deletable:true},
  agents:{table:'astracore_agent_runs',select:'id,user_id,agent_type,status,plan,result,created_at,completed_at',order:'created_at.desc',editable:['status'],deletable:false},
  evaluations:{table:'astracore_evaluation_runs',select:'id,model_version_id,evaluation_type,status,metrics,dataset_sha256,created_at,completed_at',order:'created_at.desc',editable:['status','metrics'],deletable:false},
  training:{table:'astracore_lm_training_runs',select:'id,model_id,status,dataset_version,checkpoint_path,epoch,train_loss,validation_loss,test_loss,perplexity,parameter_count,device,seed,started_at,completed_at,error_message,metadata,created_at',order:'created_at.desc',editable:['status','metadata'],deletable:false},
  datasets:{table:'astracore_training_datasets',select:'id,dataset_name,dataset_version,format,source_type,source_uri,content_sha256,pair_count,validation_pair_count,status,license,provenance,validation_metadata,created_at,updated_at',order:'created_at.desc',editable:['status','validation_metadata'],deletable:false},
  knowledge_sources:{table:'astracore_knowledge_sources',select:'id,user_id,name,source_type,status,config,permissions,tags,last_synced_at,error_message,created_at,updated_at',order:'updated_at.desc',editable:['name','status','config','permissions','tags'],deletable:true},
  knowledge_documents:{table:'astracore_knowledge_documents',select:'id,user_id,source_id,title,source,url,owner,language,document_type,permissions,tags,content_hash,status,page_count,metadata,created_at,updated_at',order:'updated_at.desc',editable:['title','permissions','tags','status','metadata'],deletable:true}
};
function fail(message,status=400){throw Object.assign(new Error(message),{status})}
function cleanKey(value){return String(value||'').trim().slice(0,120)}
function auditPayload(user,eventType,metadata){return {user_id:user.id,event_type:eventType,metadata:{admin:true,...metadata}}}
async function audit(req,user,supabaseUserRequest,eventType,metadata={}){try{await supabaseUserRequest(req,'/rest/v1/astracore_audit_events',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(auditPayload(user,eventType,metadata))})}catch{}}
export async function adminRoute({req,res,url,user,readBody,json,supabaseUserRequest}){
  const path=url.pathname;
  if(path==='/api/admin/control'&&req.method==='GET'){
    const requested=String(url.searchParams.get('resource')||'').trim();
    const cfg=TABLES[requested]; if(!cfg)return json(res,400,{error:'Unsupported admin resource'});
    const limit=Math.min(Math.max(Number(url.searchParams.get('limit'))||50,1),200);
    const rows=await supabaseUserRequest(req,`/rest/v1/${cfg.table}?select=${encodeURIComponent(cfg.select)}&order=${cfg.order}&limit=${limit}`);
    return json(res,200,{resource:requested,rows});
  }
  if(path==='/api/admin/control'&&req.method==='PATCH'){
    const body=JSON.parse(await readBody(req));const resource=cleanKey(body.resource);const id=cleanKey(body.id);const cfg=TABLES[resource];
    if(!cfg||!id)return json(res,400,{error:'resource and id are required'});
    const patch=body.patch&&typeof body.patch==='object'&&!Array.isArray(body.patch)?body.patch:{};
    const clean={};for(const key of cfg.editable){if(Object.prototype.hasOwnProperty.call(patch,key))clean[key]=patch[key]}
    if(!Object.keys(clean).length)return json(res,400,{error:'No editable fields supplied'});
    const idField=resource==='memory'?'memory_id':'id';
    const rows=await supabaseUserRequest(req,`/rest/v1/${cfg.table}?${idField}=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(clean)});
    await audit(req,user,supabaseUserRequest,'admin.update',{resource,id,fields:Object.keys(clean)});
    return json(res,200,{resource,row:rows?.[0]||null});
  }
  if(path==='/api/admin/control'&&req.method==='DELETE'){
    const body=JSON.parse(await readBody(req));const resource=cleanKey(body.resource);const id=cleanKey(body.id);const cfg=TABLES[resource];
    if(!cfg||!id)return json(res,400,{error:'resource and id are required'});if(!cfg.deletable)return json(res,403,{error:'This resource is protected from deletion in Admin Control Center'});
    const idField=resource==='memory'?'memory_id':'id';
    await supabaseUserRequest(req,`/rest/v1/${cfg.table}?${idField}=eq.${encodeURIComponent(id)}`,{method:'DELETE'});
    await audit(req,user,supabaseUserRequest,'admin.delete',{resource,id});
    return json(res,200,{ok:true,resource,id});
  }
  if(path==='/api/admin/audit'&&req.method==='GET'){
    const limit=Math.min(Math.max(Number(url.searchParams.get('limit'))||100,1),300);
    const rows=await supabaseUserRequest(req,`/rest/v1/astracore_audit_events?select=id,user_id,request_id,event_type,model,source_ids,tool_names,latency_ms,metadata,created_at&order=created_at.desc&limit=${limit}`);
    return json(res,200,{events:rows});
  }
  if(path==='/api/admin/catalog'&&req.method==='GET')return json(res,200,{resources:Object.entries(TABLES).map(([id,c])=>({id,table:c.table,editable:c.editable,deletable:c.deletable}))});
  return false;
}
