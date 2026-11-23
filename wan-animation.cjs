const {createHash, createHmac, timingSafeEqual} = require("node:crypto");
const {Readable} = require("node:stream");
const {pipeline} = require("node:stream/promises");

const base = "https://maas.qianwenaiapi.com/api/v1";
const taskId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const firstFrame = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const maxBody = Math.ceil(10 * 1024 * 1024 * 4 / 3) + 131072;

const defaultModel = "economy";
const models = [
  {id:defaultModel,name:"轻量版",upstream:"wan2.2-i2v-flash",min:5,max:5,promptLimit:800,
    price:{ "480P":[10], "720P":[20], "1080P":[48] }},
  {id:"detail",name:"细节版",upstream:"wan2.2-i2v-plus",min:5,max:5,promptLimit:800,
    price:{ "480P":[14], "1080P":[70] }},
  {id:"flex",name:"灵活版",upstream:"wan2.6-i2v-flash",min:2,max:15,promptLimit:1500,
    price:{ "720P":[15,30], "1080P":[25,50] }},
  {id:"narrative",name:"叙事版",upstream:"wan3.0-video",min:2,max:30,promptLimit:20000,
    price:{ "480P":[30,30], "720P":[60,60], "1080P":[120,120] }}
];


const publicModels = models.map(({id,name,min,max,promptLimit,price})=>({id,name,min,max,promptLimit,price}));

function resultUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { return null; }
  const oss = /^(?!.*-internal\.aliyuncs\.com$)[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.(?:oss-[a-z0-9-]+|[a-z0-9-]+\.oss)\.aliyuncs\.com$/;
  const service = /^(?:[a-z0-9-]+\.)+(?:qianwenai(?:api)?\.com|qwencloudapi\.com)$/;
  if (!oss.test(url.hostname) && !service.test(url.hostname)) return null;
  if (url.port || url.username || url.password) return null;
  if (url.protocol === "http:") url.protocol = "https:";
  return url.protocol === "https:" ? url : null;
}

function createAnimation(apiKey, signingKey, rpc, request = fetch) {
  function signature(uid, id) {
    return createHmac("sha256",signingKey).update("manju-wan-v1:" + uid + ":" + id).digest();
  }

  function verify(uid, job) {
    if (typeof job !== "string" || job.length !== 101) return null;
    const [id, proof] = job.split(".");
    if (!taskId.test(id) || !/^[0-9a-f]{64}$/.test(proof || "")) return null;
    return timingSafeEqual(signature(uid,id),Buffer.from(proof,"hex")) ? id : null;
  }

  async function provider(path, input) {
    const headers = {Authorization:"Bearer " + apiKey};
    if (input) Object.assign(headers,{"Content-Type":"application/json","X-DashScope-Async":"enable"});
    const response = await request(base + path,{
      method:input ? "POST" : "GET", headers,
      body:input && JSON.stringify(input), redirect:"error", signal:AbortSignal.timeout(20000)
    });
    const payload = await response.json().catch(()=>null);
    return {response, output:payload?.output, code:payload?.code};
  }

  async function update(job, state) {
    return rpc("video_update",{p_id:job.id,p_remote:job.remote,p_state:state});
  }

  async function inspect(remote) {
    const {response,output} = await provider("/tasks/" + remote);
    if (response.status === 404 || output?.task_status === "UNKNOWN") return {state:"expired"};
    if (!response.ok || !output) throw new Error("Video status unavailable");
    if (["FAILED","CANCELED","CANCELLED"].includes(output.task_status)) return {state:"failed"};
    if (output.task_status !== "SUCCEEDED") return {state:"pending"};
    const url = resultUrl(output.video_url);
    if (!url) console.warn("Video result host not supported");
    return url ? {state:"ready",url} : {state:"failed"};
  }

  let reconciling = false;
  async function reconcile() {
    if (reconciling) return;
    reconciling = true;
    try {
      const jobs = await rpc("video_due",{});
      await Promise.allSettled(jobs.map(async job=>{
        if (!job.remote) return update(job,"expired");
        try { return await update(job,(await inspect(job.remote)).state); }
        catch {
          await update(job,"pending");
          throw new Error("Video settlement delayed");
        }
      }));
    } catch { console.error("Video settlement database unavailable"); }
    finally { reconciling = false; }
  }

  async function handle(req,res,reply,uid) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBody) return reply(413,{error:"首帧图片超过 10 MB。"});
      chunks.push(chunk);
    }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return reply(400,{error:"请求格式有误。"}); }
    if (data?.action === "access") return reply(200,{enabled:true,models:publicModels});
    if (data?.action === "create") {
      const {image,prompt,requestId} = data;
      if (typeof requestId !== "string" || !taskId.test(requestId)) {
        return reply(400,{error:"请刷新页面后提交新动画任务。"});
      }
      const {model = defaultModel,resolution = "480P",duration = 5,audio = false} = data;
      const spec = models.find(item=>item.id === model);
      const rates = spec && typeof resolution === "string" && Object.hasOwn(spec.price,resolution) && spec.price[resolution];
      if (!rates || !Number.isInteger(duration) || duration < spec.min || duration > spec.max ||
          typeof audio !== "boolean" || (audio && rates.length < 2)) {
        return reply(400,{error:"请选择该视频模型支持的分辨率、时长和声音设置。"});
      }
      if (typeof image !== "string" || !firstFrame.test(image) ||
          Buffer.byteLength(image.slice(image.indexOf(",")+1),"base64") > 10 * 1024 * 1024 ||
          typeof prompt !== "string" || !prompt.trim() || Array.from(prompt).length > spec.promptLimit) {
        return reply(400,{error:"请使用 10 MB 以内的 PNG、JPG 或 WebP，并将动画提示词控制在 "+spec.promptLimit+" 字以内。"});
      }
      const fingerprint = createHash("sha256").update(JSON.stringify([model,resolution,duration,audio,image,prompt])).digest("hex");
      const reservation = await rpc("video_begin",{
        p_uid:uid,p_id:requestId,p_units:rates[Number(audio)]*duration*10,p_fingerprint:fingerprint
      });
      if (reservation === "insufficient") return reply(402,{error:"积分不足，本次需要 "+rates[Number(audio)]*duration+" 积分。"});
      if (reservation === "conflict") return reply(409,{error:"本次提交内容有变，请重新确认生成设置。"});
      const localJob = "v2." + requestId + "." + signature(uid,"v2:"+requestId).toString("hex");
      if (reservation === "existing") return reply(202,{job:localJob});
      if (reservation !== "created") throw new Error("Credit reservation unavailable");
      const unified = model === "narrative";
      const input = unified ? {prompt,media:[{type:"first_frame",url:image}]} : {img_url:image,prompt};
      const parameters = {resolution,duration,prompt_extend:false};
      if (unified) parameters.ratio = "adaptive";
      if (rates.length === 2) parameters.audio = audio;
      const {response,output,code} = await provider("/services/aigc/video-generation/video-synthesis",{
        model:spec.upstream,input,parameters
      }).catch(()=>({response:null,output:null}));
      if (!response || response.status >= 500) return reply(202,{job:localJob});
      if (!response.ok) {
        await update({id:requestId,remote:null},"failed");
        if (response.status === 429) return reply(429,{error:"动画请求较多，请稍后再试。预扣积分已退回。"});
        if ([401,403,404].includes(response.status) || ["ModelNotFound","ModelNotAvailable","AccessDenied"].includes(code)) {
          return reply(422,{error:spec.name+"暂不可用，请换一个模型。预扣积分已退回。"});
        }
        return reply(422,{error:"生成请求被拒绝，请检查首帧素材和提示词。预扣积分已退回。"});
      }
      if (typeof output?.task_id === "string" && taskId.test(output.task_id)) {
        const submitted = {id:requestId,remote:output.task_id};
        await update(submitted,"pending").catch(()=>update(submitted,"pending"));
      }
      return reply(202,{job:localJob});
    }
    if (!["status","download"].includes(data?.action)) return reply(400,{error:"不支持此操作。"});
    let result;
    if (typeof data.job === "string" && data.job.startsWith("v2.")) {
      const [,id,proof] = data.job.split(".");
      if (data.job.length !== 104 || !taskId.test(id) || !/^[0-9a-f]{64}$/.test(proof || "") ||
          !timingSafeEqual(signature(uid,"v2:"+id),Buffer.from(proof,"hex"))) {
        return reply(404,{error:"动画任务不存在。"});
      }
      const job = await rpc("video_job",{p_id:id,p_uid:uid});
      if (!job) return reply(404,{error:"动画任务不存在。"});
      if (["failed","expired"].includes(job.state)) return reply(200,{state:job.state});
      if (!job.remote) return reply(200,{state:"pending"});
      if (job.state === "ready" && data.action === "status") return reply(200,{state:"ready"});
      result = await inspect(job.remote);
      if (job.state === "pending") {
        const state = await update(job,result.state);
        if (state !== result.state) return reply(200,{state});
      }
    } else {
      const id = verify(uid,data.job);
      if (!id) return reply(404,{error:"动画任务无效。"});
      result = await inspect(id);
    }
    if (result.state !== "ready" || data.action === "status") return reply(200,{state:result.state});

    let url = result.url;
    let video;
    for (let attempt = 0; attempt < 3; attempt++) {
      video = await request(url,{redirect:"manual",signal:AbortSignal.timeout(90000)});
      if (video.status < 300 || video.status >= 400) break;
      const location = video.headers.get("location");
      await video.body?.cancel();
      url = location && resultUrl(new URL(location,url));
      if (!url) return reply(502,{error:"暂时无法下载动画，请稍后继续查询。"});
    }
    if (video.status === 403 || video.status === 404) return reply(200,{state:"expired"});
    if (!video.ok || !video.body || !/^(video\/mp4|application\/octet-stream)\b/i.test(video.headers.get("content-type") || "")) {
      return reply(502,{error:"暂时无法取回 MP4，请稍后继续查询。"});
    }
    res.writeHead(200,{"content-type":"video/mp4","cache-control":"no-store","x-content-type-options":"nosniff"});
    await pipeline(Readable.fromWeb(video.body),res);
  }

  return {handle,reconcile};
}

module.exports = {createAnimation};
