const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RECENT_ACTIVITY_LIMIT = 400;
const DAILY_USAGE_LIMIT = 120;
function emptyCounters(){return{calls:0,read:0,write:0,task:0,git:0,manage:0,other:0,errors:0,bytesIn:0,bytesOut:0,durationMs:0}}
function defaultState(port){return{projects:[],connection:{token:'',port,mode:'custom',domain:'',tunnelTokenEnc:''},settings:{closeToTray:true,launchAtLogin:false,activityNotifications:true,autoReconnect:true,healthIntervalSec:30},usage:{total:emptyCounters(),daily:{},recent:[]}}}
function normalizeDomain(value){let text=String(value||'').trim().toLowerCase().replace(/^https?:\/\//,'').split('/')[0].replace(/\.$/,'');if(!text)return'';if(!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(text))throw new Error('Domain không hợp lệ. Ví dụ: mcp.example.com');return text}
function normalizeCounters(raw={}){const out=emptyCounters();for(const k of Object.keys(out))out[k]=Math.max(0,Number(raw?.[k])||0);return out}
function normalizeUsage(raw={}){const daily={};for(const k of Object.keys(raw.daily||{}).sort().slice(-DAILY_USAGE_LIMIT))daily[k]=normalizeCounters(raw.daily[k]);const recent=Array.isArray(raw.recent)?raw.recent.slice(0,RECENT_ACTIVITY_LIMIT).map(x=>({id:String(x.id||crypto.randomUUID()),at:String(x.at||new Date().toISOString()),tool:String(x.tool||'unknown'),category:String(x.category||'other'),project:String(x.project||''),projectId:String(x.projectId||''),target:String(x.target||'').slice(0,220),ok:x.ok!==false,durationMs:Math.max(0,Number(x.durationMs)||0),bytesIn:Math.max(0,Number(x.bytesIn)||0),bytesOut:Math.max(0,Number(x.bytesOut)||0),error:String(x.error||'').slice(0,500)})):[];return{total:normalizeCounters(raw.total),daily,recent}}
function createStore(app,port){
  const file=()=>path.join(app.getPath('userData'),'personal-chatcode.json');
  function normalize(raw){const base=defaultState(port),s={...base,...(raw||{})};s.projects=Array.isArray(s.projects)?s.projects.map(p=>({...p,permissions:{write:!!p.permissions?.write,manageFiles:!!p.permissions?.manageFiles,tasks:!!p.permissions?.tasks,gitWrite:!!p.permissions?.gitWrite}})):[];s.connection={...base.connection,...(s.connection||{})};if(!s.connection.token)s.connection.token=crypto.randomBytes(24).toString('hex');s.connection.port=port;s.connection.mode=s.connection.mode==='quick'?'quick':'custom';try{s.connection.domain=normalizeDomain(s.connection.domain)}catch{s.connection.domain=''}s.connection.tunnelTokenEnc=String(s.connection.tunnelTokenEnc||'');s.settings={closeToTray:s.settings?.closeToTray!==false,launchAtLogin:!!s.settings?.launchAtLogin,activityNotifications:s.settings?.activityNotifications!==false,autoReconnect:s.settings?.autoReconnect!==false,healthIntervalSec:Math.min(120,Math.max(15,Number(s.settings?.healthIntervalSec)||30))};s.usage=normalizeUsage(s.usage);return s}
  function read(){try{return normalize(JSON.parse(fs.readFileSync(file(),'utf8')))}catch{return normalize(defaultState(port))}}
  function write(state){fs.mkdirSync(path.dirname(file()),{recursive:true});fs.writeFileSync(file(),JSON.stringify(normalize(state),null,2),'utf8')}
  function ensure(){const s=read();write(s);return s}
  function connectionConfig(s=read()){return{mode:s.connection.mode,domain:s.connection.domain,hasTunnelToken:!!s.connection.tunnelTokenEnc,localPort:port}}
  function settings(s=read()){return{closeToTray:!!s.settings.closeToTray,launchAtLogin:!!s.settings.launchAtLogin,activityNotifications:!!s.settings.activityNotifications,autoReconnect:!!s.settings.autoReconnect,healthIntervalSec:s.settings.healthIntervalSec}}
  function getProject(ref){const ps=read().projects,needle=String(ref||'').trim().toLowerCase();const p=ps.find(x=>x.id===ref)||ps.find(x=>String(x.name||'').toLowerCase()===needle);if(!p)throw new Error(`Không tìm thấy dự án: ${ref}`);return p}
  return{read,write,ensure,normalizeDomain,connectionConfig,settings,getProject,emptyCounters,normalizeUsage,normalizeCounters};
}
module.exports={createStore};
