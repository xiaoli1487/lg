(() => {
  const running = new WeakSet();
  const messages = new WeakMap();
  let enabled = false;
  let models = [];
  let accessCheck = 0;

  async function animationRequest(body) {
    const response = await requestGeneration("/video-generation",body);
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

  function settingsFor(shot) {
    const saved = shot.animationSettings;
    const formerId = typeof saved?.model === "string" ? saved.model : "";
    const migrated = formerId.endsWith("2.2-i2v-plus") ? "detail" :
      formerId.endsWith("2.6-i2v-flash") ? "flex" : formerId.endsWith("3.0-video") ? "narrative" : "economy";
    const model = models.find(item=>item.id === formerId) ?? models.find(item=>item.id === migrated) ?? models[0];
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
    if (!tools || !shot || !enabled) return;
    const panel = document.createElement("div");
    panel.className = "video-tools";
    panel.dataset.wanAnimation = "";
    const label = document.createElement("div");
    label.className = "field";
    const title = document.createElement("span");
    title.textContent = "站内生成动画";
    const settings = settingsFor(shot);
    const model = models.find(item=>item.id === settings.model);
    const locked = running.has(shot) || Boolean(shot.wanJob);
    const change = (key, value) => {
      shot.animationSettings = key === "model" ? {model:value} : {...settings,[key]:value};
      void save();
      renderAnimation();
      workspace.querySelector('[data-wan-setting="' + key + '"] select')?.focus();
    };
    const addField = (key,text,options,disabled = false) => {
      const field = selectField(text,options,String(settings[key]),locked || disabled,value=>change(key,
        key === "duration" ? Number(value) : key === "audio" ? value === "true" : value));
      field.dataset.wanSetting = key;
      label.append(field);
    };
    label.append(title);
    addField("model","视频生成模型",models.map(item=>[item.id,item.name]));
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
      (settings.audio ? "有声" : "无声") + " · 本次 " + estimatedCost(model,settings) + " 积分";
    label.append(info);
    const actions = document.createElement("div");
    actions.className = "actions";
    const generate = document.createElement("button");
    generate.type = "button";
    generate.className = "button primary";
    generate.textContent = running.has(shot) ? "生成处理中…" : shot.wanJob ? "继续查询动画" : "生成动画";
    generate.disabled = running.has(shot) || (!shot.wanJob && !canAnimate(shot));
    generate.onclick = () => void animate(shot);
    actions.append(generate);
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
    status.textContent = messages.get(shot) || (shot.wanJob ? "已提交任务，可继续查询。" : canAnimate(shot) ? "" : "先生成或导入本镜首帧图。");
    panel.append(label,actions,status);
    tools.before(panel);
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

  async function animate(shot) {
    if (running.has(shot)) return;
    const originalVideo = shot.video;
    const originalImage = shot.image;
    const settings = settingsFor(shot);
    const model = models.find(item=>item.id === settings.model);
    if (!shot.wanJob && (!canAnimate(shot) ||
        !window.confirm("用" + model.name + "生成 " + settings.resolution + "、" + settings.duration +
          " 秒动画，将预扣 " + estimatedCost(model,settings) + " 积分。生成失败会退回积分。"
          + (originalVideo ? "生成成功后将替换本镜现有视频。" : "") + "确认生成？"))) return;
    const report = message => {
      messages.set(shot,message);
      if (project.shots[selected] === shot) renderAnimation();
    };
    running.add(shot);
    report(shot.wanJob ? "正在查询任务…" : "正在提交首帧…");
    try {
      if (!shot.wanJob) {
        const requestId = shot.videoRequestId || crypto.randomUUID();
        shot.videoRequestId = requestId;
        shot.animationSettings = settings;
        await save();
        const response = await animationRequest({action:"create",requestId,image:originalImage,
          prompt:animationPrompt(shot,settings,model.promptLimit),...settings});
        const {job} = await response.json();
        if (!project.shots.includes(shot)) return;
        delete shot.videoRequestId;
        shot.wanJob = job;
        await save();
      }
      const job = shot.wanJob;
      for (let attempt = 0; attempt < 40; attempt++) {
        if (!enabled || !project.shots.includes(shot)) return;
        const response = await animationRequest({action:"status",job});
        const {state} = await response.json();
        if (state === "failed" || state === "expired") {
          delete shot.wanJob;
          void save();
          report(state === "failed" ? "动画生成失败。若已预扣积分，已退回钱包。" : "任务已结束或过期，可重新提交。");
          return;
        }
        if (state === "ready") {
          const output = await animationRequest({action:"download",job});
          if (output.headers.get("content-type") !== "video/mp4") {
            const result = await output.json();
            if (result.state === "expired") {
              delete shot.wanJob;
              void save();
              report("视频下载链接已过期，可重新生成。");
              return;
            }
            throw Error("暂时无法读取视频，请继续查询。");
          }
          const video = await output.blob();
          const name = "动画-" + (shot.name || "未命名分镜") + ".mp4";
          const clip = await loadClip(video);
          try {
            if (!project.shots.includes(shot) || shot.image !== originalImage || shot.video !== originalVideo) {
              download(video,name);
              delete shot.wanJob;
              void save();
              notify("分镜素材已变更，动画已单独下载。");
              return;
            }
            const duration = clip.video.duration;
            if (!Number.isFinite(duration) || duration <= 0) throw Error("浏览器无法读取这段 MP4。");
            shot.video = video;
            shot.videoPoster = originalImage;
            shot.videoName = name;
            shot.videoDuration = duration;
            delete shot.wanJob;
          } finally {
            releaseClip(clip);
          }
          await save();
          if (step === "edit" && project.shots[selected] === shot) refreshShot();
          report("动画已放入本镜，可播放或下载。");
          notify("动画已生成并加入分镜。");
          return;
        }
        report("正在生成动画，可先编辑其他分镜。");
        await new Promise(resolve => setTimeout(resolve,15000));
      }
      report("任务仍在生成，可点「继续查询动画」。");
    } catch (error) {
      if (shot.videoRequestId && error.status >= 400 && error.status < 500) {
        delete shot.videoRequestId;
        void save();
      }
      report(error.message || "请求未完成。");
    } finally {
      running.delete(shot);
      if (project.shots[selected] === shot) renderAnimation();
    }
  }

  async function checkAccess() {
    const version = ++accessCheck;
    enabled = false;
    renderAnimation();
    try {
      const result = await animationRequest({action:"access"});
      if (version !== accessCheck) return;
      const data = await result.json();
      if (version !== accessCheck) return;
      models = Array.isArray(data.models) ? data.models : [];
      enabled = data.enabled === true && models.length > 0;
      renderAnimation();
    } catch { /* Animation is shown only to the pilot administrator. */ }
  }

  new MutationObserver(renderAnimation).observe(workspace,{childList:true});
  window.addEventListener("manju-account-change",checkAccess);
  window.addEventListener("DOMContentLoaded",checkAccess,{once:true});
})();
