const models = [
  {id:"quick",name:"速绘版",points:8,upstream:"qwen-image-2.1-turbo",format:"url"},
  {id:"standard",name:"标准版",points:12,upstream:"qwen-image-3.0",format:"b64_json"},
  {id:"detail",name:"精绘版",points:26,upstream:"qwen-image-3.0-pro",format:"b64_json"}
];
const defaultId = "standard";
const options = models.map(({id,name,points})=>({id,name,points}));
const get = id=>models.find(model=>model.id===id);

async function downloadResult(value, request = fetch) {
  const {resultUrl} = require("./wan-animation.cjs");
  const url = typeof value === "string" ? resultUrl(value) : null;
  if (!url) return null;
  const response = await request(url,{redirect:"error",signal:AbortSignal.timeout(20000)});
  const mime = response.headers.get("content-type")?.split(";")[0].trim();
  if (!response.ok || !response.body || !["image/png","image/jpeg","image/webp"].includes(mime)) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 12 * 1024 * 1024) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return length ? "data:"+mime+";base64,"+Buffer.concat(chunks,length).toString("base64") : null;
}

module.exports = {defaultId,options,get,downloadResult};
