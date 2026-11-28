(() => {
  const running = new WeakSet();
  const messages = new WeakMap();
  const pendingText = "生成耗时较长，完成后自动显示";
  let enabled = false;
  let manualEnabled = false;
  let models = [];
  let accessCheck = 0;

  async function animationRequest(body) {
    const manual = body.action === "submit" || body.job?.startsWith("manual.");
    const payload = manual && body.job ? {action:body.action,id:body.job.slice(7)} : body;
    const response = await requestGeneration(manual ? "/manual-video" : "/video-generation",payload);
    if (!response.ok) {
      const data = await response.json().catch(()=>({}));
      throw Object.assign(Error(data.error || "动画服务连接失败。"),{status:response.status});
    }
    return response;
  }

  function canAnimate(shot) {
    return !demoImage(shot.image) && /^data:image\/(?:png|jpeg|webp);base64,/.test(shot.image || "");
  }

  function selectField(labelText, options, selectedValue, disabled, onChange) {
    const label = document.createElement("label");
    label.className = "field";
    label.append(labelText);
    const select = document.createElement("select");
    select.disabled = disabled;
    select.replaceChildren(...options.map(([value,text])=>new Option(text,value)));
    select.value = selectedValue;
    select.onchange = () => onChange(select.value);
    label.append(select);
    return label;
  }

  function settingsFor(shot, choices = models.filter(item=>item.id !== "reference")) {
    const saved = shot.animationSettings;
    const formerId = typeof saved?.model === "string" ? saved.model : "";
    const migrated = formerId.endsWith("2.2-i2v-plus") ? "detail" :
      formerId.endsWith("2.6-i2v-flash") ? "flex" : formerId.endsWith("3.0-video") ? "narrative" : "economy";
    const model = choices.find(item=>item.id === formerId) ?? choices.find(item=>item.id === migrated) ?? choices[0];
    const resolution = typeof saved?.resolution === "string" && Object.hasOwn(model.price,saved.resolution)
      ? saved.resolution : Object.keys(model.price)[0];
    const planned = shot.wanJob && !saved ? 5 : Math.round(shot.seconds) || 5;
    const duration = Math.max(model.min,Math.min(model.max,Number.isInteger(saved?.duration) ? saved.duration : planned));
    const audio = model.price[resolution].length > 1 && saved?.audio === true;
    return {model:model.id,resolution,duration,audio};
  }

  function estimatedCost(model, settings) {
    return model.price[settings.resolution][Number(settings.audio)] * settings.duration;
  }

  function renderAnimation() {
    workspace.querySelector("[data-wan-animation]")?.remove();
    const tools = workspace.querySelector(".video-tools");
    const shot = project.shots[selected];
    if (!tools || !shot || (!enabled && !manualEnabled)) return;
    const panel = document.createElement("div");
    panel.className = "video-tools";
    panel.dataset.wanAnimation = "";
    panel.append(generationForm(shot));
    tools.before(panel);
  }

  function generationForm(shot, canvas) {
    const label = document.createElement("div");
    label.className = "field";
    const title = document.createElement("span");
    title.textContent = canvas ? canvas.title : "站内生成动画";
    label.append(title);
    if (!enabled && !manualEnabled) {
      label.append("请登录后使用视频生成。");
      return label;
    }
    const inputs = canvas?.inputs();
    const pendingModel = shot.wanJob && shot.animationSettings?.model;
    const mode = pendingModel || (inputs?.references.length ? "reference" :
      canvas && !inputs.image ? "narrative" : "");
    const choices = (models.length ? models : [{id:mode || "economy",name:"由管理员制作",min:5,max:5,promptLimit:20000,price:{"480P":[0]}}])
      .filter(item=>mode ? item.id === mode : item.id !== "reference");
    if (!choices.length) {
      label.append("当前视频服务不支持这组输入。");
      return label;
    }
    const settings = settingsFor(shot,choices);
    const model = choices.find(item=>item.id === settings.model);
    const refresh = canvas?.render || renderAnimation;
    const locked = running.has(shot) || Boolean(shot.wanJob);
    const change = (key, value) => {
      shot.animationSettings = key === "model" ? {model:value} : {...settings,[key]:value};
      void save();
      refresh();
      (canvas?.container || workspace).querySelector('[data-wan-setting="' + key + '"] select')?.focus();
    };
    const addField = (key,text,options,disabled = false) => {
      const field = selectField(text,options,String(settings[key]),locked || disabled,value=>change(key,
        key === "duration" ? Number(value) : key === "audio" ? value === "true" : value));
      field.dataset.wanSetting = key;
      label.append(field);
    };
    addField("model","视频生成模型",choices.map(item=>[item.id,item.name]),choices.length === 1);
    addField("resolution","视频分辨率",Object.keys(model.price).map(value=>[value,value]));
    addField("duration","动画时长",Array.from({length:model.max-model.min+1},(_,i)=>{
      const seconds = model.min + i;
      return [String(seconds),seconds + " 秒"];
    }),model.min === model.max);
    if (model.price[settings.resolution].length > 1) {
      addField("audio","模型声音",[["false","无声"],["true","生成声音"]]);
    }
    const info = document.createElement("small");
    info.textContent = settings.resolution + " · " + settings.duration + " 秒 · " +
      (model.id === "reference" ? "有声" : settings.audio ? "有声" : "无声") + " · 本次 " + estimatedCost(model,settings) + " 积分";
    if (enabled && !shot.wanJob?.startsWith("manual.")) label.append(info);
    if (manualEnabled && shot.wanJob?.startsWith("manual.") && !running.has(shot) && !messages.has(shot)) {
      queueMicrotask(()=>{ if (!messages.has(shot)) void animate(shot,settings,model,canvas,inputs,true); });
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    const generate = document.createElement("button");
    generate.type = "button";
    generate.className = "button primary";
    generate.textContent = running.has(shot) ? pendingText : shot.wanJob ? "继续查询视频" : canvas ? "生成视频" : "生成动画";
    const inputError = canvas && !inputs.prompt ? "请连接有内容的文本或分镜节点。" : "";
    generate.disabled = running.has(shot) || (!shot.wanJob && (canvas ? Boolean(inputError) : !canAnimate(shot)));
    generate.onclick = () => void animate(shot,settings,model,canvas,inputs,shot.wanJob?.startsWith("manual."));
    if (enabled || shot.wanJob?.startsWith("manual.")) actions.append(generate);
    if (manualEnabled && !shot.wanJob) {
      const manual = document.createElement("button");
      manual.type = "button";
      manual.className = "button secondary";
      manual.textContent = "提交人工制作";
      manual.disabled = running.has(shot) || Boolean(inputError);
      manual.onclick = ()=>void animate(shot,settings,model,canvas,inputs,true);
      actions.append(manual);
    }
    if (shot.video instanceof Blob && shot.videoName?.includes("动画-")) {
      const saveClip = document.createElement("button");
      saveClip.type = "button";
      saveClip.className = "button secondary";
      saveClip.textContent = "下载 MP4";
      saveClip.onclick = () => download(shot.video,shot.videoName);
      actions.append(saveClip);
    }
    const status = document.createElement("small");
    status.setAttribute("role","status");
    status.textContent = messages.get(shot) || (shot.wanJob ? pendingText + "。点击「继续查询视频」可恢复自动查询。" :
      canvas ? inputError : canAnimate(shot) ? "" : "先生成或导入本镜首帧图。");
    if (canvas) {
      const summary = document.createElement("small");
      summary.textContent = "输入：" + (inputs.prompt ? "文本" : "无文本") +
        (inputs.image ? " · 首帧图" : "") + (inputs.references.length ? " · " + inputs.references.length + " 张参考图" : "");
      label.append(summary);
      if (inputs.references.length) {
        const hints = document.createElement("small");
        hints.textContent = inputs.references.map((_,index)=>"图" + (index+1) + " · " + inputs.referenceNames[index]).join(" / ");
        label.append(hints);
      }
    }
    label.append(actions,status);
    return label;
  }

  function animationPrompt(shot, settings, limit) {
    const parts = [
      "以上传图为首帧，镜头连续。保持人物五官、服装、站位、道具位置和光线一致。",
      shot.direction?.trim() || "人物只完成一个符合当前画面的小动作，视线和手部动作自然。",
      settings.audio && shot.line?.trim() ? "对白与旁白逐字使用以下原文：\n" + shot.line.trim() : "",
      "运镜：" + (movementOptions[shot.motion]?.prompt || "保持原机位。"),
      "按首帧构图，动作自然收住，避免突然变景、跳位和肢体变形。"
    ];
    return Array.from(parts.filter(Boolean).join("\n")).slice(0,limit).join("");
  }

  async function animate(shot,settings,model,canvas,inputs,manual = false) {
    if (running.has(shot)) return;
    const originalVideo = shot.video;
    const originalImage = canvas ? (shot.wanJob ? shot.pendingPoster || "" : inputs.image || inputs.references[0] || "") : shot.image;
    const exists = canvas?.exists || (()=>project.shots.includes(shot));
    const refresh = canvas?.render || (()=>{ if (project.shots[selected] === shot) renderAnimation(); });
    if (!shot.wanJob && manual &&
        !window.confirm("将本次的提示词和图片提交给管理员制作视频。本次提交不扣积分。确认提交？")) return;
    if (!shot.wanJob && !manual && ((canvas ? !inputs.prompt : !canAnimate(shot)) ||
        !window.confirm("用" + model.name + "生成 " + settings.resolution + "、" + settings.duration +
          " 秒动画，将预扣 " + estimatedCost(model,settings) + " 积分。生成失败会退回积分。"
          + (originalVideo ? "生成成功后将替换现有视频。" : "") + "确认生成？"))) return;
    const report = message => {
      messages.set(shot,message);
      refresh();
    };
    running.add(shot);
    report(pendingText);
    try {
      if (!shot.wanJob) {
        const requestKey = manual ? "manualVideoRequestId" : "videoRequestId";
        const requestId = shot[requestKey] ||= crypto.randomUUID();
        shot.animationSettings = settings;
        const image = canvas ? inputs.image : canAnimate(shot) ? originalImage : "";
        const references = canvas ? inputs.references : [shot.sceneRef,shot.visualRef].filter(value=>/^data:image\/(png|jpeg|webp);base64,/.test(value || ""));
        if (manual || canvas) shot.pendingPoster = image || references[0] || "";
        await save();
        const prompt = manual ? (canvas ? inputs.prompt : [shot.direction,shot.line].filter(Boolean).join("\n\n")).trim() || "根据分镜素材制作视频。" :
          canvas ? Array.from(inputs.prompt).slice(0,model.promptLimit).join("") : animationPrompt(shot,settings,model.promptLimit);
        const payload = manual ? {action:"submit",id:requestId,title:(shot.title || shot.name || "未命名分镜").slice(0,160),
          image,prompt,references,settings} : {action:"create",requestId,image:originalImage,prompt,
          ...(canvas ? {references:inputs.references} : {}),...settings};
        const response = await animationRequest(payload);
        const {job} = await response.json();
        if (!exists()) return;
        delete shot[requestKey];
        shot.wanJob = job;
        await save();
      }
      const job = shot.wanJob;
      for (let attempt = 0; manual || attempt < 40; attempt++) {
        if (!(manual ? manualEnabled : enabled) || !exists()) return;
        const response = await animationRequest({action:"status",job});
        const {state} = await response.json();
        if (state === "failed" || state === "expired") {
          delete shot.wanJob;
          delete shot.pendingPoster;
          void save();
          report(manual ? "管理员未能完成此任务，可重新提交。" :
            state === "failed" ? "动画生成失败。若已预扣积分，已退回钱包。" : "任务已结束或过期，可重新提交。");
          return;
        }
        if (state === "ready") {
          const output = await animationRequest({action:"download",job});
          if (output.headers.get("content-type") !== "video/mp4") {
            const result = await output.json();
            if (result.state === "expired") {
              delete shot.wanJob;
              delete shot.pendingPoster;
              void save();
              report("视频下载链接已过期，可重新生成。");
              return;
            }
            throw Error("暂时无法读取视频，请继续查询。");
          }
          const video = await output.blob();
          const name = "动画-" + (shot.name || shot.title || "未命名分镜") + ".mp4";
          const clip = await loadClip(video);
          try {
            if (!exists() || (!manual && !canvas && shot.image !== originalImage) || shot.video !== originalVideo) {
              download(video,name);
              delete shot.wanJob;
              void save();
              notify("分镜素材已变更，动画已单独下载。");
              return;
            }
            const duration = clip.video.duration;
            if (!Number.isFinite(duration) || duration <= 0) throw Error("浏览器无法读取这段 MP4。");
            shot.video = video;
            shot.videoPoster = manual ? shot.pendingPoster || "" : originalImage;
            shot.videoName = name;
            shot.videoDuration = duration;
            delete shot.wanJob;
            delete shot.pendingPoster;
          } finally {
            releaseClip(clip);
          }
          await save();
          if (!canvas && step === "edit" && project.shots[selected] === shot) refreshShot();
          canvas?.completed();
          report(canvas ? "视频已生成，可在节点中播放或下载。" : "动画已放入本镜，可播放或下载。");
          notify(canvas ? "视频已加入画布节点。" : "动画已生成并加入分镜。");
          return;
        }
        report(pendingText);
        await new Promise(resolve => setTimeout(resolve,manual ? 30000 : 15000));
      }
      report(pendingText + "。点击「继续查询视频」可恢复自动查询。");
    } catch (error) {
      const key = manual ? "manualVideoRequestId" : "videoRequestId";
      if (shot[key] && error.status >= 400 && error.status < 500) {
        delete shot[key];
        delete shot.pendingPoster;
        void save();
      }
      report(error.message || "请求未完成。");
    } finally {
      running.delete(shot);
      refresh();
    }
  }

  window.manjuCanvasVideo = {generationForm,isBusy:node=>running.has(node)};

  async function checkAccess() {
    const version = ++accessCheck;
    enabled = manualEnabled = false;
    renderAnimation();
    const [video,manual] = await Promise.allSettled([
      animationRequest({action:"access"}).then(response=>response.json()),
      requestGeneration("/manual-video",{action:"access"}).then(response=>response.ok)
    ]);
    if (version !== accessCheck) return;
    models = video.status === "fulfilled" && Array.isArray(video.value.models) ? video.value.models : [];
    enabled = video.status === "fulfilled" && video.value.enabled === true && models.length>0;
    manualEnabled = manual.status === "fulfilled" && manual.value;
    renderAnimation();
    window.dispatchEvent(new Event("manju-video-access"));
  }

  new MutationObserver(renderAnimation).observe(workspace,{childList:true});
  window.addEventListener("manju-account-change",checkAccess);
  window.addEventListener("DOMContentLoaded",checkAccess,{once:true});
})();
