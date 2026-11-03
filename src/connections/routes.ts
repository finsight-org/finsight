import type{FastifyInstance,FastifyReply,FastifyRequest}from'fastify';
import type{AuthenticateRequest}from'../auth.js';import type{Provider}from'../providers.js';
import{ConnectionError,parseConnectionId,parseCreateInput,parseListInput,parseRenameInput}from'./model.js';
import type{ConnectionStore,ConnectionStoreFactory}from'./store.js';
export function registerConnectionRoutes(app:FastifyInstance,options:{authenticate:AuthenticateRequest;registry:readonly Provider[];createStore?:ConnectionStoreFactory}):void{
 app.register(async routes=>{
  const providerIds=new Set(options.registry.map(p=>p.metadata.id));
  routes.setErrorHandler((error,_req,reply)=>{
   const status=error&&typeof error==='object'&&'statusCode'in error?Number(error.statusCode):500;
   const safe=error instanceof ConnectionError?error:new ConnectionError([400,413,415].includes(status)?'CONNECTION_INPUT_INVALID':'CONNECTION_STORAGE_UNAVAILABLE');
   reply.code([413,415].includes(status)?status:safe.statusCode).send({error:{code:safe.code,message:safe.message}});
  });
  const collection={browserApi:true as const,browserMethods:['GET','POST'],browserHeaders:['Authorization','Content-Type']};
  const item={...collection,browserMethods:['GET','PATCH','DELETE']};
  async function handle(request:FastifyRequest,reply:FastifyReply,work:(store:()=>ConnectionStore)=>Promise<unknown>){
   const abort=new AbortController();const cancel=()=>abort.abort();const close=()=>{if(!reply.raw.writableFinished)cancel();};
   request.raw.once('aborted',cancel);reply.raw.once('close',close);
   try{
    const identity=await options.authenticate(request,reply);if(!identity||abort.signal.aborted||request.raw.aborted||reply.raw.destroyed)return;
    return await work(()=>{if(!options.createStore)throw new ConnectionError('CONNECTION_STORAGE_UNAVAILABLE');return options.createStore(identity,abort.signal);});
   }finally{request.raw.removeListener('aborted',cancel);reply.raw.removeListener('close',close);}
  }
  const id=(request:FastifyRequest)=>parseConnectionId((request.params as {connectionId:unknown}).connectionId);
  for(const [url,config]of [['/api/connections',collection],['/api/connections/:connectionId',item]]as const)routes.options(url,{config},async(_req,reply)=>reply.code(204).send());
  routes.post('/api/connections',{config:collection,bodyLimit:16*1024},async(req,reply)=>handle(req,reply,async store=>{
   const input=parseCreateInput(req.body,providerIds),connection=await store().create(input);
   return reply.code(201).header('Location',`/api/connections/${connection.id}`).send({connection});
  }));
  routes.get('/api/connections',{config:collection,exposeHeadRoute:false},async(req,reply)=>handle(req,reply,async store=>{const input=parseListInput(req.query);return store().list(input);}));
  routes.get('/api/connections/:connectionId',{config:item,exposeHeadRoute:false},async(req,reply)=>handle(req,reply,async store=>{const key=id(req),connection=await store().get(key);if(!connection)throw new ConnectionError('CONNECTION_NOT_FOUND');return{connection};}));
  routes.patch('/api/connections/:connectionId',{config:item,bodyLimit:16*1024},async(req,reply)=>handle(req,reply,async store=>{const key=id(req),input=parseRenameInput(req.body),connection=await store().rename(key,input.label);if(!connection)throw new ConnectionError('CONNECTION_NOT_FOUND');return{connection};}));
  routes.delete('/api/connections/:connectionId',{config:item},async(req,reply)=>handle(req,reply,async store=>{const key=id(req);if(!await store().remove(key))throw new ConnectionError('CONNECTION_NOT_FOUND');return reply.code(204).send();}));
 });
}
