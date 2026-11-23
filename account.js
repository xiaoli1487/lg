const entry = document.createElement("button");
entry.className = "button secondary";
entry.textContent = "注册 / 登录";
document.querySelector(".top-actions").prepend(entry);

const dialog = document.createElement("dialog");
dialog.setAttribute("aria-labelledby","account-title");
dialog.innerHTML = `<form style="padding:1.25rem;min-width:min(320px,75vw)">
  <div class="dialog-title"><h2 id="account-title">登录工坊</h2><button type="button" class="icon-button" data-close aria-label="关闭">×</button></div>
  <label class="field">邮箱<input name="email" type="email" autocomplete="email" required></label>
  <label class="field" data-password>密码<input name="password" type="password" autocomplete="current-password" required></label>
  <p role="status" aria-live="polite"></p>
  <button class="button primary" type="submit">登录</button>
  <button class="button secondary" type="button" data-switch>注册账号</button>
  <button class="button quiet" type="button" data-reset>找回密码</button>
</form>`;
document.body.append(dialog);
const form = dialog.querySelector("form");
const password = form.elements.password;
const email = form.elements.email;
const status = form.querySelector('[role="status"]');
const submit = form.querySelector('[type="submit"]');
const change = form.querySelector("[data-switch]");
const reset = form.querySelector("[data-reset]");
let mode = "login", auth, sdk, loading, inviteOnly = false;
const creditMode = Boolean(document.documentElement.dataset.creditProvider);
const walletStatus = document.createElement("p");
walletStatus.setAttribute("role","status");
walletStatus.hidden = true;
status.after(walletStatus);
const retryWallet = document.createElement("button");
retryWallet.type = "button";
retryWallet.className = "button secondary";
retryWallet.textContent = "重试查询";
retryWallet.hidden = true;
walletStatus.after(retryWallet);
let walletRequest = 0;
retryWallet.onclick = () => void refreshCredits();
const packageList = document.createElement("ul");
packageList.hidden = true;
walletStatus.after(packageList);
const rechargePanel = document.createElement("section");
rechargePanel.hidden = true;
rechargePanel.innerHTML = `
  <p data-prices></p>
  <p data-contact></p>
  <label class="field" data-offer>充值套餐<select></select></label>
  <button type="button" class="button secondary" data-copy-recharge>复制充值信息</button>
  <textarea class="field" readonly hidden aria-label="充值信息"></textarea>
  <p role="status"></p>`;
packageList.after(rechargePanel);
const buyerPack = rechargePanel.querySelector("select");
const copyRecharge = rechargePanel.querySelector("[data-copy-recharge]");
const rechargeText = rechargePanel.querySelector("textarea");
const copyStatus = rechargePanel.querySelector('[role="status"]');
const giftForm = document.createElement("form");
giftForm.hidden = true;
giftForm.className = "inspector-body";
giftForm.innerHTML = `
  <h3>赠送积分</h3>
  <label class="field">客户账号编号（User UID）<input name="uid" required minlength="36" maxlength="36" spellcheck="false"></label>
  <label class="field">赠送积分数<input name="points" required type="number" min="0.1" max="214748364.7" step="0.1"></label>
  <label class="field">赠送备注<input name="note" required maxlength="200" placeholder="例如：试运营测试"></label>
  <button class="button primary" type="submit">确认赠送</button>
  <p role="status"></p>`;
dialog.append(giftForm);
const giftStatus = giftForm.querySelector('[role="status"]');
const giftSubmit = giftForm.querySelector('button[type="submit"]');
const pendingGifts = new Map();
const rechargeForm = document.createElement("form");
rechargeForm.hidden = true;
rechargeForm.className = "inspector-body";
rechargeForm.innerHTML = `
  <h3>确认到账并加积分</h3>
  <label class="field">客户账号编号<input name="uid" required maxlength="128"></label>
  <label class="field">收款渠道<select name="channel"><option value="wechat">微信</option><option value="alipay">支付宝</option></select></label>
  <label class="field">收款记录中的交易单号<input name="transactionId" required minlength="8" maxlength="80"></label>
  <label class="field">实收金额（元）<input name="amount" required type="number" min="0.01" step="0.01"></label>
  <label class="field">充值套餐<select name="packageId" required></select></label>
  <button class="button primary" type="submit">确认已到账并加分</button>
  <p role="status"></p>`;
dialog.append(rechargeForm);
const inviteForm = document.createElement("form");
inviteForm.hidden = true;
inviteForm.className = "inspector-body";
inviteForm.innerHTML = `
  <h3>开通试运营账号</h3>
  <label class="field">客户邮箱<input name="email" type="email" required maxlength="254"></label>
  <button class="button primary" type="submit">开通账号</button>
  <details>
    <summary>重置已有客户的密码</summary>
    <label class="field">客户账号编号（User UID）<input name="resetUid" maxlength="36"></label>
    <button class="button secondary" type="button" data-reset-invite>生成新密码</button>
  </details>
  <p role="status"></p>
  <textarea readonly hidden rows="5" style="width:100%" aria-label="账号登录信息"></textarea>
  <button class="button secondary" type="button" data-copy-invite hidden>复制登录信息</button>`;
dialog.append(inviteForm);
const inviteStatus = inviteForm.querySelector('[role="status"]');
const inviteResult = inviteForm.querySelector("textarea");
const inviteSubmit = inviteForm.querySelector('button[type="submit"]');
const resetInvite = inviteForm.querySelector("[data-reset-invite]");
const copyInvite = inviteForm.querySelector("[data-copy-invite]");
const changePassword = document.createElement("button");
changePassword.type = "button";
changePassword.className = "button secondary";
changePassword.textContent = "修改密码";
changePassword.hidden = true;
submit.after(changePassword);
changePassword.onclick = () => display("recovery");
const rechargeStatus = rechargeForm.querySelector('[role="status"]');
const rechargeSubmit = rechargeForm.querySelector('button[type="submit"]');
let packages = [];
const packageLabel = pack => (pack.firstOnly ? "首充 · " : "") +
  "¥" + (pack.amountFen / 100) + " · " + pack.points + " 积分";

function display(next) {
  walletRequest++;
  retryWallet.hidden = true;
  mode = next;
  const account = mode === "account";
  const secret = mode === "login" || mode === "register" || mode === "recovery";
  password.value = "";
  password.disabled = !secret;
  password.autocomplete = ["register","recovery"].includes(mode) ? "new-password" : "current-password";
  password.minLength = password.autocomplete === "new-password" ? 8 : 1;
  email.disabled = account || mode === "recovery";
  email.parentElement.hidden = email.disabled;
  password.parentElement.hidden = !secret;
  const titles = {login:"登录工坊",register:"注册工坊账号",reset:"找回密码",recovery:"设置新密码",account:"我的账号"};
  form.querySelector("h2").textContent = titles[mode];
  submit.textContent = {login:"登录",register:"注册",reset:"发送重置邮件",recovery:"保存新密码",account:"退出登录"}[mode];
  change.hidden = inviteOnly || account || mode === "recovery";
  change.textContent = mode === "login" ? "注册账号" : "返回登录";
  reset.hidden = inviteOnly || mode !== "login";
  changePassword.hidden = !(account && inviteOnly);
  status.textContent = account ? auth.currentUser?.email || "" : "";
  walletStatus.hidden = !(account && creditMode);
  packageList.hidden = true;
  rechargePanel.hidden = true;
  rechargeText.hidden = true;
  rechargeText.value = "";
  copyStatus.textContent = "";
  giftForm.hidden = true;
  rechargeForm.hidden = true;
  inviteForm.hidden = true;
  if (inviteOnly && mode === "login") status.textContent = "试运营仅向受邀账号开放。忘记密码请联系管理员。";
  if (!account) {
    giftForm.reset();
    giftStatus.textContent = "";
    rechargeForm.reset();
    rechargeStatus.textContent = "";
  }
  if (!walletStatus.hidden) void refreshCredits();
}

async function refreshCredits() {
  const user = auth.currentUser;
  if (!user) return;
  const request = ++walletRequest;
  const stillCurrent = () => request === walletRequest && auth.currentUser?.uid === user.uid && mode === "account";
  const controller = new AbortController();
  let timer;
  retryWallet.hidden = true;
  walletStatus.textContent = "正在查询积分…";
  try {
    const query = async () => {
      const token = await user.getIdToken();
      const response = await fetch("/credits",{
        headers:{Authorization:"Bearer "+token},signal:controller.signal
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "暂时无法查询积分。");
      return data;
    };
    const deadline = new Promise((_,reject)=>{
      timer = setTimeout(()=>{
        reject(new Error("积分查询超时，请重试。"));
        controller.abort();
      },15000);
    });
    const data = await Promise.race([query(),deadline]);
    if (stillCurrent()) {
      walletStatus.textContent = "余额 "+data.balance+" 积分 · 账号编号 "+user.uid;
      packages = data.packages;
      const visible = packages.filter(pack=>!pack.firstOnly || data.firstRecharge);
      packageList.replaceChildren(...visible.map(pack=>{
        const item = document.createElement("li");
        item.textContent = packageLabel(pack);
        return item;
      }));
      packageList.hidden = false;
      const {costs,rechargeContact} = data;
      rechargePanel.querySelector("[data-prices]").textContent =
        "生成扣费 · 脚本 "+costs["/write-story"]+" · 分镜图 "+costs["/shot-image"]+" · 三视图 "+costs["/three-view"]+" 积分";
      rechargePanel.querySelector("[data-contact]").textContent = rechargeContact
        ? "将充值信息发给 "+rechargeContact+"，确认收款方式后付款。管理员核对到账后发放积分。"
        : "充值入口暂未开放。";
      buyerPack.replaceChildren(...visible.map(pack=>new Option(packageLabel(pack),pack.id)));
      rechargePanel.querySelector("[data-offer]").hidden = !rechargeContact;
      copyRecharge.hidden = !rechargeContact;
      rechargePanel.hidden = false;
      rechargeForm.elements.packageId.replaceChildren(
        new Option("请选择客户购买的套餐",""),
        ...packages.map(pack=>new Option(packageLabel(pack),pack.id))
      );
      giftForm.hidden = !data.giftAdmin;
      rechargeForm.hidden = !data.manualAdmin;
      inviteForm.hidden = !data.inviteAdmin;
    }
  } catch (error) {
    if (stillCurrent()) {
      walletStatus.textContent = error.message || "暂时无法查询积分。";
      retryWallet.hidden = false;
    }
  } finally {
    clearTimeout(timer);
  }
}

giftForm.onsubmit = async event => {
  event.preventDefault();
  const administrator = auth?.currentUser;
  if (!administrator || giftForm.hidden || giftSubmit.disabled) return;
  const fields = new FormData(giftForm);
  const gift = {
    uid:fields.get("uid").trim().toLowerCase(),
    points:Number(fields.get("points")),
    note:fields.get("note").trim()
  };
  if (!gift.note) {
    giftStatus.textContent = "请填写赠送备注。";
    return;
  }
  const key = JSON.stringify([administrator.uid,gift]);
  const previous = pendingGifts.get(key);
  if (!previous && !window.confirm("确认给账号 "+gift.uid+" 赠送 "+gift.points+" 积分？")) return;
  const requestId = previous ?? crypto.randomUUID();
  pendingGifts.set(key,requestId);
  giftSubmit.disabled = true;
  giftStatus.textContent = "正在发放赠送积分…";
  const sameAccount = () => auth.currentUser?.uid === administrator.uid && mode === "account";
  try {
    const response = await fetch("/credits/gift",{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+await administrator.getIdToken()},
      body:JSON.stringify({...gift,requestId})
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status < 500) pendingGifts.delete(key);
      if (sameAccount()) giftStatus.textContent = data.error || "赠送积分失败，请重试。";
      return;
    }
    pendingGifts.delete(key);
    if (!sameAccount()) return;
    giftForm.reset();
    giftStatus.textContent = (data.alreadyRecorded ? "该笔赠送已入账，共 " : "已赠送 ")+data.points+" 积分。";
    if (gift.uid === administrator.uid) void refreshCredits();
  } catch {
    if (sameAccount()) giftStatus.textContent = "暂时无法确认赠送结果。请保持填写内容不变，再点一次确认赠送。";
  } finally {
    giftSubmit.disabled = false;
  }
};

inviteForm.onsubmit = async event => {
  event.preventDefault();
  await submitInvite({email:inviteForm.elements.email.value.trim()});
};
resetInvite.onclick = async () => {
  const resetUid = inviteForm.elements.resetUid.value.trim();
  if (!resetUid) {
    inviteStatus.textContent = "请先填入客户的账号编号。";
    return;
  }
  if (window.confirm("确定为这个客户生成新密码？原密码将失效。")) await submitInvite({resetUid});
};
copyInvite.onclick = async () => {
  try {
    await navigator.clipboard.writeText(inviteResult.value);
    inviteStatus.textContent = "已复制登录信息，请私发给客户。";
  } catch {
    inviteResult.select();
    inviteStatus.textContent = "登录信息已选中，请手动复制。";
  }
};
async function submitInvite(input) {
  const user = auth?.currentUser;
  if (!user || inviteForm.hidden || inviteSubmit.disabled) return;
  inviteSubmit.disabled = resetInvite.disabled = true;
  inviteResult.hidden = true;
  copyInvite.hidden = true;
  inviteResult.value = "";
  inviteStatus.textContent = input.resetUid ? "正在重置密码…" : "正在开通账号…";
  try {
    const response = await fetch("/credits/invite",{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+await user.getIdToken()},
      body:JSON.stringify(input)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "开户失败。");
    if (!dialog.open || mode !== "account" || auth.currentUser?.uid !== user.uid) return;
    inviteForm.reset();
    inviteResult.value = "登录网址："+location.origin+"\n邮箱："+data.email+"\n初始密码："+data.password+"\n账号编号："+data.uid;
    inviteResult.hidden = false;
    copyInvite.hidden = false;
    inviteResult.scrollIntoView({block:"nearest"});
    inviteStatus.textContent = (input.resetUid ? "密码已重置。" : "账号已开通。") + "请复制登录信息并私发给客户。";
  } catch (error) { inviteStatus.textContent = error.message; }
  finally { inviteSubmit.disabled = resetInvite.disabled = false; }
}

copyRecharge.onclick = async () => {
  const user = auth?.currentUser;
  const pack = packages.find(item=>item.id === buyerPack.value);
  if (!user || !pack) return;
  const information = "漫剧工坊充值\n账号编号："+user.uid+"\n套餐："+packageLabel(pack);
  try {
    await navigator.clipboard.writeText(information);
    copyStatus.textContent = "已复制充值信息。";
  } catch {
    rechargeText.hidden = false;
    rechargeText.value = information;
    rechargeText.select();
    copyStatus.textContent = "请复制上方已选中的充值信息。";
  }
};

rechargeForm.onsubmit = async event => {
  event.preventDefault();
  const administrator = auth?.currentUser;
  if (!administrator || rechargeForm.hidden || rechargeSubmit.disabled) return;
  const formData = new FormData(rechargeForm);
  const payment = {
    uid:formData.get("uid").trim(),
    channel:formData.get("channel"),
    transactionId:formData.get("transactionId").trim(),
    amountFen:Math.round(Number(formData.get("amount"))*100),
    packageId:formData.get("packageId")
  };
  const pack = packages.find(item=>item.id === payment.packageId);
  if (!pack || payment.amountFen !== pack.amountFen) {
    rechargeStatus.textContent = "实收金额与套餐价格不符，请重新核对。";
    return;
  }
  if (!window.confirm("已在收款 App 核对交易到账，确认给该账号增加 "+pack.points+" 积分？")) return;
  rechargeSubmit.disabled = true;
  try {
    const response = await fetch("/credits/manual-payment",{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+await administrator.getIdToken()},
      body:JSON.stringify(payment)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "积分登记失败。");
    rechargeForm.reset();
    rechargeStatus.textContent = data.alreadyRecorded ? "该交易已登记，余额无需调整。" : "已登记到账，积分已加到对应账号。";
    void refreshCredits();
  } catch (error) { rechargeStatus.textContent = error.message; }
  finally { rechargeSubmit.disabled = false; }
};

async function initialize() {
  const response = await fetch("/auth-config");
  if (!response.ok) throw Error();
  const config = await response.json();
  if (config.provider === "supabase") {
    inviteOnly = config.inviteOnly === true;
    const {createClient} = await import("https://esm.sh/@supabase/supabase-js@2.119.0?bundle");
    const client = createClient(config.url,config.publishableKey);
    const unwrap = async call => {
      const {data,error} = await call;
      if (error) throw error;
      return data;
    };
    const update = session => {
      const previousUid = auth.currentUser?.uid;
      auth.currentUser = session?.user ? {
        uid:session.user.id, email:session.user.email,
        getIdToken:async () => {
          const current = (await unwrap(client.auth.getSession())).session;
          if (current?.user.id !== session.user.id) throw Error("请重新登录。");
          return current.access_token;
        }
      } : null;
      entry.textContent = auth.currentUser ? "我的账号" : "注册 / 登录";
      if (previousUid !== auth.currentUser?.uid) window.dispatchEvent(new Event("manju-account-change"));
    };
    const redirectTo = location.origin + "/";
    auth = {currentUser:null};
    sdk = {
      async signOut() { await unwrap(client.auth.signOut()); update(null); },
      async signInWithEmailAndPassword(_,email,password) {
        update((await unwrap(client.auth.signInWithPassword({email,password}))).session);
      },
      async createUserWithEmailAndPassword(_,email,password) {
        update((await unwrap(client.auth.signUp({email,password,options:{emailRedirectTo:redirectTo}}))).session);
      },
      async sendPasswordResetEmail(_,email) { await unwrap(client.auth.resetPasswordForEmail(email,{redirectTo})); },
      async updatePassword(password) { await unwrap(client.auth.updateUser({password})); }
    };
    client.auth.onAuthStateChange((event,session)=>setTimeout(()=>{
      update(session);
      if (event === "PASSWORD_RECOVERY") {
        if (!dialog.open) dialog.showModal();
        display("recovery");
      } else if (event === "SIGNED_OUT" && dialog.open && mode === "account") display("login");
    },0));
    update((await unwrap(client.auth.getSession())).session);
    return;
  }
  const url = "https://www.gstatic.com/firebasejs/12.6.0/";
  const [app,api] = await Promise.all([import(url+"firebase-app.js"),import(url+"firebase-auth.js")]);
  sdk = api;
  auth = sdk.getAuth(app.initializeApp(config));
  auth.languageCode = "zh-CN";
  await auth.authStateReady();
  sdk.onAuthStateChanged(auth,user=>{
    entry.textContent = user ? "我的账号" : "注册 / 登录";
    if (dialog.open && (user || mode === "account")) display(user ? "account" : "login");
  });
}
function init() {
  return loading ||= initialize().catch(error=>{loading=null; throw error;});
}
if (creditMode) window.manjuAccountToken = async () => {
  await init();
  if (!auth.currentUser) throw new Error("请先点击「注册 / 登录」，再使用积分生成。");
  return auth.currentUser.getIdToken();
};
entry.onclick = async () => {
  dialog.showModal();
  display("login");
  submit.disabled = true;
  try { await init(); display(auth.currentUser ? "account" : "login"); }
  catch { status.textContent = "账号服务连接失败，请关闭后重试。"; }
  finally { submit.disabled = !auth; }
};
form.querySelector("[data-close]").onclick = () => dialog.close();
dialog.onclose = () => {
  walletRequest++;
  password.value = "";
  inviteForm.reset();
  inviteResult.hidden = true;
  copyInvite.hidden = true;
  inviteResult.value = "";
  inviteStatus.textContent = "";
};
change.onclick = () => display(mode === "login" ? "register" : "login");
reset.onclick = () => display("reset");
form.onsubmit = async event => {
  event.preventDefault();
  if (submit.disabled) return;
  submit.disabled = change.disabled = reset.disabled = true;
  try {
    await init();
    if (mode === "account") { await sdk.signOut(auth); display("login"); status.textContent="已退出登录。"; }
    else if (mode === "reset") { await sdk.sendPasswordResetEmail(auth,email.value.trim()); status.textContent="如该邮箱已注册，请查收重置邮件。"; }
    else if (mode === "recovery") { await sdk.updatePassword(password.value); display("account"); }
    else {
      const action = mode === "register" ? sdk.createUserWithEmailAndPassword : sdk.signInWithEmailAndPassword;
      await action(auth,email.value.trim(),password.value);
      display(auth.currentUser ? "account" : "login");
      if (!auth.currentUser) status.textContent = "请查收验证邮件，验证邮箱后登录。";
    }
  } catch (error) {
    status.textContent = ({"auth/too-many-requests":"操作频繁，请稍后重试。","auth/email-already-in-use":"邮箱已注册，请登录或找回密码。","auth/weak-password":"密码强度不足，请换一个密码。","auth/invalid-credential":"邮箱或密码有误。","auth/network-request-failed":"连接失败，请检查网络。"})[error.code] || "账号操作失败，请稍后重试。";
  } finally { submit.disabled = change.disabled = reset.disabled = false; }
};
init().catch(()=>{});
