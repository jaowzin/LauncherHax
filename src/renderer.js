const state = {
  config: null,
  editingId: null,
  trigger: null,
  actionCode: null,
  captureMode: null,
  currentView: 'game'
};

const $ = (id) => document.getElementById(id);

function keyLabel(key) {
  if (!key || !key.code) return 'Não definida';
  const parts = [];
  if (key.ctrl) parts.push('Ctrl');
  if (key.alt) parts.push('Alt');
  if (key.shift) parts.push('Shift');
  if (key.meta) parts.push('Meta');
  parts.push(key.code.replace(/^Key/, '').replace(/^Digit/, ''));
  return parts.join(' + ');
}

function makeKeyDescriptor(event) {
  return {
    code: event.code,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey
  };
}

async function persist() {
  state.config = await window.launcherAPI.saveConfig(state.config);
}

function getGameBounds() {
  const surface = $('gameSurface');
  const rect = surface.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function syncGameView() {
  if (!window.launcherAPI || !$('gameSurface')) return;
  window.launcherAPI.setGameViewState({
    visible: state.currentView === 'game',
    bounds: getGameBounds()
  }).catch(console.error);
}

function showView(name) {
  state.currentView = name;
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === name));
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`));
  requestAnimationFrame(syncGameView);
}

function updateTypeFields() {
  const type = $('macroType').value;
  $('remapActionGroup').classList.toggle('hidden', type !== 'remap');
  $('chatActionGroup').classList.toggle('hidden', type !== 'chat');
  $('sequenceActionGroup').classList.toggle('hidden', type !== 'sequence');
  $('delayGroup').classList.toggle('hidden', type === 'remap');
}

function resetEditor() {
  state.editingId = null;
  state.trigger = null;
  state.actionCode = null;
  $('macroName').value = '';
  $('macroType').value = 'remap';
  $('macroText').value = '';
  $('macroSequence').value = '';
  $('macroDelay').value = '35';
  $('captureTrigger').textContent = 'Clique e pressione uma tecla';
  $('captureAction').textContent = 'Clique e pressione a tecla de saída';
  $('editorTitle').textContent = 'Nova macro';
  updateTypeFields();
}

function openEditor(macro = null) {
  resetEditor();
  if (macro) {
    state.editingId = macro.id;
    state.trigger = macro.trigger;
    state.actionCode = macro.actionCode || null;
    $('macroName').value = macro.name || '';
    $('macroType').value = macro.type || 'remap';
    $('macroText').value = macro.text || '';
    $('macroSequence').value = Array.isArray(macro.sequence) ? macro.sequence.join(', ') : '';
    $('macroDelay').value = String(macro.delay ?? 35);
    $('captureTrigger').textContent = keyLabel(macro.trigger);
    $('captureAction').textContent = macro.actionCode || 'Clique e pressione a tecla de saída';
    $('editorTitle').textContent = 'Editar macro';
    updateTypeFields();
  }
  $('macroEditor').classList.remove('hidden');
  $('macroName').focus();
}

function closeEditor() {
  state.captureMode = null;
  $('macroEditor').classList.add('hidden');
  resetEditor();
}

function macroDescription(macro) {
  if (macro.type === 'chat') return `Chat: “${macro.text || ''}”`;
  if (macro.type === 'sequence') return `Sequência: ${(macro.sequence || []).join(' → ')}`;
  return `Remapear para ${macro.actionCode || '?'}`;
}

function renderMacros() {
  const list = $('macroList');
  list.innerHTML = '';
  const macros = state.config.macros || [];
  $('emptyMacros').classList.toggle('hidden', macros.length > 0);

  for (const macro of macros) {
    const row = document.createElement('article');
    row.className = 'macro-card';
    row.innerHTML = `
      <div class="macro-main">
        <button class="toggle ${macro.enabled !== false ? 'on' : ''}" data-action="toggle" aria-label="Ativar/desativar"></button>
        <div>
          <div class="macro-title-line"><strong></strong><span class="key-pill"></span></div>
          <p></p>
        </div>
      </div>
      <div class="macro-actions">
        <button class="ghost-btn" data-action="edit">Editar</button>
        <button class="danger-btn" data-action="delete">Excluir</button>
      </div>
    `;
    row.querySelector('strong').textContent = macro.name || 'Macro';
    row.querySelector('.key-pill').textContent = keyLabel(macro.trigger);
    row.querySelector('p').textContent = macroDescription(macro);
    row.querySelector('[data-action="toggle"]').addEventListener('click', async () => {
      macro.enabled = macro.enabled === false;
      await persist();
      renderMacros();
    });
    row.querySelector('[data-action="edit"]').addEventListener('click', () => openEditor(macro));
    row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      state.config.macros = state.config.macros.filter(item => item.id !== macro.id);
      await persist();
      renderMacros();
    });
    list.appendChild(row);
  }
}

async function saveMacro() {
  const name = $('macroName').value.trim() || 'Macro';
  const type = $('macroType').value;
  if (!state.trigger?.code) {
    $('captureTrigger').classList.add('invalid');
    setTimeout(() => $('captureTrigger').classList.remove('invalid'), 900);
    return;
  }

  const macro = {
    id: state.editingId || crypto.randomUUID(),
    name,
    enabled: true,
    trigger: state.trigger,
    type,
    delay: Number($('macroDelay').value) || 35
  };

  if (type === 'remap') {
    if (!state.actionCode) {
      $('captureAction').classList.add('invalid');
      setTimeout(() => $('captureAction').classList.remove('invalid'), 900);
      return;
    }
    macro.actionCode = state.actionCode;
  } else if (type === 'chat') {
    macro.text = $('macroText').value;
  } else {
    macro.sequence = $('macroSequence').value.split(',').map(v => v.trim()).filter(Boolean).slice(0, 30);
  }

  const index = state.config.macros.findIndex(item => item.id === macro.id);
  if (index >= 0) state.config.macros[index] = { ...state.config.macros[index], ...macro };
  else state.config.macros.push(macro);

  await persist();
  renderMacros();
  closeEditor();
}

function bindEvents() {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
  $('newMacro').addEventListener('click', () => openEditor());
  $('closeEditor').addEventListener('click', closeEditor);
  $('cancelMacro').addEventListener('click', closeEditor);
  $('saveMacro').addEventListener('click', saveMacro);
  $('macroType').addEventListener('change', updateTypeFields);

  $('captureTrigger').addEventListener('click', () => {
    state.captureMode = 'trigger';
    $('captureTrigger').textContent = 'Pressione a tecla...';
  });
  $('captureAction').addEventListener('click', () => {
    state.captureMode = 'action';
    $('captureAction').textContent = 'Pressione a tecla...';
  });

  window.addEventListener('keydown', (event) => {
    if (!state.captureMode) return;
    event.preventDefault();
    event.stopPropagation();
    if (['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'].includes(event.code)) return;

    if (state.captureMode === 'trigger') {
      state.trigger = makeKeyDescriptor(event);
      $('captureTrigger').textContent = keyLabel(state.trigger);
    } else {
      state.actionCode = event.code;
      $('captureAction').textContent = event.code;
    }
    state.captureMode = null;
  }, true);

  $('reloadGame').addEventListener('click', () => window.launcherAPI.reloadGame());
  $('homeGame').addEventListener('click', () => {
    window.launcherAPI.loadGame(state.config.settings.gameUrl || 'https://www.haxball.com/play');
  });

  $('saveSettings').addEventListener('click', async () => {
    const value = $('gameUrl').value.trim();
    try {
      const url = new URL(value);
      if (!(url.hostname === 'haxball.com' || url.hostname.endsWith('.haxball.com'))) throw new Error('domain');
      state.config.settings.gameUrl = value;
      await persist();
      await window.launcherAPI.loadGame(value);
      $('saveSettings').textContent = 'Salvo ✓';
      setTimeout(() => $('saveSettings').textContent = 'Salvar configurações', 1200);
    } catch {
      $('gameUrl').classList.add('invalid-input');
      setTimeout(() => $('gameUrl').classList.remove('invalid-input'), 900);
    }
  });

  window.addEventListener('resize', () => requestAnimationFrame(syncGameView));

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => requestAnimationFrame(syncGameView));
    observer.observe($('gameSurface'));
  }

  window.launcherAPI.onGameLayoutRequest(() => requestAnimationFrame(syncGameView));
}

async function init() {
  state.config = await window.launcherAPI.getConfig();
  $('version').textContent = `v${await window.launcherAPI.getVersion()}`;
  $('gameUrl').value = state.config.settings.gameUrl || 'https://www.haxball.com/play';
  bindEvents();
  renderMacros();
  requestAnimationFrame(syncGameView);
}

init().catch(console.error);
