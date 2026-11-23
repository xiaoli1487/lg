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
let mode = "login", auth, sdk, loading;
const creditMode = Boolean(document.documentElement.dataset.creditProvider);
const walletStatus = document.createElement("p");
walletStatus.setAttribute("role","status");
walletStatus.hidden = true;
status.after(walletStatus);
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
const rechargeStatus = rechargeForm.querySelector('[role="status"]');
const rechargeSubmit = rechargeForm.querySelector('button[type="submit"]');
let packages = [];
const packageLabel = pack => (pack.firstOnly ? "首充 · " : "") +
  "¥" + (pack.amountFen / 100) + " · " + pack.points + " 积分";

function display(next) {
  mode = next;
  const account = mode === "account";
  const secret = mode === "login" || mode === "register";
  password.value = "";
  password.disabled = !secret;
  password.autocomplete = mode === "register" ? "new-password" : "current-password";
  password.minLength = mode === "register" ? 8 : 1;
  email.disabled = account;
  email.parentElement.hidden = account;
  password.parentElement.hidden = !secret;
  const titles = {login:"登录工坊",register:"注册工坊账号",reset:"找回密码",account:"我的账号"};
  form.querySelector("h2").textContent = titles[mode];
  submit.textContent = {login:"登录",register:"注册",reset:"发送重置邮件",account:"退出登录"}[mode];
  change.hidden = account;
  change.textContent = mode === "login" ? "注册账号" : "返回登录";
  reset.hidden = mode !== "login";
  status.textContent = account ? auth.currentUser?.email || "" : "";
  walletStatus.hidden = !(account && creditMode);
  packageList.hidden = true;
  rechargePanel.hidden = true;
  rechargeText.hidden = true;
  rechargeText.value = "";
  copyStatus.textContent = "";
  rechargeForm.hidden = true;
  if (!account) {
    rechargeForm.reset();
    rechargeStatus.textContent = "";
  }
  if (!walletStatus.hidden) void refreshCredits();
}

async function refreshCredits() {
  const user = auth.currentUser;
  if (!user) return;
  walletStatus.textContent = "正在查询积分…";
  try {
    const response = await fetch("/credits",{headers:{Authorization:"Bearer "+await user.getIdToken()}});
    const data = await response.json();
    if (!response.ok) throw Error();
    if (auth.currentUser === user && mode === "account") {
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
      rechargeForm.hidden = !data.manualAdmin;
    }
  } catch {
    if (auth.currentUser === user) walletStatus.textContent = "暂时无法查询积分。";
  }
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
  const url = "https://www.gstatic.com/firebasejs/12.6.0/";
  const [app,api,response] = await Promise.all([import(url+"firebase-app.js"),import(url+"firebase-auth.js"),fetch("/auth-config")]);
  if (!response.ok) throw Error();
  sdk = api;
  auth = sdk.getAuth(app.initializeApp(await response.json()));
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
dialog.onclose = () => { password.value=""; };
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
    else {
      const action = mode === "register" ? sdk.createUserWithEmailAndPassword : sdk.signInWithEmailAndPassword;
      await action(auth,email.value.trim(),password.value);
      display("account");
    }
  } catch (error) {
    status.textContent = ({"auth/too-many-requests":"操作频繁，请稍后重试。","auth/email-already-in-use":"邮箱已注册，请登录或找回密码。","auth/weak-password":"密码强度不足，请换一个密码。","auth/invalid-credential":"邮箱或密码有误。","auth/network-request-failed":"连接失败，请检查网络。"})[error.code] || "账号操作失败，请稍后重试。";
  } finally { submit.disabled = change.disabled = reset.disabled = false; }
};
init().catch(()=>{});
