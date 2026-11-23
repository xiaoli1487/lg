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
    '<div class="canvas-tools"><div class="canvas-actions"><button type="button" class="button primary" data-canvas="note">＋ 便签</button>' +
    '<button type="button" class="button secondary" data-canvas="image">导入图片</button><input type="file" accept="image/*" multiple hidden>' +
    '<select aria-label="选择分镜"></select><button type="button" class="button secondary" data-canvas="shot">添加分镜</button></div>' +
    '<div class="canvas-actions"><button type="button" class="button secondary" data-canvas="link" aria-pressed="false">连线</button>' +
    '<button type="button" class="button quiet" data-canvas="remove" disabled>删除选中</button></div></div>' +
    '<div class="canvas-surface" tabindex="0" aria-label="画布"><canvas class="canvas-lines" aria-hidden="true"></canvas><div class="canvas-world"></div>' +
    '<div class="canvas-empty"><strong>从一张便签开始</strong><span>也可以拖入图片，或从项目里添加分镜。</span></div>' +
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
  const fileInput = page.querySelector('input[type="file"]');
  const action = name => page.querySelector('[data-canvas="' + name + '"]');
  const width = 232, height = 188;
  const minZoom = .18, maxZoom = 3;
  const maxCards = 200;
  const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
  const finite = (value,fallback = 0) => Number.isFinite(value) ? value : fallback;
  const isImage = value => typeof value === "string" && /^data:image\/(?:jpeg|png|webp);base64,/.test(value);
  let board, picked, linking = false, linkFrom, drag, saveTimer;
  let cards = new Map();

  function boardForProject() {
    const source = project.canvasBoard;
    const ids = new Set();
    const nodes = Array.isArray(source?.nodes) ? source.nodes.slice(0,maxCards).flatMap(node=>{
      if (!node || typeof node.id !== "string" || ids.has(node.id) || !["note","image","shot"].includes(node.kind)) return [];
      ids.add(node.id);
      return [{id:node.id,kind:node.kind,x:finite(node.x),y:finite(node.y),
        title:String(node.title ?? "").slice(0,160), text:String(node.text ?? "").slice(0,2000),
        image:isImage(node.image) ? node.image : ""}];
    }) : [];
    const links = Array.isArray(source?.links) ? source.links.slice(0,500).filter(link=>
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
        else if (board.links.length < 500) board.links.push({from,to});
        linkFrom = null;
        linking = false;
        persist();
        draw();
      }
    }
    updateSelection();
  }

  function render() {
    cards = new Map();
    for (const node of board.nodes) {
      const card = document.createElement("article");
      card.className = "canvas-card canvas-" + node.kind;
      card.dataset.node = node.id;
      card.tabIndex = 0;
      setPosition(node,card);
      const head = document.createElement("div");
      head.className = "canvas-card-head";
      head.textContent = node.title;
      card.setAttribute("aria-label",node.title);
      card.append(head);
      if (node.kind === "note") {
        const input = document.createElement("textarea");
        input.setAttribute("aria-label","便签内容");
        input.placeholder = "写下灵感或镜头备注…";
        input.maxLength = 2000;
        input.value = node.text;
        input.oninput = () => { node.text = input.value; deferSave(); };
        card.append(input);
      } else {
        if (node.image) {
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
        }
      }
      card.addEventListener("focusin",()=>{
        if (!linking) { picked = node.id; updateSelection(); }
      });
      cards.set(node.id,card);
    }
    world.replaceChildren(...cards.values());
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
    const node = {id:crypto.randomUUID(),kind,x,y,title:"",text:"",image:"",...payload};
    board.nodes.push(node);
    picked = node.id;
    return node;
  }

  async function importImages(files, position) {
    const target = board;
    let imported = 0, failed = 0;
    showMessage("正在导入图片…");
    for (const file of files) {
      if (target !== board || target !== project.canvasBoard || page.hidden || target.nodes.length >= maxCards) break;
      try {
        const image = await compressImage(file);
        if (target === board && target === project.canvasBoard && !page.hidden &&
            add("image",{title:file.name.slice(0,160),image},position)) imported++;
      } catch { failed++; }
    }
    if (target !== board || page.hidden) return;
    render();
    persist();
    showMessage(imported ? "已导入 " + imported + " 张图片" + (failed ? "，" + failed + " 张无法读取。" : "。") :
      failed ? "图片无法读取，请换一张图片。" : "没有添加图片。");
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

  function fit() {
    if (!board.nodes.length) {
      board.view = {x:36,y:36,z:1};
    } else {
      const left = Math.min(...board.nodes.map(node=>node.x)), top = Math.min(...board.nodes.map(node=>node.y));
      const w = Math.max(...board.nodes.map(node=>node.x+width))-left;
      const h = Math.max(...board.nodes.map(node=>node.y+height))-top;
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
  action("note").onclick = ()=>{
    const node = add("note",{title:"便签"});
    if (!node) return;
    render();
    persist();
    cards.get(node.id)?.querySelector("textarea").focus();
  };
  action("image").onclick = ()=>fileInput.click();
  fileInput.onchange = ()=>{ const files = [...fileInput.files]; fileInput.value = ""; if (files.length) void importImages(files); };
  action("shot").onclick = ()=>{
    const index = Number(shotSelect.value), shot = project.shots[index];
    if (!shot) return;
    const image = artSource(shot.videoPoster || shot.image || "");
    const title = shot.name || "未命名分镜";
    const node = add("shot",{title:"第 " + (index+1) + " 镜 · " + title,text:(shot.direction || shot.line || "").slice(0,360),
      image:isImage(image) ? image : ""});
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
  action("fit").onclick = fit;

  surface.addEventListener("pointerdown",event=>{
    if (page.hidden || (event.button !== 0 && event.button !== 1) || event.target.closest("button,.canvas-status")) return;
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
    if (event.target.closest("textarea") && !event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode===1 ? 16 : 1);
    zoomTo(board.view.z*Math.exp(-delta*.0018),event.clientX,event.clientY);
  },{passive:false});
  surface.addEventListener("keydown",event=>{
    if (event.target.closest("textarea,button")) return;
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
    const files = [...event.dataTransfer.files].filter(file=>file.type.startsWith("image/"));
    if (files.length) void importImages(files,coordinates(event.clientX,event.clientY));
  });
  new ResizeObserver(draw).observe(surface);
})();
