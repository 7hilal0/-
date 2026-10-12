/**
 * Maw'ed Discord DM verification API.
 *
 * Required Worker bindings:
 * - DISCORD_BOT_TOKEN (secret)
 * - DISCORD_GUILD_ID (plain text ID of the server)
 * - ALLOWED_ORIGIN (https://7hilal0.github.io or your custom site origin)
 * - AUTH_DB (D1 binding)
 *
 * POST /auth/request { username }
 * POST /auth/verify { username, code }
 *
 * This Worker resolves a username to a real Discord user by checking the guild member
 * list; it does not trust a user-provided numeric ID. The bot must be in the server
 * and have permission to view members. Set up the D1 tables using schema below.
 */
const headers = (origin, allowed) => ({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": origin === allowed ? allowed : "null",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "Content-Type",
  "vary": "Origin"
});
const json = (body, status, origin, allowed) => new Response(JSON.stringify(body), {status, headers: headers(origin, allowed)});
const norm = s => String(s || "").trim().replace(/^@/, "").toLowerCase();
const hash = async s => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,"0")).join("");
};
async function discord(env, path, method="GET", body) {
  return fetch("https://discord.com/api/v10"+path, {
    method,
    headers: {authorization:"Bot "+env.DISCORD_BOT_TOKEN, ...(body ? {"content-type":"application/json"} : {})},
    ...(body ? {body:JSON.stringify(body)} : {})
  });
}
async function findGuildMember(env, username) {
  // Guild member search requires the bot to be in that guild with access to member listings.
  const r = await discord(env, "/guilds/"+encodeURIComponent(env.DISCORD_GUILD_ID)+"/members/search?query="+encodeURIComponent(username)+"&limit=100");
  if (!r.ok) throw new Error("تعذر البحث عن حساب Discord. تأكد أن البوت موجود في السيرفر ولديه صلاحيات الوصول للأعضاء.");
  const members = await r.json();
  const q = norm(username);
  const matches = members.filter(m => {
    const u=m.user||{};
    return norm(u.username)===q || norm(u.global_name)===q || norm(m.nick)===q;
  });
  // Avoid sending secrets if the entered name is ambiguous.
  const unique = new Map(matches.filter(m=>m.user&&!m.user.bot).map(m=>[m.user.id,m]));
  if (unique.size!==1) throw new Error("لم أجد حسابًا واحدًا مطابقًا بالضبط. اكتب اسم مستخدم Discord الحالي بصورة صحيحة.");
  return [...unique.values()][0].user;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "";
    if (request.method==="OPTIONS") {
      return new Response(null,{status:204,headers:headers(origin,allowed)});
    }
    if (origin !== allowed || !allowed) return json({error:"Origin not allowed"},403,origin,allowed);
    if (request.method!=="POST" || !["/auth/request","/auth/verify"].includes(url.pathname))
      return json({error:"Not found"},404,origin,allowed);
    if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID || !env.AUTH_DB)
      return json({error:"Authentication service is not configured"},503,origin,allowed);
    let body;
    try { body=await request.json(); } catch { return json({error:"Invalid JSON"},400,origin,allowed); }
    const username=String(body.username||"").trim();
    if (username.length<2 || username.length>64 || /[\r\n]/.test(username))
      return json({error:"أدخل اسم مستخدم Discord صحيحًا."},400,origin,allowed);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const ipHash = await hash(ip + (env.RATE_LIMIT_SALT||"set-a-secret-salt"));
    const rateKey = "ip:"+ipHash;
    const now = Date.now();
    // D1 table stores only IP digest and timestamp, never raw IP.
    const recent = await env.AUTH_DB.prepare("SELECT COUNT(*) AS n FROM auth_rate WHERE ip_hash=? AND created_at>?").bind(ipHash,now-15*60*1000).first();
    if ((recent?.n||0)>=10) return json({error:"محاولات كثيرة. انتظر 15 دقيقة ثم أعد المحاولة."},429,origin,allowed);
    await env.AUTH_DB.prepare("INSERT INTO auth_rate (ip_hash,created_at) VALUES (?,?)").bind(ipHash,now).run();

    try {
      if (url.pathname==="/auth/request") {
        const user=await findGuildMember(env,username);
        const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%10000).padStart(4,"0");
        const codeHash=await hash(code+"|"+user.id+"|"+(env.CODE_PEPPER||""));
        // Invalidate prior challenges and store the one-time code hash for 5 minutes.
        await env.AUTH_DB.batch([
          env.AUTH_DB.prepare("DELETE FROM auth_codes WHERE user_id=?").bind(user.id),
          env.AUTH_DB.prepare("INSERT INTO auth_codes (user_id,username,code_hash,expires_at,attempts,created_at) VALUES (?,?,?,?,0,?)").bind(user.id,user.username,codeHash,now+5*60*1000,now)
        ]);
        const dm=await discord(env,"/users/@me/channels","POST",{recipient_id:user.id});
        if (!dm.ok) throw new Error("تعذر فتح الخاص. اطلب من المستخدم السماح بالرسائل الخاصة من أعضاء السيرفر.");
        const dmData=await dm.json();
        const sent=await discord(env,"/channels/"+dmData.id+"/messages","POST",{
          content:"🔐 **كود تسجيل الدخول إلى موعد Maw'ed**\n\nكودك المؤقت: **"+code+"**\n\nينتهي خلال 5 دقائق ويعمل مرة واحدة فقط. لا تشاركه مع أي شخص."
        });
        if (!sent.ok) throw new Error("تعذر إرسال رسالة خاصة. تأكد من إعدادات الخصوصية لدى المستخدم.");
        return json({ok:true,message:"تم إرسال الكود إلى الخاص في Discord.",masked:user.username.slice(0,2)+"***"},200,origin,allowed);
      }
      const code=String(body.code||"").trim();
      if (!/^\d{4}$/.test(code)) return json({error:"أدخل كودًا مكوّنًا من 4 أرقام."},400,origin,allowed);
      const user=await findGuildMember(env,username);
      const row=await env.AUTH_DB.prepare("SELECT * FROM auth_codes WHERE user_id=?").bind(user.id).first();
      if (!row || row.expires_at<now) {
        if (row) await env.AUTH_DB.prepare("DELETE FROM auth_codes WHERE user_id=?").bind(user.id).run();
        return json({error:"الكود انتهت صلاحيته. اطلب كودًا جديدًا."},400,origin,allowed);
      }
      if (row.attempts>=5) {
        await env.AUTH_DB.prepare("DELETE FROM auth_codes WHERE user_id=?").bind(user.id).run();
        return json({error:"تجاوزت عدد المحاولات. اطلب كودًا جديدًا."},429,origin,allowed);
      }
      const given=await hash(code+"|"+user.id+"|"+(env.CODE_PEPPER||""));
      if (given!==row.code_hash) {
        await env.AUTH_DB.prepare("UPDATE auth_codes SET attempts=attempts+1 WHERE user_id=?").bind(user.id).run();
        return json({error:"الكود غير صحيح."},400,origin,allowed);
      }
      await env.AUTH_DB.prepare("DELETE FROM auth_codes WHERE user_id=?").bind(user.id).run();
      // This confirms possession of the Discord account for this request; it does not yet
      // issue a persistent application session. Keep frontend in verified-demo state until
      // a signed session cookie/JWT is implemented.
      return json({ok:true,verified:true,username:user.username,message:"تم التحقق من حساب Discord."},200,origin,allowed);
    } catch (e) {
      return json({error:e?.message||"حدث خطأ في خدمة تسجيل الدخول."},400,origin,allowed);
    }
  }
};

/**
 * D1 schema to execute once:
 * CREATE TABLE IF NOT EXISTS auth_codes (
 *   user_id TEXT PRIMARY KEY, username TEXT NOT NULL, code_hash TEXT NOT NULL,
 *   expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
 * );
 * CREATE TABLE IF NOT EXISTS auth_rate (
 *   id INTEGER PRIMARY KEY AUTOINCREMENT, ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL
 * );
 * CREATE INDEX IF NOT EXISTS idx_auth_rate_ip_time ON auth_rate(ip_hash,created_at);
 */