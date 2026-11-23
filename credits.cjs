const { createHash, randomUUID } = require("node:crypto");

const creditScale = 10;
const balanceUnits = account => account?.balanceUnits ?? (account?.balance ?? 0) * creditScale;
const packages = [
  {id:"one", amountFen:100, points:23},
  {id:"small", amountFen:1500, points:300},
  {id:"standard", amountFen:4999, points:1200},
  {id:"large", amountFen:10000, points:3000},
  {id:"first", amountFen:4999, points:1500, firstOnly:true}
];

function creditError(status, message) {
  return Object.assign(new Error(message), { status });
}

function createCredits(auth, db, costs) {
  const unitCosts = Object.fromEntries(Object.entries(costs).map(([route,cost]) => [route,cost * creditScale]));
  if (Object.values(unitCosts).some(cost => !Number.isSafeInteger(cost) || cost < 1)) {
    throw new Error("积分价格必须是正数，最多一位小数。");
  }
  const wallet = uid => db.collection("creditWallets").doc(uid);
  async function identify(request) {
    try {
      const token = /^Bearer (\S+)$/.exec(request.headers.authorization || "")?.[1];
      if (token) return (await auth.verifyIdToken(token, true)).uid;
    } catch {}
    throw creditError(401, "请登录后使用积分。");
  }

  async function overview(uid) {
    const account = (await wallet(uid).get()).data();
    return {balance:balanceUnits(account) / creditScale, firstRecharge:!account?.hasRecharged};
  }

  async function reserve(uid, route) {
    const cost = unitCosts[route];
    const account = wallet(uid);
    const operation = account.collection("generation").doc(randomUUID());
    await db.runTransaction(async transaction => {
      const available = balanceUnits((await transaction.get(account)).data());
      if (!Number.isSafeInteger(available) || available < cost) throw creditError(402, "积分不足。");
      transaction.set(account, {balanceUnits:available-cost}, {merge:true});
      transaction.create(operation, {costUnits:cost, route, state:"reserved", createdAt:Date.now()});
    });
    return async success => db.runTransaction(async transaction => {
      const entry = (await transaction.get(operation)).data();
      if (entry?.state !== "reserved") return;
      if (!success) {
        const available = balanceUnits((await transaction.get(account)).data());
        transaction.set(account, {balanceUnits:available+entry.costUnits}, {merge:true});
      }
      transaction.update(operation, {state:success ? "completed" : "refunded", finishedAt:Date.now()});
    });
  }
  async function addManualPayment(administrator, payment) {
    const {uid,channel,transactionId,amountFen,packageId} = payment ?? {};
    const pack = packages.find(item=>item.id === packageId);
    if (typeof uid !== "string" || !/^[\w-]{1,128}$/.test(uid) ||
        !["wechat","alipay"].includes(channel) || typeof transactionId !== "string" ||
        !/^[A-Za-z0-9_-]{8,80}$/.test(transactionId) ||
        !pack || amountFen !== pack.amountFen) {
      throw creditError(400, "请核对账号、交易单号和套餐实收金额。");
    }
    const user = await auth.getUser(uid).catch(error => {
      if (error.code === "auth/user-not-found") throw creditError(404, "该账号不存在。");
      throw error;
    });
    if (user.disabled) throw creditError(400, "该账号已停用。");
    const id = createHash("sha256").update(channel+":"+transactionId).digest("hex");
    const receipt = db.collection("manualCreditPayments").doc(id);
    const account = wallet(uid);
    return db.runTransaction(async transaction => {
      const recorded = (await transaction.get(receipt)).data();
      if (recorded) {
        if (recorded.uid === uid && recorded.packageId === packageId && recorded.amountFen === amountFen) return {alreadyRecorded:true};
        throw creditError(409, "这笔交易已经入账，请核对原记录。");
      }
      const current = (await transaction.get(account)).data();
      if (pack.firstOnly && current?.hasRecharged) throw creditError(409, "该账号已有充值记录，请使用常规套餐。");
      const nextBalance = balanceUnits(current) + pack.points * creditScale;
      if (!Number.isSafeInteger(nextBalance)) throw creditError(409, "余额异常，请核对积分账户。");
      transaction.set(account,{balanceUnits:nextBalance,hasRecharged:true},{merge:true});
      transaction.create(receipt,{uid,channel,transactionId,amountFen,packageId,points:pack.points,administrator,createdAt:Date.now()});
      return {alreadyRecorded:false};
    });
  }
  return {identify,overview,reserve,addManualPayment,costs,packages};
}

module.exports = {createCredits,packages,creditError};
