import * as vscode from 'vscode';
import * as debounce from 'lodash.debounce';
import * as output from '../ui/output';
import { executeCommand } from '../host';
import { COMMAND_UPLOAD, COMMAND_DELETEREMOTE } from '../constants';
import { isValidFile, fileDepth } from '../helper';
import logger from '../logger';

const watchers: {
  [x: string]: vscode.FileSystemWatcher;
} = {};

const uploadQueue = new Set<string>();
const deleteQueue = new Set<string>();

// less than 550 will not work
const ACTION_INTEVAL = 550;

function fileError(event, file, showErrorWindow = true) {
  return error => {
    logger.error(`${event} ${file}`, '\n', error.stack);
    if (showErrorWindow) {
      output.show();
    }
  };
}

function doUpload() {
  const files = Array.from(uploadQueue).sort((a, b) => fileDepth(b) - fileDepth(a));
  uploadQueue.clear();
  files.forEach(async file => {
    logger.info('[watcher]', `${file} updated`);
    try {
      await executeCommand(COMMAND_UPLOAD, vscode.Uri.file(file));
    } catch {
      fileError('upload', file);
    }
  });
}

function doDelete() {
  const files = Array.from(deleteQueue).sort((a, b) => fileDepth(b) - fileDepth(a));
  deleteQueue.clear();
  files.forEach(async file => {
    logger.info('[watcher]', `${file} removed`);
    try {
      await executeCommand(COMMAND_DELETEREMOTE, vscode.Uri.file(file));
    } catch {
      fileError(`delete ${file}'s remote`, false);
    }
  });
}

const debouncedUpload = debounce(doUpload, ACTION_INTEVAL, { leading: true, trailing: true });
const debouncedDelete = debounce(doDelete, ACTION_INTEVAL, { leading: true, trailing: true });

function uploadHandler(uri: vscode.Uri) {
  if (!isValidFile(uri)) {
    return;
  }

  uploadQueue.add(uri.fsPath);
  debouncedUpload();
}

function addWatcher(config, watcher) {
  watchers[config.context] = watcher;
}

function getWatcher(config) {
  return watchers[config.context];
}

function getWatcheres() {
  return Object.keys(watchers).map(key => watchers[key]);
}

export function createWatcher(config) {
  const watchConfig = config.watcher !== undefined ? config.watcher : {};

  let watcher = getWatcher(config);
  if (watcher) {
    // clear old watcher
    watcher.dispose();
  }

  const shouldAddListenser = watchConfig.autoUpload || watchConfig.autoDelete;
  // tslint:disable-next-line triple-equals
  if (watchConfig.files == false || !shouldAddListenser) {
    return;
  }

  watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(config.context, watchConfig.files),
    false,
    false,
    false
  );
  addWatcher(config, watcher);

  if (watchConfig.autoUpload) {
    watcher.onDidCreate(uploadHandler);
    watcher.onDidChange(uploadHandler);
  }

  if (watchConfig.autoDelete) {
    watcher.onDidDelete(uri => {
      if (!isValidFile(uri)) {
        return;
      }

      deleteQueue.add(uri.fsPath);
      debouncedDelete();
    });
  }
}

export function removeWatcher(config) {
  const watcher = getWatcher(config);
  if (watcher) {
    watcher.dispose();
    delete watchers[config.context];
  }
}

export function watchFiles(config) {
  const configs = [].concat(config);
  configs.forEach(createWatcher);
}

export function clearAllWatcher() {
  const disposable = vscode.Disposable.from(...getWatcheres());
  disposable.dispose();
}
