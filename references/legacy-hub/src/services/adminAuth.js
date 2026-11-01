const crypto=require('crypto');
const {promisify}=require('util');const scrypt=promisify(crypto.scrypt);
function install(app,db,verifySetupToken){
 db.exec(`CREATE TABLE IF NOT EXISTS admin_security(id INTEGER PRIMARY KEY CHECK(id=1),salt TEXT NOT NULL,password_hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS admin_sessions(token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);`);
 const configured=()=>!!db.prepare('SELECT id FROM admin_security WHERE id=1').get();
 const digest=t=>crypto.createHash('sha256').update(t).digest('hex');
 const sessionToken=req=>req.headers['x-admin-session'] || (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('hub_session='))?.slice(12);
 const validSession=req=>{const token=sessionToken(req);return !!token&&!!db.prepare('SELECT token_hash FROM admin_sessions WHERE token_hash=? AND expires_at>?').get(digest(token),Date.now());};
 const csrf=(req,res,next)=>req.headers['x-hub-request']==='1'?next():res.status(403).json({error:'Permintaan tidak diizinkan'});
 const cookie=(req,value,age)=>`hub_session=${value}; Path=/; HttpOnly; Max-Age=${age}; ${req.secure||req.headers['x-forwarded-proto']==='https'||/\.e2b\.app(?::\d+)?$/.test(req.headers.host||'')?'Secure; SameSite=None; Partitioned':'SameSite=Lax'}`;
 function session(req,res){const token=crypto.randomBytes(32).toString('hex');db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').run(Date.now());db.prepare('INSERT INTO admin_sessions VALUES(?,?)').run(digest(token),Date.now()+12*3600000);res.setHeader('Set-Cookie',cookie(req,token,43200));res.setHeader('Cache-Control','no-store');res.json({ok:true,sessionToken:token});}
 const limit=require('express-rate-limit').rateLimit({windowMs:15*60000,limit:10,message:{error:'Terlalu banyak percobaan. Coba lagi dalam 15 menit.'}});
 app.use('/api/auth',(req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 app.get('/api/auth/status',(req,res)=>res.json({configured:configured(),authenticated:validSession(req)}));
 app.post('/api/auth/setup',limit,csrf,async(req,res,next)=>{try{if(configured())return res.status(409).json({error:'Password sudah diatur. Gunakan login password.'});if(!verifySetupToken(req.body.token))return res.status(401).json({error:'Token pengaturan tidak valid'});const password=req.body.password;if(typeof password!=='string'||password.length<12||password.length>200)return res.status(400).json({error:'Password harus 12–200 karakter'});const salt=crypto.randomBytes(16).toString('hex');const hash=(await scrypt(password,salt,64)).toString('hex');db.prepare('INSERT INTO admin_security VALUES(1,?,?)').run(salt,hash);db.prepare('DELETE FROM admin_sessions').run();session(req,res);}catch(e){next(e);}});
 app.post('/api/auth/login',limit,csrf,async(req,res,next)=>{try{const row=db.prepare('SELECT * FROM admin_security WHERE id=1').get();const pw=req.body.password;if(!row||typeof pw!=='string'||pw.length>200)return res.status(401).json({error:'Password tidak valid'});const hash=await scrypt(pw,row.salt,64);if(!crypto.timingSafeEqual(hash,Buffer.from(row.password_hash,'hex')))return res.status(401).json({error:'Password tidak valid'});session(req,res);}catch(e){next(e);}});
 app.post('/api/auth/logout',csrf,(req,res)=>{const t=sessionToken(req);if(t)db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(digest(t));res.setHeader('Set-Cookie',cookie(req,'',0));res.json({ok:true});});
 return {configured,validSession,csrf};
}
module.exports={install};
