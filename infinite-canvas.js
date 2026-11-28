(() => {
  const editor = document.querySelector("#workspace");
  const navigation = document.querySelector(".sidebar nav");
  if (!editor || !navigation) return;

  const entry = document.createElement("button");
  entry.type = "button";
  entry.className = "canvas-entry";
  entry.textContent = "无限画布";
  navigation.append(entry);

  const page = document.createElement("section");
  page.className = "canvas-workspace";
  page.hidden = true;
  page.setAttribute("aria-labelledby","canvas-title");
  page.innerHTML = '<header class="canvas-header"><div><span class="canvas-project"></span><h1 id="canvas-title">无限画布</h1></div>' +
    '<button type="button" class="button secondary" data-canvas="back">返回制作</button></header>' +
    '<div class="canvas-tools"><div class="canvas-actions"><select aria-label="选择分镜"></select>' +
    '<button type="button" class="button primary" data-canvas="extract">一键导入素材</button>' +
    '<button type="button" class="button secondary" data-canvas="shot">添加分镜卡片</button></div>' +
    '<div class="canvas-actions"><button type="button" class="button secondary" data-canvas="text">＋ 文本节点</button>' +
    '<button type="button" class="button secondary" data-canvas="image">＋ 图片节点</button><input type="file" accept="image/*" multiple hidden>' +
    '<button type="button" class="button secondary" data-canvas="video">＋ 视频节点</button><input type="file" accept="video/*,.mp4,.webm,.mov" multiple hidden>' +
    '<button type="button" class="button secondary" data-canvas="link" aria-pressed="false">连线</button>' +
    '<button type="button" class="button quiet" data-canvas="remove" disabled>删除选中</button></div></div>' +
    '<div class="canvas-surface" tabindex="0" aria-label="画布"><canvas class="canvas-lines" aria-hidden="true"></canvas><div class="canvas-world"></div>' +
    '<div class="canvas-empty"><strong>选择分镜后，点「一键导入素材」</strong><span>也可以把图片和视频拖到这里。</span></div>' +
    '<div class="canvas-bottom"><span class="canvas-status" role="status"></span><div class="canvas-zoom">' +
    '<button type="button" class="button quiet" data-canvas="out" aria-label="缩小">−</button>' +
    '<button type="button" class="button quiet" data-canvas="reset" aria-label="恢复百分之百">100%</button>' +
    '<button type="button" class="button quiet" data-canvas="in" aria-label="放大">＋</button>' +
    '<button type="button" class="button quiet" data-canvas="fit">适应内容</button></div></div></div>';
  editor.after(page);

  const surface = page.querySelector(".canvas-surface");
  const world = page.querySelector(".canvas-world");
  const lines = page.querySelector(".canvas-lines");
  const empty = page.querySelector(".canvas-empty");
  const status = page.querySelector(".canvas-status");
  const shotSelect = page.querySelector("select");
  const action = name => page.querySelector('[data-canvas="' + name + '"]');
  const width = 232, height = 188;
  const minZoom = .18, maxZoom = 3;
  const maxCards = 200;
  const maxLinks = 500;
  const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
  const finite = (value,fallback = 0) => Number.isFinite(value) ? value : fallback;
  const isImage = value => typeof value === "string" && /^data:image\/(?:jpeg|png|webp);base64,/.test(value);
  const isVideo = value => value instanceof Blob && value.size > 0;
  const kinds = {text:"文本",image:"图片",video:"视频",shot:"分镜"};
  let board, picked, linking = false, linkFrom, drag, saveTimer;
  const cards = new Map();
  const videoUrls = new Map();

  function boardForProject() {
    const source = project.canvasBoard;
    const ids = new Set();
    const nodes = Array.isArray(source?.nodes) ? source.nodes.slice(0,maxCards).flatMap(node=>{
      const kind = node?.kind === "note" ? "text" : node?.kind;
      if (!node || typeof node.id !== "string" || ids.has(node.id) || !Object.hasOwn(kinds,kind)) return [];
      ids.add(node.id);
      const image = typeof node.image === "string" ? artSource(node.image) : "";
      return [{id:node.id,kind,x:finite(node.x),y:finite(node.y),
        title:String(node.title || kinds[kind]).slice(0,160), text:String(node.text ?? "").slice(0,12000),
        image:isImage(image) ? image : "", video:kind === "video" && isVideo(node.video) ? node.video : null,
        shotId:typeof node.shotId === "string" ? node.shotId : "",
        sourceNode:typeof node.sourceNode === "string" ? node.sourceNode : ""}];
    }) : [];
    const links = Array.isArray(source?.links) ? source.links.slice(0,maxLinks).filter(link=>
      link && link.from !== link.to && ids.has(link.from) && ids.has(link.to)
    ).map(({from,to})=>({from,to})) : [];
    return project.canvasBoard = {
      nodes,links,view:{x:finite(source?.view?.x,36),y:finite(source?.view?.y,36),
        z:clamp(finite(source?.view?.z,1),minZoom,maxZoom)}
    };
  }

  function persist() {
    clearTimeout(saveTimer);
    if (board === project.canvasBoard) void save();
  }

  function deferSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist,240);
  }

  function showMessage(text = "") {
    status.textContent = text;
  }

  function fillShotPicker() {
    const previous = shotSelect.value;
    shotSelect.replaceChildren(...project.shots.map((shot,index)=>
      new Option((index + 1) + " · " + (shot.name || "未命名分镜"),String(index))
    ));
    if (previous && Number(previous) < project.shots.length) shotSelect.value = previous;
    else if (project.shots[selected]) shotSelect.value = String(selected);
    action("shot").disabled = !project.shots.length;
    action("extract").disabled = !project.shots.length;
  }

  function open() {
    if (!ready || exportJob || !page.hidden) return;
    board = boardForProject();
    picked = null;
    linking = false;
    linkFrom = null;
    editor.closest("main").classList.add("canvas-open");
    navigation.classList.add("canvas-nav-active");
    entry.setAttribute("aria-current","page");
    page.hidden = false;
    page.querySelector(".canvas-project").textContent = project.title || "未命名漫剧";
    fillShotPicker();
    render();
    surface.focus();
  }

  function close(returnFocus = false) {
    if (page.hidden) return;
    if (drag) stopDrag(true);
    persist();
    releaseVideos();
    page.hidden = true;
    editor.closest("main").classList.remove("canvas-open");
    navigation.classList.remove("canvas-nav-active");
    entry.removeAttribute("aria-current");
    if (returnFocus) entry.focus();
  }

  function coordinates(clientX,clientY) {
    const rect = surface.getBoundingClientRect(), {x,y,z} = board.view;
    return {x:(clientX - rect.left - x)/z,y:(clientY - rect.top - y)/z};
  }

  function setPosition(node, card) {
    card.style.left = node.x + "px";
    card.style.top = node.y + "px";
  }

  function draw() {
    if (!board || page.hidden) return;
    const {x,y,z} = board.view;
    world.style.transform = "translate(" + x + "px," + y + "px) scale(" + z + ")";
    const spacing = Math.max(10,24 * z);
    surface.style.backgroundSize = spacing + "px " + spacing + "px";
    surface.style.backgroundPosition = x % spacing + "px " + y % spacing + "px";
    action("reset").textContent = Math.round(z*100) + "%";
    const ratio = Math.min(devicePixelRatio || 1,2);
    const w = Math.round(surface.clientWidth * ratio), h = Math.round(surface.clientHeight * ratio);
    if (lines.width !== w) lines.width = w;
    if (lines.height !== h) lines.height = h;
    const ctx = lines.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio,0,0,ratio,0,0);
    ctx.clearRect(0,0,surface.clientWidth,surface.clientHeight);
    const nodes = new Map(board.nodes.map(node=>[node.id,node]));
    ctx.lineWidth = 2;
    ctx.strokeStyle = getComputedStyle(surface).getPropertyValue("--accent").trim() || "#b8a6ff";
    for (const link of board.links) {
      const a = nodes.get(link.from), b = nodes.get(link.to);
      if (!a || !b) continue;
      const left = a.x <= b.x;
      const ax = (a.x + (left ? width : 0)) * z + x, ay = (a.y + height/2) * z + y;
      const bx = (b.x + (left ? 0 : width)) * z + x, by = (b.y + height/2) * z + y;
      const bend = Math.max(24,Math.abs(bx-ax)*.42) * (left ? 1 : -1);
      ctx.beginPath();
      ctx.moveTo(ax,ay);
      ctx.bezierCurveTo(ax+bend,ay,bx-bend,by,bx,by);
      ctx.stroke();
    }
  }

  function updateSelection() {
    for (const [id,card] of cards) {
      card.classList.toggle("is-selected",id===picked);
      card.classList.toggle("is-link-start",id===linkFrom);
    }
    action("remove").disabled = !picked;
    action("link").setAttribute("aria-pressed",String(linking));
    showMessage(linking ? (linkFrom ? "点选另一张卡片完成连线" : "点选连线的起始卡片") : "");
  }

  function interact(node) {
    picked = node.id;
    if (linking) {
      if (!linkFrom) linkFrom = node.id;
      else if (linkFrom !== node.id) {
        const from = linkFrom, to = node.id;
        const existing = board.links.findIndex(link=>(link.from === from && link.to === to) || (link.from === to && link.to === from));
        if (existing >= 0) board.links.splice(existing,1);
        else if (board.links.length < maxLinks) board.links.push({from,to});
        linkFrom = null;
        linking = false;
        persist();
        draw();
      }
    }
    updateSelection();
  }

  function releaseVideos() {
    for (const [id,url] of videoUrls) {
      const video = cards.get(id)?.querySelector("video");
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      URL.revokeObjectURL(url);
    }
    videoUrls.clear();
    world.replaceChildren();
    cards.clear();
  }

  function render() {
    for (const [id,card] of cards) {
      if (board.nodes.some(node=>node.id === id)) continue;
      card.querySelector("video")?.pause();
      card.remove();
      if (videoUrls.has(id)) URL.revokeObjectURL(videoUrls.get(id));
      videoUrls.delete(id);
      cards.delete(id);
    }
    for (const node of board.nodes) {
      if (cards.has(node.id)) continue;
      const card = document.createElement("article");
      card.className = "canvas-card canvas-" + node.kind;
      card.dataset.node = node.id;
      card.tabIndex = 0;
      setPosition(node,card);
      const head = document.createElement("div");
      head.className = "canvas-card-head";
      head.textContent = kinds[node.kind] + " · " + node.title;
      head.title = node.title;
      card.setAttribute("aria-label",node.title);
      card.append(head);
      if (node.kind === "text") {
        const input = document.createElement("textarea");
        input.setAttribute("aria-label","文本节点内容");
        input.placeholder = "写下灵感或镜头备注…";
        input.maxLength = 12000;
        input.value = node.text;
        input.oninput = () => { node.text = input.value; deferSave(); };
        card.append(input);
      } else {
        if (node.kind === "video" && isVideo(node.video)) {
          const video = document.createElement("video");
          const url = URL.createObjectURL(node.video);
          videoUrls.set(node.id,url);
          video.controls = true;
          video.playsInline = true;
          video.preload = "none";
          video.poster = node.image;
          video.addEventListener("error",()=>showMessage("无法播放此视频，请试试 H.264 MP4 或 WebM。"));
          video.src = url;
          card.append(video);
        } else if (node.image) {
          const image = document.createElement("img");
          image.src = node.image;
          image.alt = "";
          image.draggable = false;
          card.append(image);
        }
        if (node.kind === "shot") {
          const details = document.createElement("p");
          details.textContent = node.text;
          card.append(details);
          const extract = document.createElement("button");
          extract.type = "button";
          extract.className = "button secondary canvas-extract";
          extract.textContent = "一键导入素材";
          extract.onclick = () => extractShot(node);
          card.append(extract);
        }
      }
      card.addEventListener("focusin",()=>{
        if (!linking) { picked = node.id; updateSelection(); }
      });
      cards.set(node.id,card);
      world.append(card);
    }
    empty.hidden = board.nodes.length > 0;
    updateSelection();
    draw();
  }

  function add(kind, payload, position) {
    if (board.nodes.length >= maxCards) { showMessage("当前项目已添加 200 张卡片。"); return null; }
    const rect = surface.getBoundingClientRect();
    const center = position ?? coordinates(rect.left + rect.width*.48,rect.top + rect.height*.43);
    const baseX = Math.round(center.x - width/2), baseY = Math.round(center.y - height/2);
    let x = baseX, y = baseY;
    if (position) {
      while (board.nodes.some(node=>Math.abs(node.x-x)<26 && Math.abs(node.y-y)<26)) { x+=32; y+=32; }
    } else {
      let cell = 0;
      const columns = surface.clientWidth > 820 ? [0,1,-1] : [0,1];
      while (board.nodes.some(node=>Math.abs(node.x-x)<width+16 && Math.abs(node.y-y)<height+16)) {
        cell++;
        x = baseX + columns[cell % columns.length]*(width+28);
        y = baseY + Math.floor(cell/columns.length)*(height+28);
      }
    }
    const node = {id:crypto.randomUUID(),kind,x,y,title:"",text:"",image:"",video:null,...payload};
    board.nodes.push(node);
    picked = node.id;
    return node;
  }

  function shotText(shot) {
    return [shot.direction,shot.line].filter((text,index,values)=>text?.trim() && values.indexOf(text) === index).join("\n\n");
  }

  function shotImage(shot) {
    return [shot.image,shot.videoPoster].map(src=>artSource(src || "")).find(isImage) || "";
  }

  function extractShot(node, selectedShot = null, index = -1) {
    const legacy = /^第 (\d+) 镜 · (.*)$/.exec(node?.title || "");
    const candidate = legacy && project.shots[Number(legacy[1])-1];
    const shot = selectedShot || (node?.shotId ? project.shots.find(shot=>shot.canvasSourceId === node.shotId) :
      candidate && (candidate.name || "未命名分镜") === legacy[2] ? candidate : null);
    const text = (shot && shotText(shot)) || node?.text || "";
    const image = shot ? shotImage(shot) : node?.image;
    const choices = [
      ["text","分镜文字",text.trim() && {text:text.slice(0,12000)}],
      ["image","首帧图",isImage(image) && {image}],
      ["video","分镜视频",isVideo(shot?.video) && {video:shot.video,image:isImage(image) ? image : ""}]
    ];
    const available = choices.filter(([, ,payload])=>payload);
    const existing = node ? board.nodes.filter(item=>item.sourceNode === node.id) : [];
    const missing = available.filter(([kind])=>!existing.some(item=>item.kind === kind));
    if (!missing.length) {
      if (existing.length) fit([node,...existing]);
      showMessage(available.length ? "该分镜的素材已在画布上。" : "该分镜暂无可导入的素材。");
      return;
    }
    if (missing.length + Number(!node) > maxCards-board.nodes.length) {
      showMessage("画布空间不足，请删除部分节点后重新导入。");
      return;
    }
    if (!node) node = addShotCard(shot,index);
    if (shot && !node.shotId) node.shotId = shot.canvasSourceId ||= crypto.randomUUID();
    const added = missing.map(([kind,title,payload],index)=>{
      const x = node.x + width + 64;
      let y = node.y + index*(height+32);
      while (board.nodes.some(item=>Math.abs(item.x-x)<width+18 && Math.abs(item.y-y)<height+18)) y += height+32;
      return add(kind,{title:(node.title + " · " + title).slice(0,160),sourceNode:node.id,...payload},
        {x:x+width/2,y:y+height/2});
    });
    for (const item of added) {
      if (board.links.length < maxLinks) board.links.push({from:node.id,to:item.id});
    }
    picked = node.id;
    render();
    fit([node,...existing,...added]);
    showMessage("已导入" + missing.map(([,title])=>title).join("、") + (shot && !shot.video ? "。本镜暂无视频。" : "。"));
  }

  function mediaKind(file) {
    if (file.type.startsWith("image/") || /\.(?:avif|gif|jpe?g|png|webp)$/i.test(file.name)) return "image";
    if (file.type.startsWith("video/") || /\.(?:mp4|webm|m4v|mov)$/i.test(file.name)) return "video";
    return null;
  }

  async function importMedia(files, position, kind) {
    const target = board;
    let imported = 0, failed = 0;
    showMessage("正在读取素材…");
    for (const file of files) {
      if (target !== board || target !== project.canvasBoard || page.hidden || target.nodes.length >= maxCards) break;
      try {
        const type = kind || mediaKind(file);
        let payload;
        if (type === "image") {
          const image = await compressImage(file);
          if (!isImage(image)) throw Error("图片不可用");
          payload = {image};
        } else if (type === "video") {
          const clip = await loadClip(file);
          releaseClip(clip);
          payload = {video:file.type.startsWith("video/") ? file : file.slice(0,file.size,"application/octet-stream")};
        } else { failed++; continue; }
        if (target === board && target === project.canvasBoard && !page.hidden &&
            add(type,{title:file.name.slice(0,160),...payload},position)) imported++;
      } catch { failed++; }
    }
    if (target !== board || target !== project.canvasBoard || page.hidden) return;
    render();
    persist();
    const remaining = files.length-imported-failed;
    showMessage("已导入 " + imported + " 个素材" + (failed ? "，" + failed + " 个无法读取" : "") +
      (remaining ? "，" + remaining + " 个未添加（画布最多 200 个节点）" : "") + "。");
  }

  function zoomTo(z, clientX,clientY) {
    const rect = surface.getBoundingClientRect();
    const px = clientX ?? rect.left + rect.width/2, py = clientY ?? rect.top + rect.height/2;
    const before = coordinates(px,py);
    board.view.z = clamp(z,minZoom,maxZoom);
    board.view.x = px - rect.left - before.x*board.view.z;
    board.view.y = py - rect.top - before.y*board.view.z;
    draw();
    deferSave();
  }

  function fit(nodes = board.nodes) {
    if (!nodes.length) {
      board.view = {x:36,y:36,z:1};
    } else {
      const left = Math.min(...nodes.map(node=>node.x)), top = Math.min(...nodes.map(node=>node.y));
      const w = Math.max(...nodes.map(node=>node.x+width))-left;
      const h = Math.max(...nodes.map(node=>node.y+height))-top;
      const z = clamp(Math.min((surface.clientWidth-70)/w,(surface.clientHeight-108)/h,1),minZoom,maxZoom);
      board.view = {z,x:(surface.clientWidth-w*z)/2-left*z,y:(surface.clientHeight-45-h*z)/2-top*z};
    }
    draw();
    persist();
  }

  function removeSelected() {
    if (!picked) return;
    board.nodes = board.nodes.filter(node=>node.id !== picked);
    board.links = board.links.filter(link=>link.from !== picked && link.to !== picked);
    if (picked === linkFrom) linkFrom = null;
    picked = null;
    render();
    persist();
    surface.focus();
  }

  function stopDrag(finish) {
    const previous = drag;
    if (!previous) return;
    drag = null;
    surface.classList.remove("is-dragging");
    if (surface.hasPointerCapture(previous.pointer)) surface.releasePointerCapture(previous.pointer);
    if (finish && previous.moved) persist();
  }

  entry.onclick = open;
  navigation.querySelectorAll("[data-step]").forEach(button=>button.addEventListener("click",()=>close(),{capture:true}));
  action("back").onclick = ()=>close(true);
  action("text").onclick = ()=>{
    const node = add("text",{title:"新文本"});
    if (!node) return;
    render();
    persist();
    cards.get(node.id)?.querySelector("textarea").focus();
  };
  for (const kind of ["image","video"]) {
    const button = action(kind), input = button.nextElementSibling;
    button.onclick = ()=>input.click();
    input.onchange = ()=>{
      const files = [...input.files];
      input.value = "";
      if (files.length) void importMedia(files,undefined,kind);
    };
  }
  function shotTitle(shot,index) {
    return ("第 " + (index+1) + " 镜 · " + (shot.name || "未命名分镜")).slice(0,160);
  }

  function addShotCard(shot,index) {
    return add("shot",{title:shotTitle(shot,index),text:shotText(shot).slice(0,12000),
      image:shotImage(shot),shotId:shot.canvasSourceId ||= crypto.randomUUID()});
  }

  action("extract").onclick = ()=>{
    const index = Number(shotSelect.value), shot = project.shots[index];
    if (!shot) return;
    const node = board.nodes.find(item=>item.kind === "shot" && (item.shotId ?
      item.shotId === shot.canvasSourceId : item.title === shotTitle(shot,index)));
    extractShot(node,shot,index);
  };
  action("shot").onclick = ()=>{
    const index = Number(shotSelect.value), shot = project.shots[index];
    if (!shot) return;
    const node = addShotCard(shot,index);
    if (!node) return;
    render();
    persist();
    cards.get(node.id)?.focus();
  };
  action("link").onclick = ()=>{ linking = !linking; linkFrom = null; updateSelection(); };
  action("remove").onclick = removeSelected;
  action("in").onclick = ()=>zoomTo(board.view.z*1.25);
  action("out").onclick = ()=>zoomTo(board.view.z/1.25);
  action("reset").onclick = ()=>zoomTo(1);
  action("fit").onclick = ()=>fit();

  surface.addEventListener("pointerdown",event=>{
    if (page.hidden || (event.button !== 0 && event.button !== 1) || event.target.closest("button,video,.canvas-status")) return;
    const card = event.target.closest("[data-node]");
    if (event.button === 0 && event.target.closest("textarea") && !linking) return;
    const node = event.button === 0 && board.nodes.find(item=>item.id === card?.dataset.node);
    if (node) interact(node);
    else if (event.button === 0) { picked = null; updateSelection(); }
    if (linking || (node && !event.target.closest(".canvas-card-head"))) return;
    if (drag) return;
    event.preventDefault();
    surface.focus({preventScroll:true});
    const target = node || board.view;
    drag = {pointer:event.pointerId,node,target,startX:event.clientX,startY:event.clientY,x:target.x,y:target.y,moved:false};
    surface.setPointerCapture(event.pointerId);
    surface.classList.add("is-dragging");
  });
  surface.addEventListener("pointermove",event=>{
    if (!drag || drag.pointer !== event.pointerId) return;
    const dx = event.clientX-drag.startX, dy = event.clientY-drag.startY;
    if (!drag.moved && Math.hypot(dx,dy)<3) return;
    drag.moved = true;
    const scale = drag.node ? board.view.z : 1;
    drag.target.x = drag.x + dx/scale;
    drag.target.y = drag.y + dy/scale;
    if (drag.node) setPosition(drag.node,cards.get(drag.node.id));
    draw();
  });
  for (const type of ["pointerup","pointercancel","lostpointercapture"]) {
    surface.addEventListener(type,event=>{ if (drag?.pointer === event.pointerId) stopDrag(true); });
  }
  surface.addEventListener("wheel",event=>{
    if (event.target.closest("textarea,.canvas-shot p") && !event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode===1 ? 16 : 1);
    zoomTo(board.view.z*Math.exp(-delta*.0018),event.clientX,event.clientY);
  },{passive:false});
  surface.addEventListener("keydown",event=>{
    if (event.target.closest("textarea,button,video")) return;
    const node = board.nodes.find(item=>item.id === picked);
    const delta = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if (delta) {
      event.preventDefault();
      const target = node || board.view;
      const multiplier = node ? 12 : 35;
      target.x += delta[0]*multiplier;
      target.y += delta[1]*multiplier;
      if (node) setPosition(node,cards.get(node.id));
      draw();
      deferSave();
    } else if (event.key === "Delete" && picked) {
      event.preventDefault();
      removeSelected();
    } else if (event.key === "Enter" && linking) {
      const target = board.nodes.find(item=>item.id === event.target.closest("[data-node]")?.dataset.node) || node;
      if (!target) return;
      event.preventDefault();
      interact(target);
    } else if (event.key === "Escape" && linking) {
      linking = false; linkFrom = null; updateSelection();
    }
  });
  surface.addEventListener("dragover",event=>{
    if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }
  });
  surface.addEventListener("drop",event=>{
    event.preventDefault();
    const files = [...event.dataTransfer.files];
    if (files.length) void importMedia(files,coordinates(event.clientX,event.clientY));
  });
  new ResizeObserver(draw).observe(surface);
})();
