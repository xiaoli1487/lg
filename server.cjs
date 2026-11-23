(
function runCharacterServer() {
  const http = require("node:http");
  const fs = require("node:fs");
  const path = require("node:path");
  const port = Number(process.env.PORT || 10000);
  const origin = new URL(process.env.RENDER_EXTERNAL_URL).origin;
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/,"");
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const supabaseAuth = Boolean(supabaseUrl && supabaseKey);
  const authEnabled = supabaseAuth || Boolean(process.env.FIREBASE_WEB_API_KEY && process.env.FIREBASE_PROJECT_ID);
  const creditMode = process.env.MANJU_CREDITS === "1";
  const vars = {openai:"OPENAI_API_KEY",deepseek:"DEEPSEEK_API_KEY",qwen:"DASHSCOPE_API_KEY",qwenpay:"QIANWEN_API_KEY"};
  const managedProvider = process.env.MANJU_MODEL_PROVIDER || "qwenpay";
  const creditAdmin = process.env.MANJU_CREDIT_ADMIN_UID;
  const inviteOnly = supabaseAuth && process.env.MANJU_INVITE_ONLY === "1";
  let credits;
  let animation;
  if (creditMode) {
    const costs = {
      "/write-story":Number(process.env.MANJU_STORY_COST ?? "9.2"),
      "/shot-image":Number(process.env.MANJU_IMAGE_COST ?? "9.2"),
      "/three-view":Number(process.env.MANJU_SHEET_COST ?? "9.2")
    };
    if (!authEnabled || !["qwenpay","openai"].includes(managedProvider) || !process.env[vars[managedProvider]]) {
      throw new Error("积分模式配置不完整。");
    }
    if (supabaseAuth) {
      const secret = process.env.SUPABASE_SECRET_KEY;
      if (!secret) throw new Error("Supabase 积分模式缺少后台凭据。");
      if (inviteOnly && !creditAdmin) throw new Error("邀请制缺少管理员账号编号。");
      credits = require("./supabase-credits.cjs").createSupabaseCredits(
        supabaseUrl,supabaseKey,secret,costs,{inviteOnly,administrator:creditAdmin}
      );
      if (creditAdmin && process.env.QIANWEN_API_KEY && !process.env.QIANWEN_API_KEY.startsWith("sk-sp-")) {
        animation = require("./wan-animation.cjs").createAnimation(process.env.QIANWEN_API_KEY,secret,credits.videoRpc);
        setInterval(()=>void animation.reconcile(),45000).unref();
      }
    } else {
      const {initializeApp,cert} = require("firebase-admin/app");
      const {getAuth} = require("firebase-admin/auth");
      const {getFirestore} = require("firebase-admin/firestore");
      const credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
      const app = initializeApp({credential,projectId:process.env.FIREBASE_PROJECT_ID});
      credits = require("./credits.cjs").createCredits(getAuth(app),getFirestore(app),costs);
    }
  }
  const accountErrors = {
    401: "密钥验证失败。请在网站的模型设置中填写该平台的完整 API Key。",
    403: "平台拒绝了访问。请核对密钥所属平台，并查看该密钥能否调用此模型。",
    429: "所选平台达到了调用频率或账户额度限制。请检查用量后重试。"
  };
  const html = path.join(__dirname, "Manju-Studio.html");
  if (!fs.existsSync(html)) throw new Error("请把启动器和 Manju-Studio.html 放在同一文件夹。");
  const shotImages = credits && managedProvider === "qwenpay" ? require("./shot-image-models.cjs") : null;
  const layoutFiles = {
    "/studio-layout.css":["studio-layout.css","text/css; charset=utf-8"],
    "/studio-layout.js":["studio-layout.js","text/javascript; charset=utf-8"],
    "/shot-image-picker.js":["shot-image-picker.js","text/javascript; charset=utf-8"],
    "/infinite-canvas.css":["infinite-canvas.css","text/css; charset=utf-8"],
    "/infinite-canvas.js":["infinite-canvas.js","text/javascript; charset=utf-8"]
  };
  http.createServer(async (req, res) => {
    let settle;
    const reply = async (code, body) => {
      if (settle) {
        try { await settle(code === 200); }
        catch {
          console.error("积分流水结算失败");
          code = 503;
          body = {error:"积分结算失败，请联系站点管理员核对流水。",blocked:true};
        }
      }
      res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.host !== new URL(origin).host) return reply(403, {});
    if (req.method === "GET" && Object.hasOwn(layoutFiles,req.url)) {
      const [name,contentType] = layoutFiles[req.url];
      res.writeHead(200,{"content-type":contentType,"cache-control":"no-store"});
      return fs.createReadStream(path.join(__dirname,name)).pipe(res);
    }
    if (credits && req.method === "GET" && req.url === "/credits") {
      try {
        const uid = await credits.identify(req);
        return reply(200,{
          ...await credits.overview(uid),
          costs:credits.costs,
          shotImageModels:shotImages?.options,
          packages:credits.packages,
          manualAdmin:uid===creditAdmin,
          giftAdmin:supabaseAuth && uid===creditAdmin,
          inviteAdmin:inviteOnly && uid===creditAdmin,
          rechargeContact:creditAdmin ? process.env.MANJU_RECHARGE_CONTACT?.trim() || "" : ""
        });
      }
      catch (error) { return reply(error.status || 503,{error:error.status ? error.message : "暂时无法查询积分。"}); }
    }
    if (animation && req.method === "GET" && req.url === "/video-generation.js") {
      res.writeHead(200, {"content-type":"text/javascript; charset=utf-8","cache-control":"no-store"});
      return fs.createReadStream(path.join(__dirname,"wan-animation.js")).pipe(res);
    }
    if (animation && req.method === "POST" && ["/video-generation","/wan-animation"].includes(req.url) && req.headers.origin === origin) {
      try {
        const uid = await credits.identify(req);
        return await animation.handle(req,res,reply,uid);
      } catch (error) {
        if (res.headersSent) return res.destroy();
        return reply(error.status || 502,{error:error.status ? error.message : "动画服务暂不可用，请稍后查询。"});
      }
    }
    if (authEnabled && req.method === "GET" && req.url === "/account.js") {
      res.writeHead(200, {"content-type":"text/javascript; charset=utf-8","cache-control":"no-store"});
      return fs.createReadStream(path.join(__dirname,"account.js")).pipe(res);
    }
    if (authEnabled && req.method === "GET" && req.url === "/auth-config") {
      if (supabaseAuth) return reply(200,{provider:"supabase",url:supabaseUrl,publishableKey:supabaseKey,inviteOnly});
      return reply(200,{apiKey:process.env.FIREBASE_WEB_API_KEY,projectId:process.env.FIREBASE_PROJECT_ID,authDomain:process.env.FIREBASE_PROJECT_ID+".firebaseapp.com"});
    }
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "X-Manju-Process": String(process.pid) });
      
      let page = fs.readFileSync(html, "utf8").replaceAll("http://127.0.0.1:8793", origin);
      if (credits) {
        const encodedCosts = Object.entries(credits.costs).map(([route,cost])=>' data-cost-'+route.slice(1)+'="'+cost+'"').join("");
        page = page.replace("<html lang=\"zh-CN\">", '<html lang="zh-CN" data-credit-provider="' + managedProvider + '"' + encodedCosts + '>');
      }
      if (authEnabled) {
        const accountScript = '<script type="module" src="/account.js"></script>';
        const animationScript = animation ? '<script defer src="/video-generation.js"></script>' : '';
        page = page.replace("</head>", accountScript + animationScript + "</head>");
      }
      const layout = '<link rel="stylesheet" href="/studio-layout.css"><script defer src="/studio-layout.js"></script>';
      const imagePicker = shotImages
        ? '<script id="shot-image-catalog" type="application/json">' +
          JSON.stringify({models:shotImages.options,defaultId:shotImages.defaultId}) +
          '</script><script defer src="/shot-image-picker.js"></script>'
        : '';
      const canvas = '<link rel="stylesheet" href="/infinite-canvas.css"><script defer src="/infinite-canvas.js"></script>';
      return res.end(page.replace("</head>",layout + imagePicker + canvas + "</head>"));
    }
    const manualPayment = Boolean(credits) && req.url === "/credits/manual-payment";
    const invite = Boolean(credits) && inviteOnly && req.url === "/credits/invite";
    const gift = Boolean(credits) && supabaseAuth && req.url === "/credits/gift";
    const adminAction = manualPayment || invite || gift;
    if (req.method !== "POST" || (!adminAction && !["/three-view", "/shot-image", "/write-story"].includes(req.url)) || req.headers.origin !== origin) return reply(403, {});
    try {
      const uid = credits && await credits.identify(req);
      if (adminAction && uid !== creditAdmin) return reply(403,{error:"此操作需要积分管理员权限。"});
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > (adminAction ? 4096 : 16 * 1024 * 1024)) return reply(413, { error: "提交内容过大。" });
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString());
      if (invite) return reply(200,await credits.invite(data));
      if (gift) return reply(200,await credits.addGift(uid,data));
      if (manualPayment) return reply(200,await credits.addManualPayment(uid,data));
      const { image, prompt, refs = [] } = data;
      const shotModel = shotImages && req.url === "/shot-image"
        ? shotImages.get(data.shotImageModel)
        : null;
      if (shotImages && req.url === "/shot-image" && (!shotModel || data.quotedPoints !== shotModel.points)) {
        return reply(409,{error:"分镜图选项或积分报价有更新，请刷新页面后重试。",blocked:true});
      }
      const provider = credits ? managedProvider : data.provider || "openai";
      if (!Object.hasOwn(vars,provider)) return reply(400,{error:"请选择支持的平台。"});
      const platform = {openai:"OpenAI",deepseek:"DeepSeek",qwen:"阿里云百炼",qwenpay:"千问按量付费"}[provider];
      const model = req.url === "/write-story"
        ? {openai:"gpt-4.1-mini",deepseek:"deepseek-flash",qwen:"qwen-plus",qwenpay:"qwen-plus"}[provider]
        : shotModel?.upstream ?? (provider === "openai" ? "gpt-image-1.5" : "qwen-image-3.0");
      const accountFailure = status => reply(502, {error:credits ? "网站的模型服务暂不可用，请稍后再试。" : platform+"（"+model+"，HTTP "+status+"）"+accountErrors[status], blocked:true});
      const key = credits ? process.env[vars[provider]] : typeof data.key === "string" && /^\S{8,512}$/.test(data.key) ? data.key : "";
      if (!key) return reply(400,{error:"请在模型设置里填写 "+provider+" 的 API Key。",blocked:true});
      let base = "https://api.openai.com/v1";
      if (provider === "deepseek") base = "https://api.deepseek.com";
      if (provider === "qwenpay") base = "https://maas.qianwenaiapi.com/compatible-mode/v1";
      if (provider === "qwen") {
        if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(data.workspace || "") || !["cn-beijing","ap-southeast-1","us-east-1","cn-hongkong","eu-central-1","ap-northeast-1"].includes(data.region)) return reply(400,{error:"请核对百炼业务空间 ID 和地域。",blocked:true});
        base = "https://"+data.workspace+"."+data.region+".maas.aliyuncs.com/compatible-mode/v1";
      }
      if (req.url === "/write-story") {
        if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 12000) return reply(400, {error:"故事输入过长或为空。"});
        if (credits) settle = await credits.reserve(uid,req.url);
        const response = await fetch(base+"/chat/completions", {
          method:"POST", redirect:"error", headers:{Authorization:"Bearer " + key, "Content-Type":"application/json"},
          body:JSON.stringify({model, messages:[{role:"user",content:prompt}]}),
          signal:AbortSignal.timeout(120000)
        });
        if (accountErrors[response.status]) return accountFailure(response.status);
        const result = await response.json();
        const screenplay = result.choices?.[0]?.message?.content;
        if (!response.ok || !screenplay) return reply(502, {error:!credits && result.error?.message || "没有收到剧本。"});
        return reply(200, {screenplay});
      }
      const inputs = req.url === "/shot-image" ? refs : [image];
      if (!Array.isArray(inputs) || inputs.length > 16 || typeof prompt !== "string" || !prompt.trim() || prompt.length > 20000) return reply(400,{error:"画面描述或参考图格式有误。"});
      const parameters = {model, prompt, size:req.url === "/shot-image" ? "1024x1536" : "1536x1024"};
      if (provider === "deepseek") return reply(400,{error:"请选择支持绘图的平台。",blocked:true});
      const headers = {Authorization:"Bearer " + key};
      let body;
      if (["qwen","qwenpay"].includes(provider)) {
        if (inputs.length > 3 || inputs.some(src=>typeof src!=="string" || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src))) return reply(400,{error:"绘图支持最多三张 PNG、JPEG 或 WebP 参考图。"});
        headers["Content-Type"]="application/json";
        body=JSON.stringify({...parameters,n:1,response_format:shotModel?.format ?? "b64_json",...(inputs.length ? {image:inputs} : {})});
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
      if (credits) settle = await credits.reserve(uid,req.url,shotModel?.points);
      const response = await fetch(base+"/images/" + (provider==="openai" && inputs.length ? "edits" : "generations"), {
        method:"POST", redirect:"error", headers, body,
        signal:AbortSignal.timeout(300000)
      });
      if (accountErrors[response.status]) return accountFailure(response.status);
      const result = await response.json();
      if (!response.ok) return reply(502,{error:!credits && result.error?.message || "图像服务没有返回图片。"});
      const output = result.data?.[0];
      const rendered = shotModel?.format === "url"
        ? await shotImages.downloadResult(output?.url)
        : output?.b64_json && "data:image/png;base64," + output.b64_json;
      if (!rendered) return reply(502,{error:"图像服务没有返回可用的图片。"});
      return reply(200,{image:rendered});
    } catch (error) {
      return reply(error.status || 500, { error: error.status ? error.message : "生成失败。请检查网络和参考图，再重试。", blocked:Boolean(error.status) });
    }
  }).on("error", error => { console.error(error.message); process.exit(error.code === "EADDRINUSE" ? 98 : 1); }).listen(port, "0.0.0.0", () => console.log("打开 " + origin));
}
)();
