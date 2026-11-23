const { randomBytes, randomUUID } = require("node:crypto");
const { packages, creditError } = require("./credits.cjs");
const isUuid = value => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

function createSupabaseCredits(url, publicKey, secret, costs, {inviteOnly = false, administrator} = {}) {
  if (!Object.values(costs).every(cost => Number.isSafeInteger(cost * 10) && cost > 0)) {
    throw new Error("积分价格必须是正数，最多一位小数。");
  }
  async function call(path, options) {
    return fetch(url + path, {...options, redirect:"error", signal:AbortSignal.timeout(10000)});
  }
  function adminHeaders() {
    const headers = {apikey:secret, "Content-Type":"application/json"};
    if (!secret.startsWith("sb_secret_")) headers.Authorization = "Bearer " + secret;
    return headers;
  }
  async function rpc(name, args) {
    const response = await call("/rest/v1/rpc/manju_" + name, {
      method:"POST",headers:adminHeaders(),body:JSON.stringify(args)
    });
    if (!response.ok) throw new Error("积分数据库暂不可用。");
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }
  async function identify(request) {
    const authorization = request.headers.authorization || "";
    if (!/^Bearer [\w.-]+$/.test(authorization)) throw creditError(401,"请登录后使用积分。");
    const response = await call("/auth/v1/user",{headers:{apikey:publicKey,Authorization:authorization}});
    if (response.status === 401 || response.status === 403) throw creditError(401,"请重新登录后使用积分。");
    if (!response.ok) throw creditError(503,"账号服务暂不可用。");
    const user = await response.json();
    if (!user.id || user.is_anonymous || !user.email_confirmed_at) throw creditError(403,"请先验证登录邮箱。");
    if (inviteOnly && user.id !== administrator && user.app_metadata?.manju_invited !== true) {
      throw creditError(403,"该账号尚未获得试运营邀请。");
    }
    return user.id;
  }
  async function invite(input) {
    const resetUid = input?.resetUid;
    if (resetUid !== undefined) {
      if (!isUuid(resetUid) || resetUid === administrator) {
        throw creditError(400,"请输入客户账号编号。");
      }
      const path = "/auth/v1/admin/users/" + resetUid;
      const lookup = await call(path,{headers:adminHeaders()});
      if (!lookup.ok) throw creditError(lookup.status === 404 ? 404 : 502,"无法找到该客户账号，请核对账号编号。");
      const result = await lookup.json();
      const customer = result.user ?? result;
      if (customer.id !== resetUid || customer.app_metadata?.manju_invited !== true) {
        throw creditError(403,"仅可在这里重置受邀客户的密码。");
      }
      const password = randomBytes(18).toString("base64url");
      const updated = await call(path,{
        method:"PUT",headers:adminHeaders(),body:JSON.stringify({password})
      });
      if (!updated.ok) throw creditError(502,"密码重置失败，请稍后重试。");
      return {uid:customer.id,email:customer.email,password};
    }
    const email = typeof input?.email === "string" ? input.email.trim() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw creditError(400,"请输入有效的客户邮箱。");
    }
    const password = randomBytes(18).toString("base64url");
    const response = await call("/auth/v1/admin/users",{
      method:"POST",headers:adminHeaders(),
      body:JSON.stringify({email,password,email_confirm:true,app_metadata:{manju_invited:true}})
    });
    if (!response.ok) {
      const error = await response.json().catch(()=>({}));
      if (error.error_code === "email_exists" || error.error_code === "user_already_exists") {
        throw creditError(409,"该邮箱已有账号，请到 Supabase 用户管理核对。");
      }
      throw creditError(502,"开户失败，请核对 Supabase 配置后重试。");
    }
    const user = await response.json();
    if (!user.id) throw creditError(502,"未收到账号编号，请在 Supabase 核对开户结果。");
    return {uid:user.id,email,password};
  }
  async function reserve(uid, route) {
    const id = randomUUID();
    if (!await rpc("reserve",{p_uid:uid,p_id:id,p_units:costs[route]*10})) throw creditError(402,"积分不足。");
    return success => rpc("settle",{p_id:id,p_success:success});
  }
  async function addManualPayment(administrator, input) {
    const {uid,channel,transactionId,amountFen,packageId} = input || {};
    const pack = packages.find(item=>item.id === packageId);
    if (!isUuid(uid) ||
        !["wechat","alipay"].includes(channel) || typeof transactionId !== "string" ||
        !/^[A-Za-z0-9_-]{8,80}$/.test(transactionId) || !pack || amountFen !== pack.amountFen) {
      throw creditError(400,"请核对账号、交易单号和套餐实收金额。");
    }
    const result = await rpc("topup",{
      p_uid:uid,p_admin:administrator,p_channel:channel,p_transaction:transactionId,
      p_package:packageId,p_amount:amountFen,p_units:pack.points*10,p_first:Boolean(pack.firstOnly)
    });
    if (result === "credited" || result === "duplicate") return {alreadyRecorded:result === "duplicate"};
    if (result === "first_used") throw creditError(409,"该账号已有充值记录，请使用常规套餐。");
    if (result === "invalid_user") throw creditError(404,"该账号不存在。");
    throw creditError(409,"这笔交易已经入账，请核对原记录。");
  }
  async function addGift(administrator, input) {
    const {uid, points, requestId} = input || {};
    const note = typeof input?.note === "string" ? input.note.trim() : "";
    const units = typeof points === "number" ? Math.round(points * 10) : NaN;
    if (!isUuid(uid) || !isUuid(requestId) || units / 10 !== points ||
        units <= 0 || units > 2147483647 || !note || note.length > 200 || note.includes("\0")) {
      throw creditError(400,"请核对账号编号、积分数（最多一位小数）和赠送备注。");
    }
    const result = await rpc("gift",{
      p_id:requestId, p_uid:uid, p_admin:administrator, p_units:units, p_note:note
    });
    if (result === "credited" || result === "duplicate") return {points, alreadyRecorded:result === "duplicate"};
    if (result === "invalid_user") throw creditError(404,"该账号不存在，请核对账号编号。");
    if (result === "conflict") throw creditError(409,"赠送请求与原记录不符，请核对后重试。");
    throw new Error("无法确认赠送结果。");
  }
  return {identify,invite,videoRpc:rpc,overview:uid=>rpc("wallet",{p_uid:uid}),reserve,addManualPayment,addGift,costs,packages};
}

module.exports = {createSupabaseCredits};
