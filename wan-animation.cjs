const {createHmac, timingSafeEqual} = require("node:crypto");
const {Readable} = require("node:stream");
const {pipeline} = require("node:stream/promises");

const base = "https://maas.qianwenaiapi.com/api/v1";
const taskId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const firstFrame = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const maxBody = Math.ceil(10 * 1024 * 1024 * 4 / 3) + 8192;

function createAnimation(apiKey, signingKey, request = fetch) {
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
    return {response, output:payload?.output};
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
    if (data?.action === "access") return reply(200,{enabled:true});
    if (data?.action === "create") {
      const {image,prompt} = data;
      if (typeof image !== "string" || !firstFrame.test(image) ||
          Buffer.byteLength(image.slice(image.indexOf(",")+1),"base64") > 10 * 1024 * 1024 ||
          typeof prompt !== "string" || !prompt.trim() || Array.from(prompt).length > 800) {
        return reply(400,{error:"请使用 10 MB 以内的 PNG、JPG 或 WebP，并将动画提示词控制在 800 字以内。"});
      }
      const {response,output} = await provider("/services/aigc/video-generation/video-synthesis",{
        model:"wan2.2-i2v-flash", input:{img_url:image,prompt},
        parameters:{resolution:"480P",duration:5,prompt_extend:false}
      }).catch(()=>({response:null,output:null}));
      if (!response) return reply(502,{error:"连接中断，未能确认任务是否提交。请先到千问平台核对任务和用量。"});
      if ([401,403].includes(response.status)) return reply(502,{error:"千问按量付费账号暂无法调用万相 2.2 Flash，请核对模型权限与密钥。"});
      if (response.status === 429) return reply(429,{error:"千问平台请求过多，请稍后再试。"});
      if (!response.ok || typeof output?.task_id !== "string" || !taskId.test(output.task_id)) {
        return reply(502,{error:"未能确认任务是否提交。请先到千问平台核对任务和用量。"});
      }
      const id = output.task_id;
      return reply(202,{job:id + "." + signature(uid,id).toString("hex")});
    }
    if (!["status","download"].includes(data?.action)) return reply(400,{error:"不支持此操作。"});
    const id = verify(uid,data.job);
    if (!id) return reply(404,{error:"动画任务无效。"});
    const {response,output} = await provider("/tasks/" + id);
    if (response.status === 404) return reply(200,{state:"expired"});
    if (!response.ok || !output) return reply(502,{error:"暂时查不到动画任务，请稍后继续查询。"});
    const state = output.task_status;
    if (["FAILED","CANCELED","CANCELLED"].includes(state)) return reply(200,{state:"failed"});
    if (state === "UNKNOWN") return reply(200,{state:"expired"});
    if (state !== "SUCCEEDED") return reply(200,{state:"pending"});
    if (data.action === "status") return reply(200,{state:"ready"});

    let url;
    try { url = new URL(output.video_url); }
    catch { return reply(502,{error:"千问平台没有返回可用的视频文件。"}); }
    const publicOssHost = /^(?!.*-internal\.aliyuncs\.com$)[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.(?:oss-[a-z0-9-]+|[a-z0-9-]+\.oss)\.aliyuncs\.com$/;
    const qwenHost = /^(?:[a-z0-9-]+\.)+(?:qianwenai(?:api)?\.com|qwencloudapi\.com)$/;
    const canProxy = publicOssHost.test(url.hostname) || qwenHost.test(url.hostname);
    if (url.protocol === "http:" && canProxy) url.protocol = "https:";
    if (url.protocol !== "https:" || url.port || url.username || url.password) {
      console.warn("Wan result URL not accepted", {protocol:url.protocol, hostname:url.hostname});
      return reply(502,{error:"千问平台返回了非安全视频地址，请从千问任务记录下载源文件。"});
    }
    if (!canProxy) {
      console.warn("Wan result uses a separate download host", {hostname:url.hostname});
      return reply(200,{state:"external",videoUrl:url.href});
    }
    const video = await request(url,{redirect:"manual",signal:AbortSignal.timeout(90000)});
    if (video.status >= 300 && video.status < 400) {
      await video.body?.cancel();
      return reply(200,{state:"external",videoUrl:url.href});
    }
    if (video.status === 403 || video.status === 404) return reply(200,{state:"expired"});
    if (!video.ok || !video.body || !/^(video\/mp4|application\/octet-stream)\b/i.test(video.headers.get("content-type") || "")) {
      return reply(502,{error:"暂时无法取回 MP4，请稍后继续查询。"});
    }
    res.writeHead(200,{"content-type":"video/mp4","cache-control":"no-store","x-content-type-options":"nosniff"});
    await pipeline(Readable.fromWeb(video.body),res);
  }

  return {handle};
}

module.exports = {createAnimation};
