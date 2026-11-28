(() => {
  const navigation = document.querySelector(".sidebar nav");
  if (!navigation) return;
  const entry = element("button","人工视频交付");
  entry.type = "button";
  entry.hidden = true;
  navigation.append(entry);
  const dialog = element("dialog");
  dialog.className = "canvas-video-dialog";
  dialog.setAttribute("aria-label","人工视频交付");
  const header = element("div");
  const close = button("关闭",()=>dialog.close());
  const refresh = button("刷新待办",list);
  header.className = "actions";
  header.append(refresh,close);
  const status = element("p");
  status.setAttribute("role","status");
  const content = element("div");
  dialog.append(element("h2","人工视频交付"),header,status,content);
  document.body.append(dialog);

  let epoch = 0;
  let accessEpoch = 0;
  let busy = false;
  function element(tag,text) {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    return item;
  }
  function button(title,run) {
    const item = element("button",title);
    item.type = "button";
    item.className = "button secondary";
    item.onclick = run;
    return item;
  }
  async function read(response) {
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw Error(data.error || "人工视频服务暂不可用。");
    return data;
  }
  const send = async body => read(await requestGeneration("/manual-video",body));

  async function checkAccess() {
    const turn = ++accessEpoch;
    entry.hidden = true;
    if (dialog.open) dialog.close();
    try {
      const {admin} = await send({action:"access"});
      if (turn === accessEpoch) entry.hidden = !admin;
    } catch { /* Login controls remain available. */ }
  }
  entry.onclick = ()=>{ dialog.showModal(); void list(); };
  dialog.addEventListener("close",()=>{
    epoch++;
    content.replaceChildren();
    status.textContent = "";
  });

  async function list() {
    if (busy || !dialog.open) return;
    const request = ++epoch;
    content.replaceChildren();
    status.textContent = "正在读取待办…";
    try {
      const {jobs} = await send({action:"list"});
      if (request !== epoch) return;
      status.textContent = jobs.length ? "选择一条任务查看素材并上传成片。" : "暂无待处理的视频。";
      for (const job of jobs) {
        const item = element("div");
        item.className = "actions";
        item.append(button(job.title,()=>detail(job.id)),
          element("small",new Date(job.created_at).toLocaleString("zh-CN")));
        content.append(item);
      }
    } catch (error) { if (request === epoch) status.textContent = error.message; }
  }

  function addImage(src,label) {
    if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(src || "")) return;
    const image = element("img");
    image.src = src;
    image.alt = label;
    image.style.cssText = "width:min(100%,240px);max-height:150px;object-fit:contain;display:block";
    const link = element("a",label + " · 下载");
    link.href = src;
    link.download = label+"."+src.slice(11,src.indexOf(";")).replace("jpeg","jpg");
    content.append(link,image);
  }

  async function detail(id) {
    if (busy) return;
    const request = ++epoch;
    status.textContent = "正在读取任务素材…";
    try {
      const {job} = await send({action:"detail",id});
      if (request !== epoch) return;
      const {prompt,image,references,settings} = job.inputs;
      status.textContent = job.state === "pending" ? "" : "任务已处理。";
      const description = [settings.resolution,settings.duration ? settings.duration+" 秒" : "",
        settings.audio ? "有声" : ""].filter(Boolean).join(" · ");
      const text = element("textarea");
      text.value = prompt;
      text.readOnly = true;
      text.rows = 6;
      text.style.width = "100%";
      text.setAttribute("aria-label","视频提示词");
      content.replaceChildren(element("h3",job.title),element("p","任务编号 "+job.id),
        element("p",description),text);
      addImage(image,"首帧图");
      references.forEach((src,index)=>addImage(src,"参考图 "+(index+1)));
      if (job.state !== "pending") return;
      const file = element("input");
      file.type = "file";
      file.accept = "video/mp4,.mp4";
      file.setAttribute("aria-label","选择 MP4 成片");
      const deliver = button("上传并交付",async ()=>{
        const clip = file.files[0];
        if (!clip || clip.size > 40*1024*1024 || !/\.mp4$/i.test(clip.name)) {
          status.textContent = "请选择 40 MB 以内的 MP4。";
          return;
        }
        await finish("正在上传成片…",async ()=>{
          const token = await window.manjuAccountToken();
          await read(await fetch("/manual-video/upload?id="+encodeURIComponent(id),{
            method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"video/mp4"},body:clip
          }));
        },"成片已交付。");
      });
      const fail = button("标记无法完成",async ()=>{
        if (!window.confirm("将此任务标记为无法完成？客户可以重新提交。")) return;
        await finish("正在更新任务…",()=>send({action:"fail",id}),"已标记无法完成。");
      });
      content.append(file,deliver,fail);
    } catch (error) { if (request === epoch) status.textContent = error.message; }
  }

  async function finish(waiting,operation,done) {
    if (busy) return;
    busy = true;
    status.textContent = waiting;
    try {
      await operation();
      if (dialog.open) {
        content.replaceChildren();
        status.textContent = done;
      }
    } catch (error) { if (dialog.open) status.textContent = error.message; }
    finally { busy = false; }
  }
  window.addEventListener("manju-account-change",checkAccess);
  void checkAccess();
})();
