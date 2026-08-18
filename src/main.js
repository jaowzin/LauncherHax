const { app, BrowserWindow, WebContentsView, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let gameView = null;
let gameContents = null;
let replayingMacro = false;
let configCache = null;

const DEFAULT_CONFIG = {
  macros: [],
  settings: {
    gameUrl: 'https://www.haxball.com/play',
    launchOnStart: true
  }
};

function configPath() {
  return path.join(app.getPath('userData'), 'launcherhax.json');
}

function loadConfig() {
  if (configCache) return configCache;
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    configCache = {
      ...DEFAULT_CONFIG,
      ...parsed,
      settings: { ...DEFAULT_CONFIG.settings, ...(parsed.settings || {}) },
      macros: Array.isArray(parsed.macros) ? parsed.macros : []
    };
  } catch {
    configCache = structuredClone(DEFAULT_CONFIG);
  }
  return configCache;
}

function saveConfig(nextConfig) {
  configCache = {
    ...DEFAULT_CONFIG,
    ...nextConfig,
    settings: { ...DEFAULT_CONFIG.settings, ...(nextConfig.settings || {}) },
    macros: Array.isArray(nextConfig.macros) ? nextConfig.macros : []
  };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(configCache, null, 2), 'utf8');
  return configCache;
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
    code: input.code || '',
    ctrl: Boolean(input.control),
    alt: Boolean(input.alt),
    shift: Boolean(input.shift),
    meta: Boolean(input.meta)
  };
}

function triggerMatches(trigger, input) {
  if (!trigger || !trigger.code) return false;
  const pressed = normalizeInput(input);
  return trigger.code === pressed.code &&
    Boolean(trigger.ctrl) === pressed.ctrl &&
    Boolean(trigger.alt) === pressed.alt &&
    Boolean(trigger.shift) === pressed.shift &&
    Boolean(trigger.meta) === pressed.meta;
}

function codeToKeyCode(code) {
  if (!code) return '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  const map = {
    Space: 'Space', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace',
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

async function executeMacro(macro) {
  if (!gameContents || gameContents.isDestroyed()) return;
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
      const sequence = Array.isArray(macro.sequence) ? macro.sequence : [];
      for (const code of sequence) {
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
          autoHideMenuBar: true,
          backgroundColor: '#0b0d12',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
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
    const config = loadConfig();
    const macro = config.macros.find(item => item.enabled !== false && triggerMatches(item.trigger, input));
    if (!macro) return;

    event.preventDefault();
    executeMacro(macro).catch(console.error);
  });

  contents.on('destroyed', () => {
    if (gameContents === contents) gameContents = null;
  });
}

function createGameView() {
  if (!mainWindow || gameView) return;

  gameView = new WebContentsView({
    webPreferences: {
      partition: 'persist:haxball',
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  gameView.setBackgroundColor('#111111');
  gameView.setVisible(false);
  mainWindow.contentView.addChildView(gameView);
  attachGameWebContents(gameView.webContents);

  const url = loadConfig().settings.gameUrl || DEFAULT_CONFIG.settings.gameUrl;
  gameView.webContents.loadURL(url).catch(console.error);
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

  if (width > 0 && height > 0) {
    gameView.setBounds({ x, y, width, height });
  }
  gameView.setVisible(visible && width > 0 && height > 0);
}

function loadGameUrl(url) {
  if (!gameView || !isAllowedGameUrl(url)) return false;
  gameView.webContents.loadURL(url).catch(console.error);
  return true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: '#0b0d12',
    title: 'LauncherHax',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  createGameView();

  mainWindow.on('resize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('game:request-layout');
  });

  mainWindow.on('closed', () => {
    if (gameView && !gameView.webContents.isDestroyed()) {
      gameView.webContents.close();
    }
    gameView = null;
    gameContents = null;
    mainWindow = null;
  });
}

ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:save', (_event, config) => saveConfig(config));
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('external:open', (_event, url) => {
  if (typeof url === 'string' && /^https:\/\//i.test(url)) return shell.openExternal(url);
});
ipcMain.handle('game:view-state', (_event, payload) => applyGameViewState(payload));
ipcMain.handle('game:reload', () => {
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
