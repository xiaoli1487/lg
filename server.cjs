(
function runCharacterServer() {
  const http = require("node:http");
  const fs = require("node:fs");
  const path = require("node:path");
  const port = Number(process.env.PORT || 10000);
  const origin = new URL(process.env.RENDER_EXTERNAL_URL).origin;
  const accountErrors = {
    401: "所选平台拒绝了当前密钥。请检查启动器使用的密钥。",
    403: "当前项目没有调用此模型的权限。",
    429: "所选平台达到了调用频率或账户额度限制。请检查用量后重试。"
  };
  const html = path.join(__dirname, "Manju-Studio.html");
  if (!fs.existsSync(html)) throw new Error("请把启动器和 Manju-Studio.html 放在同一文件夹。");
  http.createServer(async (req, res) => {
    const reply = (code, body) => {
      res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.host !== new URL(origin).host) return reply(403, {});
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "X-Manju-Process": String(process.pid) });
      
      return res.end(fs.readFileSync(html, "utf8").replaceAll("http://127.0.0.1:8793", origin));
    }
    if (req.method !== "POST" || !["/three-view", "/shot-image", "/write-story"].includes(req.url) || req.headers.origin !== origin) return reply(403, {});
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) return reply(413, { error: "参考图过大，请缩小后再试。" });
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString());
      const { image, prompt, refs = [], provider = "openai" } = data;
      const vars = {openai:"OPENAI_API_KEY",deepseek:"DEEPSEEK_API_KEY",qwen:"DASHSCOPE_API_KEY"};
      if (!Object.hasOwn(vars,provider)) return reply(400,{error:"请选择支持的平台。"});
      const key = typeof data.key === "string" && /^\S{8,512}$/.test(data.key) ? data.key : "";
      if (!key) return reply(400,{error:"请在模型设置里填写 "+provider+" 的 API Key。",blocked:true});
      let base = "https://api.openai.com/v1";
      if (provider === "deepseek") base = "https://api.deepseek.com";
      if (provider === "qwen") {
        if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(data.workspace || "") || !["cn-beijing","ap-southeast-1","us-east-1","cn-hongkong","eu-central-1","ap-northeast-1"].includes(data.region)) return reply(400,{error:"请核对百炼业务空间 ID 和地域。",blocked:true});
        base = "https://"+data.workspace+"."+data.region+".maas.aliyuncs.com/compatible-mode/v1";
      }
      if (req.url === "/write-story") {
        if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 12000) return reply(400, {error:"故事输入过长或为空。"});
        const response = await fetch(base+"/chat/completions", {
          method:"POST", redirect:"error", headers:{Authorization:"Bearer " + key, "Content-Type":"application/json"},
          body:JSON.stringify({model:{openai:"gpt-4.1-mini",deepseek:"deepseek-flash",qwen:"qwen-plus"}[provider], messages:[{role:"user",content:prompt}]}),
          signal:AbortSignal.timeout(120000)
        });
        if (accountErrors[response.status]) return reply(502, {error:accountErrors[response.status], blocked:true});
        const result = await response.json();
        const screenplay = result.choices?.[0]?.message?.content;
        if (!response.ok || !screenplay) return reply(502, {error:result.error?.message || "没有收到剧本。"});
        return reply(200, {screenplay});
      }
      const inputs = req.url === "/shot-image" ? refs : [image];
      if (!Array.isArray(inputs) || inputs.length > 16 || typeof prompt !== "string" || !prompt.trim() || prompt.length > 20000) return reply(400,{error:"画面描述或参考图格式有误。"});
      const parameters = {model:"gpt-image-1.5", prompt, size:req.url === "/shot-image" ? "1024x1536" : "1536x1024"};
      if (provider === "deepseek") return reply(400,{error:"请选择支持绘图的平台。",blocked:true});
      const headers = {Authorization:"Bearer " + key};
      let body;
      if (provider === "qwen") {
        if (inputs.length > 3 || inputs.some(src=>typeof src!=="string" || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src))) return reply(400,{error:"千问图像支持最多三张 PNG、JPEG 或 WebP 参考图。"});
        headers["Content-Type"]="application/json";
        body=JSON.stringify({...parameters,model:"qwen-image-3.0",response_format:"b64_json",...(inputs.length ? {image:inputs} : {})});
      } else if (inputs.length) {
        body = new FormData();
        for (const [key,value] of Object.entries(parameters)) body.set(key,value);
        for (const [index,source] of inputs.entries()) {
          const match = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(source);
          if (!match) return reply(400,{error:"参考图格式有误。"});
          body.append(inputs.length === 1 ? "image" : "image[]", new Blob([Buffer.from(match[2],"base64")],{type:"image/"+match[1]}), "role-"+index+"."+match[1]);
        }
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(parameters);
      }
      const response = await fetch(base+"/images/" + (provider==="openai" && inputs.length ? "edits" : "generations"), {
        method:"POST", redirect:"error", headers, body,
        signal:AbortSignal.timeout(300000)
      });
      if (accountErrors[response.status]) return reply(502, {error:accountErrors[response.status], blocked:true});
      const result = await response.json();
      if (!response.ok || !result.data?.[0]?.b64_json) return reply(502, { error: result.error?.message || "图像服务没有返回图片。" });
      reply(200, { image: "data:image/png;base64," + result.data[0].b64_json });
    } catch {
      reply(500, { error: "生成失败。请检查网络和参考图，再重试。" });
    }
  }).on("error", error => { console.error(error.message); process.exit(error.code === "EADDRINUSE" ? 98 : 1); }).listen(port, "0.0.0.0", () => console.log("打开 " + origin));
}
)();
