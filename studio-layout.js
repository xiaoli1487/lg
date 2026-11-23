(() => {
  const app = document.querySelector("#workspace");
  const tabs = [
    ["shot","镜头"],
    ["generation","生成"],
    ["media","素材"]
  ];
  let active = "shot";
  const storySectionsOpen = new Set();

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

  function disclosure(key, title, nodes, extraClass = "") {
    const details = document.createElement("details");
    details.className = "story-disclosure " + extraClass;
    details.open = storySectionsOpen.has(key);
    const summary = document.createElement("summary");
    summary.textContent = title;
    details.append(summary,...nodes);
    details.addEventListener("toggle",()=>{
      if (!details.isConnected) return;
      if (details.open) storySectionsOpen.add(key);
      else storySectionsOpen.delete(key);
    });
    return details;
  }

  function organizeStory() {
    const stack = app.querySelector(".guide > .writing-stack");
    const guide = stack?.parentElement;
    if (!guide || guide.classList.contains("studio-story")) return;
    const cards = [...stack.children];
    const form = cards[0];
    const heading = form?.querySelector("h2");
    const idea = form?.querySelector("#story-idea")?.closest("label");
    const length = form?.querySelector('[data-author="length"]')?.closest("label");
    const purpose = form?.querySelector('[data-author="purpose"]')?.closest("label");
    const primary = form?.querySelector('[data-action="ai-story"]');
    const imported = form?.querySelector('[data-action="paste-script"]');
    const quick = form?.querySelector('[data-action="write-all"]');
    const original = guide.querySelector("#story-text")?.closest("aside");
    if (!heading || !idea || !length || !purpose || !primary || !imported || !quick || !original) return;

    const originalActions = primary.parentElement;
    const sample = originalActions.querySelector('[data-action="sample"]');
    const advancedActions = document.createElement("div");
    advancedActions.className = "actions story-advanced-actions";
    for (const action of ['episode','setup-service']) {
      const button = originalActions.querySelector('[data-action="' + action + '"]');
      if (button) advancedActions.append(button);
    }
    const mainActions = document.createElement("div");
    mainActions.className = "actions story-main-actions";
    mainActions.append(primary);
    if (sample) mainActions.append(sample);

    const basics = document.createElement("div");
    basics.className = "story-basics";
    basics.append(purpose,length);

    const backup = [...form.querySelectorAll(":scope > details")].find(node=>node.querySelector("#restore-project"));
    const settings = [...form.children].filter(node=>node !== heading && node !== idea && node !== originalActions && node !== backup);
    const settingsBody = document.createElement("div");
    settingsBody.className = "story-settings-body";
    for (const node of settings) if (node.childElementCount) settingsBody.append(node);
    if (advancedActions.childElementCount) settingsBody.append(advancedActions);
    form.replaceChildren(heading,idea,basics,mainActions,disclosure("settings","创作设置",[settingsBody]));
    form.classList.add("story-compose");

    const tools = document.createElement("section");
    tools.className = "card guide-card story-tools";
    const toolsTitle = document.createElement("h2");
    toolsTitle.textContent = "已有素材";
    imported.classList.replace("quiet","secondary");
    tools.append(toolsTitle,imported);
    const existingCopy = [...original.children].filter(node=>node.tagName !== "H2");
    tools.append(disclosure("dialogue","粘贴对白拆分镜",existingCopy));
    const draft = cards.find(card=>card.querySelector("#screenplay-text"));
    if (draft) {
      const draftContents = [...draft.children].filter(node=>node.tagName !== "H2");
      tools.append(disclosure("draft","剧本草稿",draftContents));
      draft.remove();
    }
    const roles = cards.find(card=>card.querySelector("[data-role-import]"));
    if (roles) {
      const roleContents = [...roles.children].filter(node=>node.tagName !== "H2");
      tools.append(disclosure("roles","角色参考库",roleContents));
      roles.remove();
    }
    tools.append(disclosure("offline","离线拆镜",[quick]));
    if (backup) tools.append(disclosure("backup","项目备份与恢复",[...backup.children].filter(node=>node.tagName !== "SUMMARY")));
    original.replaceWith(tools);
    guide.classList.add("studio-story");
  }

  function organizeWorkspace() {
    organizeEditor();
    organizeStory();
  }

  new MutationObserver(organizeWorkspace).observe(app,{childList:true});
  organizeWorkspace();
})();
