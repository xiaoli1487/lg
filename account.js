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
}

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
