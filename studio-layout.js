(() => {
  const app = document.querySelector("#workspace");
  const tabs = [
    ["shot","镜头"],
    ["generation","生成"],
    ["media","素材"]
  ];
  let active = "shot";

  function organizeEditor() {
    const editor = app.querySelector(".editor-layout");
    const inspector = editor?.querySelector(".inspector");
    const body = inspector?.querySelector(".inspector-body");
    if (!body || body.classList.contains("studio-tab-body")) return;

    const timeline = editor.querySelector(".storyboard");
    const anchor = body.querySelector('[data-action="frame-prompt"]');
    const video = body.querySelector(".video-tools:not([data-wan-animation])");
    if (!timeline || !anchor || !video) return;

    const list = document.createElement("div");
    list.className = "studio-tab-list";
    list.setAttribute("role","tablist");
    list.setAttribute("aria-label","分镜编辑");
    const controls = new Map();

    for (const [key,label] of tabs) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = "studio-tab-" + key;
      button.textContent = label;
      button.setAttribute("role","tab");
      button.setAttribute("aria-controls","studio-panel-" + key);
      const panel = document.createElement("div");
      panel.className = "studio-tab-panel";
      panel.id = "studio-panel-" + key;
      panel.setAttribute("role","tabpanel");
      panel.setAttribute("aria-labelledby",button.id);
      panel.tabIndex = 0;
      button.onclick = () => select(key);
      controls.set(key,{button,panel});
      list.append(button);
    }

    function select(key) {
      active = key;
      for (const [name,{button,panel}] of controls) {
        const selected = name === key;
        button.setAttribute("aria-selected",String(selected));
        button.tabIndex = selected ? 0 : -1;
        panel.hidden = !selected;
      }
    }

    list.addEventListener("keydown",event=>{
      const keys = tabs.map(([key])=>key);
      const index = keys.indexOf(active);
      const destination = {
        ArrowLeft:(index + keys.length - 1) % keys.length,
        ArrowRight:(index + 1) % keys.length,
        Home:0,
        End:keys.length - 1
      }[event.key];
      if (destination === undefined) return;
      event.preventDefault();
      select(keys[destination]);
      controls.get(active).button.focus();
    });

    let section = "shot";
    for (const node of [...body.children]) {
      if (node === anchor) section = "generation";
      controls.get(section).panel.append(node);
      if (node === video) section = "media";
    }
    body.classList.add("studio-tab-body");
    body.before(list);
    body.append(...Array.from(controls.values(),entry=>entry.panel));
    editor.classList.add("studio-editor");
    editor.prepend(timeline);
    select(active);
  }

  new MutationObserver(organizeEditor).observe(app,{childList:true});
  organizeEditor();
})();
