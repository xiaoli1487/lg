const {randomUUID} = require("node:crypto");
const {Readable} = require("node:stream");
const {pipeline} = require("node:stream/promises");

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const imageData = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const bucket = "manju-manual-videos";
const maxVideo = 40*1024*1024;
const fields = "id,title,state,created_at";

function createManualVideo(url, secret, administrator, request = fetch) {
  const authorization = secret.startsWith("sb_secret_") ? {} : {Authorization:"Bearer "+secret};
  const call = (path,options={}) => request(url+path,{...options,
    headers:{apikey:secret,...authorization,...options.headers},
    redirect:"error",signal:AbortSignal.timeout(path.startsWith("/storage/") ? 120000 : 30000)
  });
  const table = "/rest/v1/manju_manual_videos";
  const storage = "/storage/v1/object";
  const json = {"Content-Type":"application/json"};
  const error = (status,message) => Object.assign(Error(message),{status});
  async function read(req,limit) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size>limit) {
        req.resume?.();
        throw error(413,"文件或素材超过大小限制。");
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async function rows(query,options) {
    const response = await call(table+"?"+new URLSearchParams(query),options);
    if (!response.ok) throw error(502,"人工视频服务暂不可用，请稍后重试。");
    return response.json();
  }

  async function change(id,patch) {
    const [row] = await rows({id:"eq."+id,state:"eq.pending",select:fields},{
      method:"PATCH",headers:{...json,Prefer:"return=representation"},body:JSON.stringify({...patch,finished_at:new Date().toISOString()})
    });
    return row;
  }

  async function upload(req,reply,id) {
    const [job] = await rows({id:"eq."+id,select:"state"});
    if (job?.state === "ready") return reply(200,{state:"ready"});
    if (job?.state !== "pending") return reply(409,{error:"任务已结束或不存在。"});
    const size = Number(req.headers["content-length"]);
    if (!Number.isFinite(size) || size<12 || size>maxVideo || req.headers["content-type"] !== "video/mp4") {
      return reply(400,{error:"请选择 40 MB 以内的 MP4 成片。"});
    }
    const video = await read(req,maxVideo);
    if (video.length !== size || video.toString("ascii",4,8) !== "ftyp") {
      return reply(400,{error:"文件不是可识别的 MP4，请重新导出。"});
    }
    const path = id+"/"+randomUUID()+".mp4";
    const response = await call(storage+"/"+bucket+"/"+path,{method:"POST",headers:{"Content-Type":"video/mp4"},body:video});
    if (!response.ok) throw error(502,"成片上传失败，请重试。");
    const delivered = await change(id,{state:"ready",output_path:path});
    if (!delivered) {
      await call(storage+"/"+bucket,{method:"DELETE",headers:json,body:JSON.stringify({prefixes:[path]})}).catch(()=>{});
      const [latest] = await rows({id:"eq."+id,select:"state"});
      return latest?.state === "ready" ? reply(200,{state:"ready"}) : reply(409,{error:"任务已被处理，请刷新列表。"});
    }
    return reply(200,{state:"ready"});
  }

  async function handle(req,res,reply,uid,route) {
    const admin = uid === administrator;
    if (route.pathname === "/manual-video/upload") {
      const id = route.searchParams.get("id");
      if (!admin) return reply(403,{error:"仅管理员可以交付成片。"});
      if (!uuid.test(id || "")) return reply(400,{error:"任务编号无效。"});
      return upload(req,reply,id);
    }
    let data;
    try { data = JSON.parse((await read(req,12*1024*1024)).toString("utf8")); }
    catch (cause) { if (cause.status) throw cause; return reply(400,{error:"任务参数无效。"}); }
    const {action,id} = data || {};
    if (action === "access") return reply(200,{admin});
    if (action === "list" && admin) {
      const jobs = await rows({state:"eq.pending",select:fields,order:"created_at.asc",limit:"50"});
      return reply(200,{jobs});
    }
    if (!uuid.test(id || "")) return reply(400,{error:"任务编号无效。"});
    const filter = {id:"eq."+id,owner_id:"eq."+uid};
    if (action === "submit") {
      const {title,prompt,image="",references=[],settings} = data;
      if (typeof title !== "string" || !title.trim() || title.length>160 ||
          typeof prompt !== "string" || !prompt.trim() || prompt.length>24000 ||
          (image!=="" && (typeof image!=="string" || !imageData.test(image))) ||
          !Array.isArray(references) || references.length>5 ||
          !references.every(value=>typeof value==="string" && imageData.test(value))) {
        return reply(400,{error:"请提供提示词，并检查首帧和参考图格式。"});
      }
      const response = await call(table,{method:"POST",headers:json,body:JSON.stringify({id,owner_id:uid,title:title.trim(),
        inputs:{prompt,image,references,settings:{
          model:String(settings?.model || "").slice(0,50),resolution:String(settings?.resolution || "").slice(0,12),
          duration:Number.isInteger(settings?.duration) ? settings.duration : null,audio:settings?.audio===true
        }}})});
      if (response.status === 409) {
        const [existing] = await rows({...filter,select:"id"});
        if (existing) return reply(202,{job:"manual."+existing.id});
        return reply(409,{error:"你的账号已有一单人工视频正在处理。"});
      }
      if (!response.ok) throw error(502,"人工任务提交失败，请稍后重试。");
      return reply(202,{job:"manual."+id});
    }
    if (["detail","fail"].includes(action)) {
      if (!admin) return reply(403,{error:"仅管理员可以查看或处理该任务。"});
      if (action === "fail") {
        const done = await change(id,{state:"failed"});
        return done ? reply(200,{state:done.state}) : reply(409,{error:"任务已处理，请刷新列表。"});
      }
      const [job] = await rows({id:"eq."+id,select:fields+",inputs"});
      return job ? reply(200,{job}) : reply(404,{error:"找不到这条任务。"});
    }
    if (!["status","download"].includes(action)) return reply(400,{error:"不支持此操作。"});
    const [job] = await rows({...filter,select:"state,output_path"});
    if (!job) return reply(404,{error:"找不到你的任务，请检查登录账号。"});
    if (action === "status" || job.state !== "ready") return reply(200,{state:job.state});
    const output = await call(storage+"/authenticated/"+bucket+"/"+job.output_path);
    if (!output.ok || !output.body) throw error(502,"成片暂时无法读取，请重试。");
    res.writeHead(200,{"content-type":"video/mp4","cache-control":"private, no-store","x-content-type-options":"nosniff"});
    await pipeline(Readable.fromWeb(output.body),res);
  }
  return {handle};
}

module.exports = {createManualVideo};
