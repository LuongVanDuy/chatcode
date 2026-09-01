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
  return isObject(value) && typeof value.name === 'string' && Object.prototype.hasOwnProperty.call(value, 'id') && Object.prototype.hasOwnProperty.call(value, 'parent');
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
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') walkSettings(child, visitor, `${path}.${key}`);
  }
}

function hiddenClasses(node) {
  const raw = node?.settings?._hidden?._cssClasses;
  if (Array.isArray(raw)) return raw.map(String);
  return String(raw || '').split(/\s+/).filter(Boolean);
}

function descendants(node, byId, limit = 300) {
  const out = [], queue = [...(Array.isArray(node?.children) ? node.children : [])];
  const seen = new Set();
  while (queue.length && out.length < limit) {
    const id = String(queue.shift());
    if (seen.has(id)) continue;
    seen.add(id);
    const child = byId.get(id);
    if (!child) continue;
    out.push(child);
    queue.push(...(Array.isArray(child.children) ? child.children : []));
  }
  return out;
}

function validateShapeSettings(node, spec, exactShapes, customBreakpoints, errors, warnings) {
  const settings = node.settings;
  if (!isObject(settings)) {
    errors.push({ code:'BRICKS_SETTINGS_OBJECT', node_id:String(node.id || ''), message:'Element settings must be an object.' });
    return;
  }
  if (!exactShapes) return;

  const defaults = new Set(spec?.breakpoints?.defaults || []);
  const invalidAliases = new Set(spec?.breakpoints?.known_invalid_aliases || []);
  const pseudos = new Set(['hover','active','focus','before','after','focus-within','focus-visible','visited','checked']);

  for (const [key,value] of Object.entries(settings)) {
    const parts = String(key).split(':');
    if (parts.length > 1) {
      const suffix = parts[1];
      if (!pseudos.has(suffix) && invalidAliases.has(suffix)) {
        errors.push({ code:'BRICKS_BREAKPOINT_ALIAS', node_id:String(node.id), setting:key, message:`${suffix} is not a verified default Bricks breakpoint key.` });
      } else if (!pseudos.has(suffix) && !defaults.has(suffix) && !customBreakpoints.has(suffix)) {
        warnings.push({ code:'BRICKS_BREAKPOINT_UNKNOWN', node_id:String(node.id), setting:key, message:`Unknown breakpoint ${suffix}; confirm it exists in the target project.` });
      }
    }

    if (key === '_typography') {
      if (!isObject(value)) errors.push({ code:'BRICKS_TYPOGRAPHY_SHAPE', node_id:String(node.id), setting:key, message:'_typography must be an object.' });
      else {
        for (const prop of Object.keys(value)) {
          if (/[A-Z]/.test(prop)) errors.push({ code:'BRICKS_TYPOGRAPHY_CAMELCASE', node_id:String(node.id), setting:`${key}.${prop}`, message:'Bricks typography uses CSS property names, not camelCase.' });
        }
      }
    }

    if (key === '_boxShadow' && isObject(value)) {
      if (['offsetX','offsetY','blur','spread'].some(prop => Object.prototype.hasOwnProperty.call(value, prop))) {
        errors.push({ code:'BRICKS_SHADOW_VALUES', node_id:String(node.id), setting:key, message:'Box-shadow offsets/blur/spread belong under _boxShadow.values.' });
      }
      if (value.values != null && !isObject(value.values)) errors.push({ code:'BRICKS_SHADOW_VALUES_OBJECT', node_id:String(node.id), setting:key, message:'_boxShadow.values must be an object.' });
    }

    if (key === '_gradient' && isObject(value)) {
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

  if (isObject(settings.icon) && settings.icon.library) {
    const icon = settings.icon;
    if (icon.library === 'svg') {
      if (!isObject(icon.svg)) errors.push({ code:'BRICKS_ICON_SVG', node_id:String(node.id), message:'SVG icon controls require an svg media object.' });
    } else if (!String(icon.icon || '').trim()) {
      errors.push({ code:'BRICKS_ICON_VALUE', node_id:String(node.id), message:'Icon controls require an icon value for the selected library.' });
    }
  }

  if (settings.hasLoop === true || settings.hasLoop === 'true' || settings.hasLoop === 1) {
    if (!isObject(settings.query) || !String(settings.query.objectType || '').trim()) {
      errors.push({ code:'BRICKS_QUERY_OBJECT_TYPE', node_id:String(node.id), message:'Native query loops require query.objectType.' });
    }
  }
}

function validateBricksJson(input, inspect = {}, options = {}) {
  const parsed = parseInput(input);
  const resolution = options.resolution || resolveBricksSpec(inspect);
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
  const customBreakpoints = new Set((inspect?.bricks?.breakpoints || inspect?.wordpress?.bricks_breakpoints || []).map(item => String(item?.key || item?.name || item || '')));

  for (const node of nodes) {
    if (!looksLikeNode(node)) {
      errors.push({ code:'BRICKS_NODE_SHAPE', message:'Every Bricks entry must include id, name and parent.' });
      continue;
    }
    const id = String(node.id || '');
    if (!id) errors.push({ code:'BRICKS_ID_REQUIRED', message:'Element id is required.' });
    else if (byId.has(id)) errors.push({ code:'BRICKS_ID_DUPLICATE', node_id:id, message:`Duplicate element id ${id}.` });
    else byId.set(id,node);
    if (!Array.isArray(node.children)) errors.push({ code:'BRICKS_CHILDREN_ARRAY', node_id:id, message:'Element children must be an array.' });
    if (resolution?.exact_shapes && spec?.node?.id_pattern && id && !(new RegExp(spec.node.id_pattern)).test(id)) {
      warnings.push({ code:'BRICKS_ID_FORMAT', node_id:id, message:'Element id does not match the verified six-character alphanumeric format; preserve existing legacy IDs, but generate new IDs in the verified format.' });
    }
    if (exactShapes && knownElements.size && !knownElements.has(String(node.name))) {
      warnings.push({ code:'BRICKS_ELEMENT_UNKNOWN', node_id:id, element:String(node.name), message:'Element name is not in the bundled verified core catalog; confirm against local Bricks/plugin registration.' });
    }
    validateShapeSettings(node, spec, exactShapes, customBreakpoints, errors, warnings);
  }

  for (const node of nodes) {
    if (!looksLikeNode(node)) continue;
    const id = String(node.id);
    const parent = String(node.parent);
    const isRoot = node.parent === 0 || parent === '0';
    if (!isRoot && !byId.has(parent)) errors.push({ code:'BRICKS_PARENT_MISSING', node_id:id, parent_id:parent, message:`Parent ${parent} does not exist.` });
    if (!isRoot) {
      const parentNode = byId.get(parent);
      if (parentNode && !(parentNode.children || []).map(String).includes(id)) errors.push({ code:'BRICKS_PARENT_CHILD_RECIPROCITY', node_id:id, parent_id:parent, message:'Parent does not list this node in children.' });
    }
    for (const childIdRaw of Array.isArray(node.children) ? node.children : []) {
      const childId = String(childIdRaw);
      const child = byId.get(childId);
      if (!child) errors.push({ code:'BRICKS_CHILD_MISSING', node_id:id, child_id:childId, message:`Child ${childId} does not exist.` });
      else if (String(child.parent) !== id) errors.push({ code:'BRICKS_CHILD_PARENT_RECIPROCITY', node_id:id, child_id:childId, message:'Child parent does not point back to this node.' });
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

  for (const node of nodes) {
    const settings = node?.settings;
    if (!isObject(settings)) continue;
    for (const targetKey of spec?.query?.target_keys || ['queryId','filterQueryId']) {
      if (!settings[targetKey]) continue;
      const target = String(settings[targetKey]);
      if (!byId.has(target)) errors.push({ code:'BRICKS_QUERY_TARGET_MISSING', node_id:String(node.id), setting:targetKey, target_id:target, message:`${targetKey} targets missing element ${target}.` });
    }
  }

  const wrapper = extracted.wrapper;
  if (isObject(wrapper) && ['clipboard','template'].includes(extracted.format)) {
    const classKey = extracted.format === 'clipboard' ? 'globalClasses' : 'global_classes';
    const availableClasses = new Set((Array.isArray(wrapper[classKey]) ? wrapper[classKey] : []).map(item => String(item?.id || '')).filter(Boolean));
    const usedClasses = new Set();
    for (const node of nodes) {
      const classes = node?.settings?._cssGlobalClasses;
      if (Array.isArray(classes)) classes.forEach(id => usedClasses.add(String(id)));
    }
    for (const id of usedClasses) if (!availableClasses.has(id)) errors.push({ code:'BRICKS_GLOBAL_CLASS_MISSING', class_id:id, message:`Referenced global class ${id} is not bundled in ${classKey}.` });
  }

  if (extracted.format === 'clipboard' && wrapper?.source !== 'bricksCopiedElements') errors.push({ code:'BRICKS_CLIPBOARD_SOURCE', message:'Clipboard format requires source=bricksCopiedElements.' });
  if (extracted.format === 'template' && exactShapes) {
    const expectedKey = extracted.template_type === 'header' ? 'header' : extracted.template_type === 'footer' ? 'footer' : 'content';
    if (!Array.isArray(wrapper?.[expectedKey])) errors.push({ code:'BRICKS_TEMPLATE_ELEMENT_KEY', template_type:extracted.template_type, message:`Template type ${extracted.template_type} requires the ${expectedKey} element array.` });
  }

  if (resolution?.source_required) warnings.push({ code:'BRICKS_SPEC_LOCAL_EVIDENCE_REQUIRED', message:`Bundled spec ${resolution.spec_version || 'unknown'} is not exact for detected version ${resolution.detected_version || 'unknown'}; only invariant validation is authoritative until local source confirms shapes.` });

  return {
    recognized:true,
    ok:errors.length === 0,
    format:extracted.format,
    node_count:nodes.length,
    errors,
    warnings,
    spec:{ source:resolution?.source, status:resolution?.status, detected_version:resolution?.detected_version, spec_version:resolution?.spec_version, exact_shapes:!!resolution?.exact_shapes }
  };
}

module.exports = { validateBricksJson, extractNodes };
