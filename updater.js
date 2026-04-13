const path = require('path');
const fs = require('fs');
const log = require('electron-log');
const { readState, mergeState, getStatePath } = require('./updateState');

const MAX_FAILED_INSTALLS = 2;
const LOOP_WINDOW_MS = 5 * 60 * 1000;
const UPDATE_CHECK_COOLDOWN = 5 * 60 * 1000;
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const STARTUP_CHECK_DELAY_MS = 3000;
const DISABLE_FOR_MS = 6 * 60 * 60 * 1000;

function parseSemverTriple(v) {
  if (!v || typeof v !== 'string') return null;
  const m = String(v).trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function semverEq(a, b) {
  const pa = parseSemverTriple(a);
  const pb = parseSemverTriple(b);
  if (!pa || !pb) return String(a) === String(b);
  return pa[0] === pb[0] && pa[1] === pb[1] && pa[2] === pb[2];
}

function createNoopUpdaterController(app, reason) {
  return {
    isEnabled: false,
    scheduleDeferredCheck() {},
    checkForUpdates() {
      if (reason === 'portable') {
        return Promise.resolve({
          status: 'manual',
          message: 'Portable builds do not auto-update to avoid switching to a different data location. Download a new portable build and keep the existing userData folder.',
          currentVersion: app.getVersion(),
        });
      }
      return Promise.resolve({
        status: 'dev',
        message: 'Updates only apply to the installed app',
        currentVersion: app.getVersion(),
      });
    },
    installDownloadedUpdate() {
      if (reason === 'portable') {
        return { ok: false, error: 'Portable builds do not auto-install updates.' };
      }
      return { ok: false, error: 'Updater is not available in this environment.' };
    },
    getPublicState() {
      return {
        status: reason === 'portable' ? 'manual' : 'dev',
        currentVersion: app.getVersion(),
        persisted: null,
      };
    },
    resetLoopState() {
      return { ok: false, error: 'Updater is not available in this environment.' };
    },
  };
}

function initUpdater(options) {
  const {
    app,
    autoUpdater,
    BrowserWindow,
    dialog,
    mainWindowRef,
    flushDbSync,
    closeDb,
    stopSyncTimer,
    stopBackupScheduler,
    isPortableBuild,
  } = options;

  if (!app.isPackaged) {
    return createNoopUpdaterController(app, 'dev');
  }
  if (isPortableBuild) {
    return createNoopUpdaterController(app, 'portable');
  }

  log.transports.file.level = 'info';
  log.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'cn-auto-update.log');
  const logger = log.scope('updater');

  let updaterState = 'idle';
  let downloadedVersion = null;
  let lastCheckTime = 0;
  let consecutiveFailures = 0;
  let listenersRegistered = false;
  let quitAndInstallCalled = false;
  let loopDetected = false;
  let intervalHandle = null;
  const cycleId = Date.now().toString(36);

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.logger = logger;

  function getMainWindow() {
    return typeof mainWindowRef === 'function' ? mainWindowRef() : null;
  }

  function sendStatus(payload) {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.send('app-update-status', payload);
      } catch (err) {
        logger.warn('sendStatus failed:', err && err.message ? err.message : err);
      }
    }
  }

  function getPersistedState() {
    return readState(app);
  }

  function setPersistedState(patch) {
    return mergeState(app, patch);
  }

  function isUpdaterDisabled(state) {
    return !!(state.updaterDisabledUntil && state.updaterDisabledUntil > Date.now());
  }

  /** Do not clear failure / pending state on "no update" if we are mid-update or recovering. */
  function hasOutstandingInstallFailure(cur) {
    const pending = cur.pendingUpdateVersion || cur.pendingInstallVersion;
    if (pending && !semverEq(pending, app.getVersion())) {
      if ((cur.failedInstallCount || 0) > 0) return true;
      if (cur.installAttemptedAt) return true;
      if (cur.updateDownloadedAt) return true;
    }
    return false;
  }

  function probeInstallDirExclusiveLock() {
    const asarPath = path.join(process.resourcesPath || path.join(path.dirname(process.execPath), 'resources'), 'app.asar');
    let asarExclusiveOk = null;
    let asarErr = null;
    const origNoAsar = process.noAsar;
    try {
      process.noAsar = true;
      const fd = fs.openSync(asarPath, fs.constants.O_RDWR);
      fs.closeSync(fd);
      asarExclusiveOk = true;
    } catch (e) {
      asarExclusiveOk = false;
      asarErr = e && e.message ? e.message : String(e);
    } finally {
      process.noAsar = origNoAsar;
    }
    return { asarPath, asarExclusiveOk, asarErr };
  }

  function enterRecoveryMode(state, details) {
    const disabledUntil = Date.now() + DISABLE_FOR_MS;
    loopDetected = true;
    updaterState = 'loop-blocked';
    setPersistedState({
      failedInstallCount: state.failedInstallCount,
      updaterDisabledUntil: disabledUntil,
      loopDetectedAt: Date.now(),
      lastError: details,
      lastStartupAt: Date.now(),
      lastVersion: app.getVersion(),
    });
    logger.error('Updater recovery mode entered:', details);
    try {
      dialog.showErrorBox(
        'Custody Note — update failed',
        'The update could not be installed automatically. Another program may be locking files in the Custody Note install folder (common with IDEs or antivirus).\n\n' +
          'Close other apps that might be scanning that folder, download the latest installer from the website, and run it. If it still fails, run the installer as Administrator.'
      );
    } catch (_) {}
  }

  function reconcileStartupState() {
    const persisted = getPersistedState();
    const currentVersion = app.getVersion();
    const pendingVersion = persisted.pendingUpdateVersion || persisted.pendingInstallVersion;
    const lastStartupAt = persisted.lastStartupAt || 0;

    logger.info(
      `APP START cycle=${cycleId} v=${currentVersion} stateFile=${getStatePath(app)} ` +
      `pending=${pendingVersion || 'none'} failed=${persisted.failedInstallCount || 0} ` +
      `packaged=${app.isPackaged} installPath=${process.execPath}`
    );

    if (pendingVersion && semverEq(pendingVersion, currentVersion)) {
      logger.info(`Version advanced to ${currentVersion}; clearing pending update state`);
      setPersistedState({
        pendingUpdateVersion: null,
        pendingInstallVersion: null,
        lastAppliedVersion: currentVersion,
        lastAppliedAt: Date.now(),
        failedInstallCount: 0,
        installAttemptedAt: null,
        lastCountedInstallAttemptAt: null,
        updateDownloadedAt: null,
        updaterDisabledUntil: null,
        lastError: null,
        lastStartupAt: Date.now(),
        lastVersion: currentVersion,
      });
      return;
    }

    if (pendingVersion && persisted.installAttemptedAt) {
      const attemptId = persisted.installAttemptedAt;
      const alreadyCounted = persisted.lastCountedInstallAttemptAt === attemptId;
      const newFailCount = alreadyCounted
        ? (persisted.failedInstallCount || 0)
        : (persisted.failedInstallCount || 0) + 1;
      const rapidRestart = lastStartupAt && (Date.now() - lastStartupAt < LOOP_WINDOW_MS);
      logger.warn(
        `Failed version transition expected=${pendingVersion} actual=${currentVersion} ` +
        `failedInstallCount=${newFailCount} rapidRestart=${!!rapidRestart} countedThisAttempt=${!alreadyCounted}`
      );

      const patch = {
        failedInstallCount: newFailCount,
        lastStartupAt: Date.now(),
        lastVersion: currentVersion,
        lastError: `Failed transition: expected ${pendingVersion} but still running ${currentVersion}`,
      };
      if (!alreadyCounted) {
        patch.lastCountedInstallAttemptAt = attemptId;
      }
      const nextState = setPersistedState(patch);

      if (newFailCount >= MAX_FAILED_INSTALLS || rapidRestart) {
        enterRecoveryMode(nextState, nextState.lastError);
      }
      return;
    }

    if (isUpdaterDisabled(persisted)) {
      loopDetected = true;
      updaterState = 'loop-blocked';
      logger.warn(`Updater disabled until ${new Date(persisted.updaterDisabledUntil).toISOString()}`);
    }

    setPersistedState({
      lastStartupAt: Date.now(),
      lastVersion: currentVersion,
    });
  }

  function prepareForInstall() {
    try { stopSyncTimer && stopSyncTimer(); } catch (_) {}
    try { stopBackupScheduler && stopBackupScheduler(); } catch (_) {}

    try {
      flushDbSync && flushDbSync();
      closeDb && closeDb();
      logger.info('DB flushed and closed before install');
    } catch (err) {
      logger.warn('DB close warning:', err && err.message ? err.message : err);
    }

    // CRITICAL: Do NOT destroy BrowserWindows here.
    // autoUpdater.quitAndInstall() spawns the NSIS installer as a detached
    // process, then calls app.quit() which closes windows via the standard
    // before-quit → will-quit → window-all-closed flow.
    // Destroying windows HERE triggers window-all-closed → app.quit() BEFORE
    // quitAndInstall() can spawn the installer — the installer never runs.
    // This race condition was the root cause of the v1.4.187 installer failure.
  }

  function installDownloadedUpdate(opts) {
    const options = opts || {};
    if (updaterState !== 'downloaded' || !downloadedVersion) {
      return { ok: false, error: 'No downloaded update is ready to install.' };
    }
    if (quitAndInstallCalled) {
      logger.warn('installDownloadedUpdate blocked: quitAndInstall already called');
      return { ok: false, error: 'Install already in progress.' };
    }

    quitAndInstallCalled = true;
    updaterState = 'installing';
    logger.info(`Installing version ${downloadedVersion} (cycle=${cycleId})`);
    sendStatus({ status: 'installing', version: downloadedVersion });
    setPersistedState({
      installAttemptedAt: Date.now(),
      pendingUpdateVersion: downloadedVersion,
      pendingInstallVersion: downloadedVersion,
      lastError: null,
    });

    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }

    prepareForInstall();

    const lockProbe = probeInstallDirExclusiveLock();
    logger.info(
      `Pre-quit lock probe: asarExclusiveOk=${lockProbe.asarExclusiveOk} path=${lockProbe.asarPath}` +
      (lockProbe.asarErr ? ` err=${lockProbe.asarErr}` : '')
    );
    const isSilent = !options.diagnostic;
    logger.info(
      `Invoking autoUpdater.quitAndInstall(isSilent=${isSilent}, isForceRunAfter=true) ` +
      '— installer will be spawned then app.exit(0) on nextTick'
    );
    try {
      autoUpdater.quitAndInstall(isSilent, true);
    } catch (err) {
      logger.error('quitAndInstall threw:', err && err.message ? err.message : err);
    }

    // quitAndInstall() spawns the detached NSIS process synchronously, then
    // requests a graceful quit. Use nextTick so the spawn completes, then
    // hard-exit to drop our file handles before the uninstall step runs.
    process.nextTick(() => {
      logger.info('app.exit(0) after quitAndInstall (nextTick) — releasing file handles for installer');
      app.exit(0);
    });

    return { ok: true };
  }

  function maybePromptReadyToInstall(version) {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update Ready',
      message: `Update v${version} is ready to install.`,
      detail: 'Custody Note needs to restart to apply the update.',
      buttons: ['Restart now', 'Later'],
      cancelId: 1,
      defaultId: 0,
    }).then((result) => {
      if (result.response === 0) {
        installDownloadedUpdate();
      }
    }).catch((err) => {
      logger.warn('Update-ready prompt failed:', err && err.message ? err.message : err);
    });
  }

  function scheduleRetryAfterFailure(source) {
    const delays = [30000, 60000, 180000];
    const idx = Math.min(Math.max(consecutiveFailures - 1, 0), delays.length - 1);
    const delay = delays[idx];
    setTimeout(() => {
      if (updaterState === 'idle' && !loopDetected) {
        checkForUpdates({ source: `${source}-retry`, force: true });
      }
    }, delay);
  }

  function registerListeners() {
    if (listenersRegistered) return;
    listenersRegistered = true;

    autoUpdater.on('checking-for-update', () => {
      updaterState = 'checking';
      logger.info('Event: checking-for-update');
    });

    autoUpdater.on('update-available', (info) => {
      updaterState = 'downloading';
      downloadedVersion = info && info.version ? info.version : null;
      consecutiveFailures = 0;
      logger.info(`Event: update-available target=${downloadedVersion || '?'}`);
      setPersistedState({
        pendingUpdateVersion: downloadedVersion,
        lastError: null,
      });
      sendStatus({ status: 'downloading', version: downloadedVersion });
    });

    autoUpdater.on('download-progress', (progress) => {
      if (progress && typeof progress.percent === 'number') {
        logger.info(`Event: download-progress ${progress.percent.toFixed(1)}%`);
        sendStatus({ status: 'downloading', percent: progress.percent, version: downloadedVersion });
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      downloadedVersion = info && info.version ? info.version : downloadedVersion;
      updaterState = 'downloaded';
      consecutiveFailures = 0;
      logger.info(`Event: update-downloaded target=${downloadedVersion || '?'}`);
      setPersistedState({
        pendingUpdateVersion: downloadedVersion,
        pendingInstallVersion: downloadedVersion,
        updateDownloadedAt: Date.now(),
        lastError: null,
      });
      sendStatus({ status: 'ready', version: downloadedVersion });
      maybePromptReadyToInstall(downloadedVersion);
    });

    autoUpdater.on('update-not-available', (info) => {
      updaterState = 'idle';
      consecutiveFailures = 0;
      const remoteVersion = info && info.version ? info.version : null;
      logger.info(`Event: update-not-available latest=${remoteVersion || '?'} current=${app.getVersion()}`);
      const cur = getPersistedState();
      const outstanding = hasOutstandingInstallFailure(cur);
      const basePatch = {
        lastRemoteVersion: remoteVersion,
        lastNoUpdateCheckAt: Date.now(),
        appVersionAtCheck: app.getVersion(),
      };
      if (outstanding) {
        logger.warn('update-not-available: preserving pending/failure state (outstanding install issue)');
        setPersistedState(basePatch);
      } else {
        setPersistedState(Object.assign({}, basePatch, {
          failedInstallCount: 0,
          pendingUpdateVersion: null,
          pendingInstallVersion: null,
          installAttemptedAt: null,
          updateDownloadedAt: null,
          updaterDisabledUntil: null,
          lastError: null,
          lastCountedInstallAttemptAt: null,
        }));
      }
      sendStatus({ status: 'up-to-date', version: app.getVersion(), remoteVersion });
    });

    autoUpdater.on('error', (err) => {
      updaterState = 'idle';
      consecutiveFailures += 1;
      const message = err && err.message ? err.message : String(err);
      logger.error('Event: error', message);
      setPersistedState({ lastError: message });
      sendStatus({ status: 'error', message });
      if (consecutiveFailures <= 3 && !loopDetected) {
        scheduleRetryAfterFailure('error-event');
      }
    });
  }

  async function checkForUpdates(opts) {
    const options = opts || {};
    const source = options.source || 'unspecified';
    const force = !!options.force;
    const persisted = getPersistedState();

    if (isUpdaterDisabled(persisted)) {
      loopDetected = true;
      updaterState = 'loop-blocked';
      logger.warn(`Check blocked because updater is disabled until ${new Date(persisted.updaterDisabledUntil).toISOString()}`);
      return {
        status: 'loop-blocked',
        message: 'The update could not be installed automatically. Please close the app and run the installer as Administrator.',
        currentVersion: app.getVersion(),
      };
    }

    if (loopDetected) {
      logger.warn(`Check blocked (loop-detected) source=${source}`);
      return {
        status: 'loop-blocked',
        message: 'The update could not be installed automatically. Please close the app and run the installer as Administrator.',
        currentVersion: app.getVersion(),
      };
    }

    if (updaterState === 'downloaded' && downloadedVersion) {
      return { status: 'ready', version: downloadedVersion, currentVersion: app.getVersion() };
    }
    if (updaterState === 'installing') {
      return { status: 'installing', version: downloadedVersion, currentVersion: app.getVersion() };
    }
    if (updaterState === 'checking' || updaterState === 'downloading') {
      return { status: updaterState, version: downloadedVersion, currentVersion: app.getVersion() };
    }

    const now = Date.now();
    if (!force && now - lastCheckTime < UPDATE_CHECK_COOLDOWN) {
      return { status: 'cooldown', currentVersion: app.getVersion() };
    }

    lastCheckTime = now;
    updaterState = 'checking';
    logger.info(`Calling checkForUpdates source=${source}`);

    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result) {
        updaterState = 'idle';
        return { status: 'error', message: 'Update check returned no result', currentVersion: app.getVersion() };
      }

      if (!result.isUpdateAvailable) {
        updaterState = 'idle';
        consecutiveFailures = 0;
        const remoteVersion = result.updateInfo && result.updateInfo.version;
        const cur = getPersistedState();
        const outstanding = hasOutstandingInstallFailure(cur);
        const basePatch = {
          lastRemoteVersion: remoteVersion,
          lastNoUpdateCheckAt: Date.now(),
          appVersionAtCheck: app.getVersion(),
        };
        if (outstanding) {
          logger.warn(`checkForUpdates: no remote update but outstanding pending/failure — keeping state source=${source}`);
          setPersistedState(basePatch);
        } else {
          setPersistedState(Object.assign({}, basePatch, {
            failedInstallCount: 0,
            pendingUpdateVersion: null,
            pendingInstallVersion: null,
            installAttemptedAt: null,
            updateDownloadedAt: null,
            updaterDisabledUntil: null,
            lastError: null,
            lastCountedInstallAttemptAt: null,
          }));
        }
        return { status: 'up-to-date', version: app.getVersion(), remoteVersion };
      }

      updaterState = 'downloading';
      downloadedVersion = result.updateInfo ? result.updateInfo.version : downloadedVersion;
      setPersistedState({
        pendingUpdateVersion: downloadedVersion,
        lastError: null,
      });
      sendStatus({ status: 'downloading', version: downloadedVersion });
      if (result.downloadPromise) {
        await result.downloadPromise;
      }
      return { status: 'ready', version: downloadedVersion, currentVersion: app.getVersion() };
    } catch (err) {
      updaterState = 'idle';
      consecutiveFailures += 1;
      const message = err && err.message ? err.message : String(err);
      logger.error(`checkForUpdates failed source=${source}: ${message}`);
      setPersistedState({ lastError: message });
      if (consecutiveFailures <= 3) {
        scheduleRetryAfterFailure(source);
      }
      return { status: 'error', message, currentVersion: app.getVersion() };
    }
  }

  function scheduleDeferredCheck(browserWindow) {
    if (!browserWindow || browserWindow.isDestroyed()) return;
    if (loopDetected) {
      browserWindow.webContents.once('did-finish-load', () => {
        sendStatus({
          status: 'loop-blocked',
          message: 'The update could not be installed automatically. Please close the app and run the installer as Administrator.',
        });
      });
      return;
    }
    browserWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        checkForUpdates({ source: 'startup-deferred', force: true });
      }, STARTUP_CHECK_DELAY_MS);
    });
  }

  function getPublicState() {
    return {
      state: updaterState,
      status: updaterState,
      downloadedVersion,
      currentVersion: app.getVersion(),
      lastCheckTime,
      consecutiveFailures,
      loopDetected,
      cycleId,
      persisted: getPersistedState(),
    };
  }

  function resetLoopState() {
    logger.info('User requested updater loop reset');
    loopDetected = false;
    updaterState = 'idle';
    quitAndInstallCalled = false;
    setPersistedState({
      failedInstallCount: 0,
      installAttemptedAt: null,
      lastCountedInstallAttemptAt: null,
      loopDetectedAt: null,
      pendingUpdateVersion: null,
      pendingInstallVersion: null,
      updaterDisabledUntil: null,
      lastError: null,
    });
    return { ok: true };
  }

  reconcileStartupState();
  registerListeners();
  intervalHandle = setInterval(() => {
    if (!loopDetected) {
      checkForUpdates({ source: 'interval-6h' });
    }
  }, UPDATE_CHECK_INTERVAL);

  logger.info('Updater initialized');

  return {
    isEnabled: true,
    scheduleDeferredCheck,
    checkForUpdates,
    installDownloadedUpdate,
    diagnosticInstall() {
      logger.info('Diagnostic (non-silent) install requested');
      return installDownloadedUpdate({ diagnostic: true });
    },
    getPublicState,
    resetLoopState,
    dispose() {
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
    },
  };
}

module.exports = {
  initUpdater,
  parseSemverTriple,
  semverEq,
  createNoopUpdaterController,
  constants: {
    MAX_FAILED_INSTALLS,
    LOOP_WINDOW_MS,
    UPDATE_CHECK_COOLDOWN,
    UPDATE_CHECK_INTERVAL,
    STARTUP_CHECK_DELAY_MS,
    DISABLE_FOR_MS,
  },
};
