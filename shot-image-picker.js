(() => {
  const catalog = JSON.parse(document.getElementById("shot-image-catalog").textContent);
  const models = catalog.models;
  const defaultModel = models.find(model=>model.id===catalog.defaultId);
  const currentModel = () => models.find(model=>model.id===project.author.shotImageModel) ?? defaultModel;
  const originalRequest = requestGeneration;
  const originalFee = generationFee;
  const originalBatch = drawMissingShots;
  let batchModel;

  generationFee = (route, count = 1) => {
    if (route !== "/shot-image") return originalFee(route,count);
    const model = batchModel || currentModel();
    return "本次使用"+model.name+"，最多消耗 "+model.points*count+" 积分，生成失败会退回该次积分。";
  };

  requestGeneration = (route, body) => {
    if (route !== "/shot-image") return originalRequest(route,body);
    const model = batchModel || currentModel();
    return originalRequest(route,{...body,shotImageModel:model.id,quotedPoints:model.points});
  };

  drawMissingShots = async () => {
    if (batchModel) return;
    batchModel = currentModel();
    try {
      return await originalBatch();
    } finally {
      batchModel = undefined;
      renderPicker();
    }
  };

  function renderPicker() {
    const anchor = workspace.querySelector('[data-action="frame-prompt"]');
    if (!anchor) return;
    const model = batchModel || currentModel();
    let label = workspace.querySelector("[data-shot-image-picker]");
    if (!label) {
      label = document.createElement("label");
      label.className = "field";
      label.dataset.shotImagePicker = "";
      const select = document.createElement("select");
      select.append(...models.map(item=>new Option(item.name+" · "+item.points+" 积分／张",item.id)));
      select.addEventListener("change",()=>{
        if (batchModel) {
          renderPicker();
          return;
        }
        project.author.shotImageModel = select.value;
        void save();
      });
      label.append("分镜图模型",select);
      anchor.before(label);
    }
    const select = label.querySelector("select");
    select.value = model.id;
    select.disabled = Boolean(batchModel);
  }

  new MutationObserver(renderPicker).observe(workspace,{childList:true});
  renderPicker();
})();
