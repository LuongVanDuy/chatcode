const fs = require('fs');
function replaceOnce(file,before,after){let s=fs.readFileSync(file,'utf8');if(!s.includes(before))throw new Error(`${file}: marker missing`);fs.writeFileSync(file,s.replace(before,after));}

replaceOnce('core/agent-runtime.js',
"  EXECUTION_PATHS,\n  validatePatchAgainstTaskCard",
"  EXECUTION_PATHS,\n  TASK_TYPES,\n  validatePatchAgainstTaskCard");
replaceOnce('core/agent-runtime.js',
"function readProjectRules(store, projectId) {",
`function verificationFingerprint(verification) {
  return JSON.stringify((verification || []).filter(item => !item?.ok).map(item => ({
    kind:item?.kind || '', command:item?.command || '', file:item?.file || '',
    code:item?.error?.code || '', error:item?.error?.message || item?.error || '',
    stderr:String(item?.stderr || '').trim().slice(-500)
  })));
}

function readProjectRules(store, projectId) {`);
replaceOnce('core/agent-runtime.js',
"  const preparations = new Map();\n  const preparing = new Map();",
"  const preparations = new Map();\n  const preparing = new Map();\n  const failureFingerprints = new Map();");
replaceOnce('core/agent-runtime.js',
"      taskContexts.delete(oldest);\n    }",
"      taskContexts.delete(oldest);\n      failureFingerprints.delete(oldest);\n    }");
replaceOnce('core/agent-runtime.js',
"    const taskCard = buildTaskCard({ request:text, inspect, projectRules:allProjectRules, projectProfile:fullProjectProfile, verificationHints:hints });\n    const skillInspect",
`    const taskCard = buildTaskCard({ request:text, inspect, projectRules:allProjectRules, projectProfile:fullProjectProfile, verificationHints:hints });
    let databaseCapability = null;
    if ((taskCard.facets || []).includes(TASK_TYPES.DATA) && typeof api.databaseOp === 'function') {
      try { databaseCapability = await api.databaseOp(session.project_id,{ action:'inspect' }); }
      catch (error) { databaseCapability = { ok:false, status:'unavailable', error:normalizeError(error) }; }
    }
    const skillInspect`);
replaceOnce('core/agent-runtime.js',
"    const ownerGuidance = taskCard.owner?.primary_path\n      ? `Owner Resolver: ${taskCard.owner.status} ${taskCard.owner.kind || 'owner'} tại ${taskCard.owner.primary_path}${taskCard.owner.primary_symbol ? ` (${taskCard.owner.primary_symbol})` : ''}. Sửa owner này trước; không tạo owner song song.`\n      : 'Owner Resolver chưa có owner đủ evidence; chỉ dùng ranked candidates và không tạo owner mới nếu chưa xác nhận owner hiện tại không tồn tại.';",
`    const ownerGuidance = taskCard.owner?.primary_path
      ? (Number(taskCard.owner.confidence || 0) >= 0.8
          ? \`Owner Resolver: \${taskCard.owner.status} \${taskCard.owner.kind || 'owner'} tại \${taskCard.owner.primary_path}\${taskCard.owner.primary_symbol ? \` (\${taskCard.owner.primary_symbol})\` : ''}. Dùng owner này trước.\`
          : \`Owner Resolver confidence \${Number(taskCard.owner.confidence || 0).toFixed(2)}: đọc đúng owner/relation một lần để xác nhận rồi tiếp tục với owner bounded tốt nhất; không bỏ task chỉ vì chưa đạt certainty tuyệt đối.\`)
      : 'Owner Resolver chưa có owner mạnh: đọc targeted candidates một lần, sau đó chọn owner bounded tốt nhất; nếu thật sự chưa có owner, được tạo một owner đúng responsibility.';`);
replaceOnce('core/agent-runtime.js',
"      project_profile:projectProfile,\n      project_decisions:projectRules,",
"      project_profile:projectProfile,\n      database_capability:databaseCapability,\n      project_decisions:projectRules,");
replaceOnce('core/agent-runtime.js',
"          'Bám task_card: giữ đúng target, tôn trọng must_preserve/out_of_scope và không tự mở rộng task.',",
"          'Bám task_card: giữ đúng target, tôn trọng must_preserve/out_of_scope và không tự mở rộng task.',\n          'Guard severity: HARD mới chặn mutation. SOFT = một targeted read/proof rồi dùng bounded reversible fallback. ADVISORY/best practice là preference, không phải permission boundary.',\n          'Giữ cùng task_id cho seed, diagnostic, repair, cleanup và đổi execution path. Không mở task mới chỉ vì ideal path unavailable.',\n          'Nếu local WP-CLI/MySQL không phù hợp FTP mirror, dùng database capability/server-side fallback khi có; helper tạm chỉ one-shot, authenticated, bounded và cleanup trong cùng task.',");
replaceOnce('core/agent-runtime.js',
"        taskCards.delete(id);\n        taskContexts.delete(id);\n        return {\n          ok:false, status:'rolled_back'",
"        taskCards.delete(id);\n        taskContexts.delete(id);\n        failureFingerprints.delete(id);\n        return {\n          ok:false, status:'rolled_back'");
replaceOnce('core/agent-runtime.js',
"      const current = await api.workStatus(id);\n      return {\n        ok:false, status:'needs_fix', task_id:id, work_session_id:id,",
`      const current = await api.workStatus(id);
      const fingerprint = verificationFingerprint(verification);
      const repeatedRootCause = !!fingerprint && failureFingerprints.get(id) === fingerprint;
      if (fingerprint) failureFingerprints.set(id,fingerprint);
      return {
        ok:false, status:repeatedRootCause ? 'path_exhausted' : 'needs_fix', task_id:id, work_session_id:id,`);
replaceOnce('core/agent-runtime.js',
"        next_action:'Giữ nguyên task_id và execution path. Tạo corrective unified diff nhỏ trong cùng scope rồi gọi complete_task lại; chỉ rollback_work nếu muốn hủy toàn bộ task.',",
"        next_action:repeatedRootCause\n          ? 'Cùng root-cause đã lặp lại sau một corrective pass. Dừng path này; giữ cùng task_id và chọn fallback bounded khác hoặc báo blocker. Không áp lại cùng patch/command/error.'\n          : 'Giữ nguyên task_id. Thực hiện đúng một corrective pass cho root-cause đã xác định; nếu lỗi giống hệt lặp lại thì bỏ path này và đổi fallback, không loop.',");
replaceOnce('core/agent-runtime.js',
"    if (!finalize) {\n      const current",
"    failureFingerprints.delete(id);\n\n    if (!finalize) {\n      const current");
replaceOnce('core/agent-runtime.js',
"    taskCards.delete(id);\n    taskContexts.delete(id);\n    return {\n      ok:true, status:'completed'",
"    taskCards.delete(id);\n    taskContexts.delete(id);\n    failureFingerprints.delete(id);\n    return {\n      ok:true, status:'completed'");

fs.writeFileSync('core/agent-runtime.js',fs.readFileSync('core/agent-runtime.js','utf8'));
console.log('bounded fallback agent policy staged');
