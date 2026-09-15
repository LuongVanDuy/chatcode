const { resolveBricksSpec, allKnownElements } = require('./bricks-spec');

function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }

function parseInput(input) {
  if (typeof input === 'string') {
    try { return { value:JSON.parse(input), parse_error:null }; }
    catch (error) { return { value:null, parse_error:String(error?.message || error) }; }
  }
  return { value:input, parse_error:null };
}

function looksLikeNode(value) {
  return isObject(value) && typeof value.name === 'string' && Object.prototype.hasOwnProperty.call(value, 'id');
}

function extractNodes(value) {
  if (Array.isArray(value) && value.some(looksLikeNode)) return { recognized:true, format:'postmeta-array', nodes:value, wrapper:null };
  if (!isObject(value)) return { recognized:false, format:'unknown', nodes:[], wrapper:value };

  if (value.source === 'bricksCopiedElements' && Array.isArray(value.content)) {
    return { recognized:true, format:'clipboard', nodes:value.content, wrapper:value };
  }
  const type = String(value.type || '').toLowerCase();
  if (type) {
    const key = type === 'header' ? 'header' : type === 'footer' ? 'footer' : 'content';
    if (Array.isArray(value[key])) return { recognized:true, format:'template', nodes:value[key], wrapper:value, template_type:type, element_key:key };
  }
  if (Array.isArray(value.content) && value.content.some(looksLikeNode)) return { recognized:true, format:'content-object', nodes:value.content, wrapper:value };
  if (Array.isArray(value.header) && value.header.some(looksLikeNode)) return { recognized:true, format:'header-object', nodes:value.header, wrapper:value };
  if (Array.isArray(value.footer) && value.footer.some(looksLikeNode)) return { recognized:true, format:'footer-object', nodes:value.footer, wrapper:value };
  return { recognized:false, format:'unknown', nodes:[], wrapper:value };
}

function walkSettings(value, visitor, path = 'settings') {
  if (Array.isArray(value)) {
    value.forEach((item,index) => walkSettings(item, visitor, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  visitor(value, path);
  for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') walkSettings(child, visitor, `${path}.${key}`);
}

function nodeParent(node) {
  if (!Object.prototype.hasOwnProperty.call(node || {}, 'parent') || node.parent == null || node.parent === '') return '0';
  return String(node.parent);
}

function nodeChildren(node) { return Array.isArray(node?.children) ? node.children.map(String) : []; }
function nodeSettings(node) { return isObject(node?.settings) ? node.settings : {}; }

function slotChildIds(node) {
  const out = [];
  if (!isObject(node?.slotChildren)) return out;
  for (const value of Object.values(node.slotChildren)) {
    if (Array.isArray(value)) out.push(...value.map(String));
  }
  return out;
}

function childRefs(node) { return [...new Set([...nodeChildren(node), ...slotChildIds(node)])]; }

function hiddenClasses(node) {
  const raw = nodeSettings(node)?._hidden?._cssClasses;
  if (Array.isArray(raw)) return raw.map(String);
  return String(raw || '').split(/\s+/).filter(Boolean);
}

function descendants(node, byId, limit = 500) {
  const out = [], queue = childRefs(node), seen = new Set();
  while (queue.length && out.length < limit) {
    const id = String(queue.shift());
    if (seen.has(id)) continue;
    seen.add(id);
    const child = byId.get(id);
    if (!child) continue;
    out.push(child);
    queue.push(...childRefs(child));
  }
  return out;
}

function configuredBreakpoints(inspect, spec) {
  const defaults = new Set();
  const rows = spec?.breakpoints?.defaults || [];
  for (const item of rows) defaults.add(String(item?.key || item || ''));
  const local = [
    ...(inspect?.bricks?.breakpoints || []),
    ...(inspect?.wordpress?.bricks_breakpoints || []),
    ...(inspect?.wordpress?.breakpoints || [])
  ];
  for (const item of local) defaults.add(String(item?.key || item?.name || item || ''));
  return new Set([...defaults].filter(Boolean));
}

function configuredPseudoTokens(inspect, spec) {
  const values = new Set();
  const add = value => {
    const raw = String(value || '').trim();
    if (!raw) return;
    values.add(raw.replace(/^:+/,'').replace(/\($/, '('));
  };
  for (const item of spec?.pseudo?.common_valid || []) add(item);
  for (const item of spec?.pseudo?.default_global || spec?.pseudo_classes || []) add(item);
  for (const item of inspect?.bricks?.pseudo_classes || inspect?.wordpress?.bricks_pseudo_classes || []) add(item?.selector || item?.value || item);
  for (const item of ['hover','active','focus','before','after','focus-within','focus-visible','visited','checked']) add(item);
  return values;
}

function settingSuffixWarnings(node, key, breakpoints, pseudos, warnings) {
  const parts = String(key).split(':');
  if (parts.length <= 1) return;
  for (const raw of parts.slice(1)) {
    const suffix = String(raw || '').trim();
    if (!suffix || suffix.startsWith('variant-')) continue;
    if (breakpoints.has(suffix)) continue;
    if (pseudos.has(suffix) || [...pseudos].some(token => token.endsWith('(') && suffix.startsWith(token))) continue;
    warnings.push({ code:'BRICKS_SETTING_SUFFIX_UNKNOWN', node_id:String(node.id), setting:key, suffix, message:`Unknown Bricks setting suffix ${suffix}; confirm it is a configured breakpoint, pseudo selector, or component variant in the target project.` });
  }
}

function validateShapeSettings(node, spec, exactShapes, inspect, errors, warnings) {
  const settings = nodeSettings(node);
  const breakpoints = configuredBreakpoints(inspect, spec);
  const pseudos = configuredPseudoTokens(inspect, spec);

  for (const [key,value] of Object.entries(settings)) {
    settingSuffixWarnings(node, key, breakpoints, pseudos, warnings);
    if (!exactShapes) continue;

    const plainKey = String(key).split(':')[0];
    if (plainKey === '_typography') {
      if (!isObject(value)) errors.push({ code:'BRICKS_TYPOGRAPHY_SHAPE', node_id:String(node.id || ''), setting:key, message:'_typography must be an object.' });
      else for (const prop of Object.keys(value)) if (/[A-Z]/.test(prop)) errors.push({ code:'BRICKS_TYPOGRAPHY_CAMELCASE', node_id:String(node.id), setting:`${key}.${prop}`, message:'Bricks typography uses CSS property names, not camelCase.' });
    }

    if (plainKey === '_boxShadow' && isObject(value)) {
      if (['offsetX','offsetY','blur','spread'].some(prop => Object.prototype.hasOwnProperty.call(value, prop))) {
        errors.push({ code:'BRICKS_SHADOW_VALUES', node_id:String(node.id), setting:key, message:'Box-shadow offsets/blur/spread belong under _boxShadow.values.' });
      }
      if (value.values != null && !isObject(value.values)) errors.push({ code:'BRICKS_SHADOW_VALUES_OBJECT', node_id:String(node.id), setting:key, message:'_boxShadow.values must be an object.' });
    }

    if (plainKey === '_gradient' && isObject(value)) {
      if (Array.isArray(value.stops)) errors.push({ code:'BRICKS_GRADIENT_STOPS', node_id:String(node.id), setting:key, message:'Verified Bricks gradient shape uses colors[], not stops[].' });
      if (value.colors != null && !Array.isArray(value.colors)) errors.push({ code:'BRICKS_GRADIENT_COLORS', node_id:String(node.id), setting:key, message:'_gradient.colors must be an array.' });
      for (const stop of Array.isArray(value.colors) ? value.colors : []) {
        if (!isObject(stop) || !Object.prototype.hasOwnProperty.call(stop,'color') || !Object.prototype.hasOwnProperty.call(stop,'stop')) {
          errors.push({ code:'BRICKS_GRADIENT_STOP_SHAPE', node_id:String(node.id), setting:key, message:'Each gradient color entry needs color and stop.' });
          break;
        }
      }
    }
  }

  if (!exactShapes || !isObject(settings.icon) || !settings.icon.library) return;
  const icon = settings.icon;
  if (icon.library === 'svg') {
    if (!isObject(icon.svg)) errors.push({ code:'BRICKS_ICON_SVG', node_id:String(node.id), message:'SVG icon controls require an svg media object.' });
  } else if (icon.library === 'dynamicData') {
    if (!String(icon.dynamicData || '').trim()) errors.push({ code:'BRICKS_ICON_DYNAMIC_DATA', node_id:String(node.id), message:'Dynamic Data icon controls require dynamicData.' });
  } else if (!String(icon.icon || '').trim()) {
    errors.push({ code:'BRICKS_ICON_VALUE', node_id:String(node.id), message:'Icon controls require an icon value for the selected built-in/custom icon library.' });
  }
}

function validateQuerySettings(node, spec, exactShapes, byId, errors, warnings) {
  if (!exactShapes) return;
  const settings = nodeSettings(node);
  if (settings.hasLoop === true || settings.hasLoop === 'true' || settings.hasLoop === 1) {
    if (!isObject(settings.query)) {
      errors.push({ code:'BRICKS_QUERY_OBJECT', node_id:String(node.id), message:'Native query loops require a query object.' });
    } else if (!String(settings.query.objectType || '').trim() && !String(settings.query.id || '').trim()) {
      errors.push({ code:'BRICKS_QUERY_OBJECT_TYPE', node_id:String(node.id), message:'Local query loops require query.objectType; Global Query references may use query.id.' });
    }
  }

  for (const targetKey of spec?.query?.target_keys || ['queryId','filterQueryId']) {
    if (!settings[targetKey]) continue;
    const target = String(settings[targetKey]);
    const special = spec?.query?.special_targets?.[String(node.name)]?.[targetKey] || [];
    if (special.includes(target)) continue;
    if (byId.has(target)) continue;
    if (spec?.query?.component_runtime_target_suffix && /^[a-f0-9]{6}-[a-f0-9]{6}(?:-[a-f0-9]{6})*$/i.test(target)) {
      warnings.push({ code:'BRICKS_QUERY_RUNTIME_TARGET', node_id:String(node.id), setting:targetKey, target_id:target, message:'Component runtime query target cannot be fully validated against the persisted raw tree.' });
      continue;
    }
    errors.push({ code:'BRICKS_QUERY_TARGET_MISSING', node_id:String(node.id), setting:targetKey, target_id:target, message:`${targetKey} targets missing element ${target}.` });
  }
}

function validateCanonicalPresence(node, mode, errors, warnings) {
  const strict = mode === 'write' || mode === 'canonical';
  const id = String(node?.id || '');
  for (const [key,fallback] of [['parent',0],['children',[]],['settings',{}]]) {
    if (Object.prototype.hasOwnProperty.call(node,key)) continue;
    const code = `BRICKS_${key.toUpperCase()}_IMPLICIT`;
    const message = `Bricks can read this node with implicit ${key}; generated/rewritten nodes should persist canonical ${key}.`;
    (strict ? errors : warnings).push({ code, node_id:id, message, normalized_to:fallback });
  }
  if (Object.prototype.hasOwnProperty.call(node,'children') && !Array.isArray(node.children)) {
    errors.push({ code:'BRICKS_CHILDREN_ARRAY', node_id:id, message:'Element children must be an array when present.' });
  }
  if (Object.prototype.hasOwnProperty.call(node,'settings') && !isObject(node.settings)) {
    errors.push({ code:'BRICKS_SETTINGS_OBJECT', node_id:id, message:'Element settings must be an object when present.' });
  }
  if (Object.prototype.hasOwnProperty.call(node,'slotChildren') && !isObject(node.slotChildren)) {
    errors.push({ code:'BRICKS_SLOT_CHILDREN_OBJECT', node_id:id, message:'slotChildren must be an object keyed by slot element ID.' });
  }
}

function validateBricksJson(input, inspect = {}, options = {}) {
  const parsed = parseInput(input);
  const resolution = options.resolution || resolveBricksSpec(inspect);
  const mode = String(options.mode || 'read').toLowerCase();
  const errors = [], warnings = [];
  if (parsed.parse_error) {
    return { recognized:true, ok:false, format:'invalid-json', errors:[{ code:'BRICKS_JSON_PARSE', message:parsed.parse_error }], warnings, spec:resolution };
  }

  const extracted = extractNodes(parsed.value);
  if (!extracted.recognized) return { recognized:false, ok:true, format:'unknown', errors, warnings, spec:resolution, node_count:0 };
  const nodes = extracted.nodes;
  const spec = resolution?.spec || {};
  const exactShapes = !!resolution?.exact_shapes;
  const byId = new Map();
  const knownElements = allKnownElements(spec);
  const idPattern = exactShapes && spec?.node?.id_pattern ? new RegExp(spec.node.id_pattern) : null;

  for (const node of nodes) {
    if (!looksLikeNode(node)) {
      errors.push({ code:'BRICKS_NODE_SHAPE', message:'Every Bricks entry must include id and name.' });
      continue;
    }
    validateCanonicalPresence(node, mode, errors, warnings);
    const id = String(node.id || '');
    if (!id) errors.push({ code:'BRICKS_ID_REQUIRED', message:'Element id is required.' });
    else if (byId.has(id)) errors.push({ code:'BRICKS_ID_DUPLICATE', node_id:id, message:`Duplicate element id ${id}.` });
    else byId.set(id,node);

    if (idPattern && id && !idPattern.test(id)) {
      const issue = { code:'BRICKS_ID_FORMAT', node_id:id, message:'New Bricks 2.3.13 element IDs use six-character lowercase hexadecimal hashes. Preserve existing IDs, but generate new IDs in canonical format.' };
      (mode === 'write' || mode === 'canonical' ? errors : warnings).push(issue);
    }
    if (exactShapes && knownElements.size && !knownElements.has(String(node.name))) {
      warnings.push({ code:'BRICKS_ELEMENT_UNKNOWN', node_id:id, element:String(node.name), message:'Element name is not in the source-verified native Bricks/Woo catalog; confirm a custom/third-party element registration in the target project.' });
    }
    if (Array.isArray(spec?.legacy_prefer_nested) && spec.legacy_prefer_nested.includes(String(node.name))) {
      warnings.push({ code:'BRICKS_LEGACY_ELEMENT', node_id:id, element:String(node.name), message:`${node.name} remains native but newer work should prefer the nested equivalent when appropriate; do not rewrite existing content without request.` });
    }
    validateShapeSettings(node, spec, exactShapes, inspect, errors, warnings);
  }

  for (const node of nodes) {
    if (!looksLikeNode(node)) continue;
    const id = String(node.id);
    const parent = nodeParent(node);
    const isRoot = ['0',''].includes(parent);
    if (!isRoot && !byId.has(parent)) errors.push({ code:'BRICKS_PARENT_MISSING', node_id:id, parent_id:parent, message:`Parent ${parent} does not exist.` });
    if (!isRoot) {
      const parentNode = byId.get(parent);
      if (parentNode && !childRefs(parentNode).includes(id)) {
        errors.push({ code:'BRICKS_PARENT_CHILD_RECIPROCITY', node_id:id, parent_id:parent, message:'Parent does not list this node in children or slotChildren.' });
      }
    }
    for (const childId of childRefs(node)) {
      const child = byId.get(childId);
      if (!child) errors.push({ code:'BRICKS_CHILD_MISSING', node_id:id, child_id:childId, message:`Child ${childId} does not exist.` });
      else if (nodeParent(child) !== id) errors.push({ code:'BRICKS_CHILD_PARENT_RECIPROCITY', node_id:id, child_id:childId, message:'Child parent does not point back to this node.' });
    }
    if (String(node.name) === 'section' && !isRoot) errors.push({ code:'BRICKS_SECTION_NESTED', node_id:id, message:'section must remain a root-level Bricks layout element.' });
  }

  if (exactShapes) {
    for (const node of nodes) {
      const contract = spec?.nestable_contracts?.[node?.name];
      if (!contract) continue;
      const classes = new Set(descendants(node,byId).flatMap(hiddenClasses));
      for (const required of contract.required_descendant_classes || []) {
        if (!classes.has(required)) errors.push({ code:'BRICKS_NESTABLE_STRUCTURE', node_id:String(node.id), element:String(node.name), missing_class:required, message:`${node.name} is missing required structural class ${required}.` });
      }
    }
  }

  for (const node of nodes) if (looksLikeNode(node)) validateQuerySettings(node, spec, exactShapes, byId, errors, warnings);

  const wrapper = extracted.wrapper;
  if (isObject(wrapper) && ['clipboard','template'].includes(extracted.format)) {
    const classKey = extracted.format === 'clipboard' ? 'globalClasses' : 'global_classes';
    const availableClasses = new Set((Array.isArray(wrapper[classKey]) ? wrapper[classKey] : []).map(item => String(item?.id || '')).filter(Boolean));
    const usedClasses = new Set();
    for (const node of nodes) {
      const classes = nodeSettings(node)?._cssGlobalClasses;
      if (Array.isArray(classes)) classes.forEach(id => usedClasses.add(String(id)));
    }
    for (const id of usedClasses) if (!availableClasses.has(id)) errors.push({ code:'BRICKS_GLOBAL_CLASS_MISSING', class_id:id, message:`Referenced global class ${id} is not bundled in ${classKey}.` });
  }

  if (extracted.format === 'clipboard' && wrapper?.source !== 'bricksCopiedElements') errors.push({ code:'BRICKS_CLIPBOARD_SOURCE', message:'Clipboard format requires source=bricksCopiedElements.' });
  if (extracted.format === 'template' && exactShapes) {
    const expectedKey = extracted.template_type === 'header' ? 'header' : extracted.template_type === 'footer' ? 'footer' : 'content';
    if (!Array.isArray(wrapper?.[expectedKey])) errors.push({ code:'BRICKS_TEMPLATE_ELEMENT_KEY', template_type:extracted.template_type, message:`Template type ${extracted.template_type} requires the ${expectedKey} element array.` });
    const knownTypes = new Set([...(spec?.templates?.core_types || spec?.templates?.types || []), ...(spec?.templates?.woocommerce_types || [])]);
    if (knownTypes.size && !knownTypes.has(extracted.template_type)) warnings.push({ code:'BRICKS_TEMPLATE_TYPE_UNKNOWN', template_type:extracted.template_type, message:'Template type is not in the source-verified Bricks 2.3.13 catalog; confirm project/plugin registration.' });
  }

  if (resolution?.source_required) warnings.push({ code:'BRICKS_SPEC_LOCAL_EVIDENCE_REQUIRED', message:`Bundled spec ${resolution.spec_version || 'unknown'} is not exact for detected version ${resolution.detected_version || 'unknown'}; only invariant validation is authoritative until local source confirms shapes.` });

  return {
    recognized:true,
    ok:errors.length === 0,
    format:extracted.format,
    node_count:nodes.length,
    errors,
    warnings,
    spec:{ source:resolution?.source, status:resolution?.status, detected_version:resolution?.detected_version, spec_version:resolution?.spec_version, exact_shapes:!!resolution?.exact_shapes },
    validation_mode:mode
  };
}

module.exports = { validateBricksJson, extractNodes };
