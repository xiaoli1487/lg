(() => {
  const running = new WeakSet();
  const messages = new WeakMap();
  let enabled = false;
  let accessCheck = 0;

  async function animationRequest(body) {
    const response = await requestGeneration("/wan-animation",body);
    if (!response.ok) {
      const data = await response.json().catch(()=>({}));
      throw Error(data.error || "动画服务连接失败。");
    }
    return response;
  }

  function canAnimate(shot) {
    return !demoImage(shot.image) && /^data:image\/(?:png|jpeg|webp);base64,/.test(shot.image || "");
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
    title.textContent = "站内生成动画 · 万相 2.2 Flash";
    const info = document.createElement("small");
    info.textContent = "480p · 5 秒 · 无声 · 模型按量价约 ¥0.50／段";
    label.append(title,info);
    const actions = document.createElement("div");
    actions.className = "actions";
    const generate = document.createElement("button");
    generate.type = "button";
    generate.className = "button primary";
    generate.textContent = running.has(shot) ? "生成处理中…" : shot.wanJob ? "继续查询动画" : "生成动画";
    generate.disabled = running.has(shot) || (!shot.wanJob && !canAnimate(shot));
    generate.onclick = () => void animate(shot);
    actions.append(generate);
    if (shot.video instanceof Blob && shot.videoName?.startsWith("万相动画-")) {
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

  function animationPrompt(shot) {
    const parts = [
      "以上传图为首帧，镜头连续。保持人物五官、服装、站位、道具位置和光线一致。",
      shot.direction?.trim() || "人物只完成一个符合当前画面的小动作，视线和手部动作自然。",
      "运镜：" + (movementOptions[shot.motion]?.prompt || "保持原机位。"),
      "按首帧构图，动作自然收住，避免突然变景、跳位和肢体变形。"
    ];
    return Array.from(parts.join("\n")).slice(0,800).join("");
  }

  async function animate(shot) {
    if (running.has(shot)) return;
    const originalVideo = shot.video;
    const originalImage = shot.image;
    if (!shot.wanJob && (!canAnimate(shot) ||
        !window.confirm("将本镜首帧和画面动作发送给千问平台，生成 5 秒动画，模型费用约 ¥0.50。"
          + (originalVideo ? "生成成功后将替换本镜现有视频。" : "") + "确认生成？"))) return;
    const report = message => {
      messages.set(shot,message);
      if (project.shots[selected] === shot) renderAnimation();
    };
    running.add(shot);
    report(shot.wanJob ? "正在查询任务…" : "正在提交首帧…");
    try {
      if (!shot.wanJob) {
        const response = await animationRequest({action:"create",image:originalImage,prompt:animationPrompt(shot)});
        const {job} = await response.json();
        if (!project.shots.includes(shot)) return;
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
          report(state === "failed" ? "动画生成失败，可重新生成。" : "任务已过期，可重新生成。");
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
          const name = "万相动画-" + (shot.name || "未命名分镜") + ".mp4";
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
        report("千问平台正在生成动画，可先编辑其他分镜。");
        await new Promise(resolve => setTimeout(resolve,15000));
      }
      report("任务仍在生成，可点「继续查询动画」。");
    } catch (error) {
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
      enabled = data.enabled === true;
      renderAnimation();
    } catch { /* Animation is shown only to the pilot administrator. */ }
  }

  new MutationObserver(renderAnimation).observe(workspace,{childList:true});
  window.addEventListener("manju-account-change",checkAccess);
  window.addEventListener("DOMContentLoaded",checkAccess,{once:true});
})();
