const { app, BrowserWindow, WebContentsView, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let gameView = null;
let gameContents = null;
let replayingMacro = false;
let configCache = null;
let activeLoopMacroId = null;
let loopToken = 0;

const PRESET_PACK_VERSION = 2;
const DEFAULT_MACROS = [
  {
    id: 'preset-chat-gg', preset: true, name: 'GG', enabled: true,
    trigger: { code: 'F1', ctrl: false, alt: false, shift: false, meta: false },
    type: 'chat', text: 'gg', delay: 55
  },
  {
    id: 'preset-chat-glhf', preset: true, name: 'GL HF', enabled: true,
    trigger: { code: 'F2', ctrl: false, alt: false, shift: false, meta: false },
    type: 'chat', text: 'gl hf', delay: 55
  },
  {
    id: 'preset-chat-boa', preset: true, name: 'Boa!', enabled: true,
    trigger: { code: 'F3', ctrl: false, alt: false, shift: false, meta: false },
    type: 'chat', text: 'boa!', delay: 55
  },
  {
    id: 'preset-chat-sorry', preset: true, name: 'Foi mal', enabled: true,
    trigger: { code: 'F4', ctrl: false, alt: false, shift: false, meta: false },
    type: 'chat', text: 'foi mal', delay: 55
  },
  {
    id: 'preset-chat-passa', preset: true, name: 'Passa!', enabled: true,
    trigger: { code: 'F5', ctrl: false, alt: false, shift: false, meta: false },
    type: 'chat', text: 'passa!', delay: 55
  },
  {
    id: 'preset-chat-gk', preset: true, name: 'Eu defendo', enabled: true,
    trigger: { code: 'F6', ctrl: false, alt: false, shift: false, meta: false },
    type: 'chat', text: 'eu defendo', delay: 55
  },
  {
    id: 'preset-dribbling-assist', preset: true, name: 'Dribbling Assist', enabled: true,
    trigger: { code: 'F7', ctrl: false, alt: false, shift: false, meta: false },
    type: 'toggleLoop', sequence: ['KeyW', 'KeyS', 'KeyD', 'KeyA'], delay: 50
  },
  {
    id: 'preset-remap-kick', preset: true, name: 'Kick alternativo', enabled: true,
    trigger: { code: 'CapsLock', ctrl: false, alt: false, shift: false, meta: false },
    type: 'remap', actionCode: 'Space', delay: 35
  }
];

function cloneDefaultMacros() {
  return structuredClone(DEFAULT_MACROS);
}

const DEFAULT_CONFIG = {
  macros: cloneDefaultMacros(),
  presetPackVersion: PRESET_PACK_VERSION,
  settings: { gameUrl: 'https://www.haxball.com/play', launchOnStart: true }
};

function configPath() {
  return path.join(app.getPath('userData'), 'launcherhax.json');
}

function persistConfigFile(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
}

function mergeMissingPresets(macros) {
  const result = Array.isArray(macros) ? [...macros] : [];
  const ids = new Set(result.map(item => item.id));
  for (const preset of cloneDefaultMacros()) {
    if (!ids.has(preset.id)) result.push(preset);
  }
  return result;
}

function loadConfig() {
  if (configCache) return configCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    const oldPackVersion = Number(parsed.presetPackVersion || 0);
    let macros = Array.isArray(parsed.macros) ? parsed.macros : [];
    const upgraded = oldPackVersion < PRESET_PACK_VERSION;
    if (upgraded) macros = mergeMissingPresets(macros);

    configCache = {
      ...DEFAULT_CONFIG,
      ...parsed,
      presetPackVersion: PRESET_PACK_VERSION,
      settings: { ...DEFAULT_CONFIG.settings, ...(parsed.settings || {}) },
      macros
    };
    if (upgraded) persistConfigFile(configCache);
  } catch {
    configCache = structuredClone(DEFAULT_CONFIG);
    persistConfigFile(configCache);
  }
  return configCache;
}

function saveConfig(nextConfig) {
  configCache = {
    ...DEFAULT_CONFIG,
    ...nextConfig,
    presetPackVersion: PRESET_PACK_VERSION,
    settings: { ...DEFAULT_CONFIG.settings, ...(nextConfig.settings || {}) },
    macros: Array.isArray(nextConfig.macros) ? nextConfig.macros : []
  };
  persistConfigFile(configCache);
  if (activeLoopMacroId) {
    const active = configCache.macros.find(item => item.id === activeLoopMacroId);
    if (!active || active.enabled === false) stopActiveLoop();
  }
  return configCache;
}

function installPresetMacros() {
  const config = loadConfig();
  const current = Array.isArray(config.macros) ? config.macros : [];
  const presetIds = new Set(DEFAULT_MACROS.map(item => item.id));
  const custom = current.filter(item => !item.preset && !presetIds.has(item.id));
  stopActiveLoop();
  return saveConfig({ ...config, macros: [...cloneDefaultMacros(), ...custom] });
}

function isAllowedGameUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'haxball.com' || parsed.hostname.endsWith('.haxball.com'));
  } catch {
    return false;
  }
}

function normalizeInput(input) {
  return {
    code: input.code || '', ctrl: Boolean(input.control), alt: Boolean(input.alt),
    shift: Boolean(input.shift), meta: Boolean(input.meta)
  };
}

function triggerMatches(trigger, input) {
  if (!trigger || !trigger.code) return false;
  const pressed = normalizeInput(input);
  return trigger.code === pressed.code && Boolean(trigger.ctrl) === pressed.ctrl &&
    Boolean(trigger.alt) === pressed.alt && Boolean(trigger.shift) === pressed.shift &&
    Boolean(trigger.meta) === pressed.meta;
}

function codeToKeyCode(code) {
  if (!code) return '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  const map = {
    Space: 'Space', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace', CapsLock: 'CapsLock',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Control', ControlRight: 'Control',
    AltLeft: 'Alt', AltRight: 'Alt'
  };
  if (map[code]) return map[code];
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return code;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sendKey(code, modifiers = []) {
  if (!gameContents || gameContents.isDestroyed()) return;
  const keyCode = codeToKeyCode(code);
  if (!keyCode) return;
  gameContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  gameContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}

function emitLoopState(id) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('macros:loop-state', { id: id || null });
}

function stopActiveLoop() {
  activeLoopMacroId = null;
  loopToken += 1;
  emitLoopState(null);
}

async function runLoopMacro(macro, token) {
  const sequence = Array.isArray(macro.sequence) && macro.sequence.length ? macro.sequence : ['KeyW', 'KeyS', 'KeyD', 'KeyA'];
  const delay = Math.max(10, Math.min(Number(macro.delay) || 50, 2000));

  while (activeLoopMacroId === macro.id && token === loopToken && gameContents && !gameContents.isDestroyed()) {
    const current = loadConfig().macros.find(item => item.id === macro.id);
    if (!current || current.enabled === false) break;

    for (const code of sequence) {
      if (activeLoopMacroId !== macro.id || token !== loopToken) break;
      replayingMacro = true;
      try { sendKey(code); } finally { replayingMacro = false; }
      await sleep(delay);
    }
  }

  if (activeLoopMacroId === macro.id && token === loopToken) stopActiveLoop();
}

function toggleLoopMacro(macro) {
  if (activeLoopMacroId === macro.id) {
    stopActiveLoop();
    return;
  }
  stopActiveLoop();
  activeLoopMacroId = macro.id;
  const token = loopToken;
  emitLoopState(macro.id);
  runLoopMacro(macro, token).catch(error => {
    console.error(error);
    stopActiveLoop();
  });
}

async function executeMacro(macro) {
  if (!gameContents || gameContents.isDestroyed()) return;

  if (macro.type === 'toggleLoop') {
    toggleLoopMacro(macro);
    return;
  }

  replayingMacro = true;
  try {
    const delay = Math.max(0, Math.min(Number(macro.delay) || 35, 2000));
    if (macro.type === 'remap') {
      sendKey(macro.actionCode);
      return;
    }
    if (macro.type === 'chat') {
      sendKey('Enter');
      await sleep(Math.max(delay, 50));
      if (!gameContents.isDestroyed()) gameContents.insertText(String(macro.text || ''));
      await sleep(Math.max(delay, 50));
      sendKey('Enter');
      return;
    }
    if (macro.type === 'sequence') {
      for (const code of Array.isArray(macro.sequence) ? macro.sequence : []) {
        sendKey(code);
        await sleep(delay);
      }
    }
  } finally {
    replayingMacro = false;
  }
}

function attachGameWebContents(contents) {
  gameContents = contents;

  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedGameUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true, backgroundColor: '#080b12',
          webPreferences: { nodeIntegration: false, contextIsolation: true }
        }
      };
    }
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (isAllowedGameUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url).catch(() => {});
  });

  contents.on('before-input-event', (event, input) => {
    if (replayingMacro || input.type !== 'keyDown' || input.isAutoRepeat) return;
    const macro = loadConfig().macros.find(item => item.enabled !== false && triggerMatches(item.trigger, input));
    if (!macro) return;
    event.preventDefault();
    executeMacro(macro).catch(console.error);
  });

  contents.on('blur', () => stopActiveLoop());
  contents.on('destroyed', () => {
    stopActiveLoop();
    if (gameContents === contents) gameContents = null;
  });
}

function createGameView() {
  if (!mainWindow || gameView) return;
  gameView = new WebContentsView({
    webPreferences: { partition: 'persist:haxball', nodeIntegration: false, contextIsolation: true }
  });
  gameView.setBackgroundColor('#080b12');
  gameView.setVisible(false);
  mainWindow.contentView.addChildView(gameView);
  attachGameWebContents(gameView.webContents);
  gameView.webContents.loadURL(loadConfig().settings.gameUrl || DEFAULT_CONFIG.settings.gameUrl).catch(console.error);
}

function applyGameViewState(payload = {}) {
  if (!mainWindow || !gameView) return;
  const visible = Boolean(payload.visible);
  const bounds = payload.bounds || {};
  const [contentWidth, contentHeight] = mainWindow.getContentSize();
  const x = Math.max(0, Math.min(Math.round(Number(bounds.x) || 0), contentWidth));
  const y = Math.max(0, Math.min(Math.round(Number(bounds.y) || 0), contentHeight));
  const width = Math.max(0, Math.min(Math.round(Number(bounds.width) || 0), contentWidth - x));
  const height = Math.max(0, Math.min(Math.round(Number(bounds.height) || 0), contentHeight - y));
  if (width > 0 && height > 0) gameView.setBounds({ x, y, width, height });
  gameView.setVisible(visible && width > 0 && height > 0);
  if (!visible) stopActiveLoop();
}

function loadGameUrl(url) {
  if (!gameView || !isAllowedGameUrl(url)) return false;
  stopActiveLoop();
  gameView.webContents.loadURL(url).catch(console.error);
  return true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380, height: 860, minWidth: 980, minHeight: 660,
    backgroundColor: '#080b12', title: 'LauncherHax', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  createGameView();
  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('game:request-layout');
  });
  mainWindow.on('closed', () => {
    stopActiveLoop();
    if (gameView && !gameView.webContents.isDestroyed()) gameView.webContents.close();
    gameView = null;
    gameContents = null;
    mainWindow = null;
  });
}

ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:save', (_event, config) => saveConfig(config));
ipcMain.handle('macros:install-presets', () => installPresetMacros());
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('external:open', (_event, url) => {
  if (typeof url === 'string' && /^https:\/\//i.test(url)) return shell.openExternal(url);
});
ipcMain.handle('game:view-state', (_event, payload) => applyGameViewState(payload));
ipcMain.handle('game:reload', () => {
  stopActiveLoop();
  if (gameView && !gameView.webContents.isDestroyed()) gameView.webContents.reload();
});
ipcMain.handle('game:load', (_event, url) => loadGameUrl(url));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
