'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfViewerApi', {
  getInit: () => ipcRenderer.invoke('pdf-viewer-init'),
  print: () => ipcRenderer.invoke('pdf-viewer-print'),
  saveAs: () => ipcRenderer.invoke('pdf-viewer-save-as'),
  email: () => ipcRenderer.invoke('pdf-viewer-email'),
  openExternal: () => ipcRenderer.invoke('pdf-viewer-open-external'),
  close: () => ipcRenderer.invoke('pdf-viewer-close'),
  testMetrics: () => ipcRenderer.invoke('pdf-viewer-test-metrics'),
  e2eInspectPane: () => ipcRenderer.invoke('pdf-viewer-e2e-inspect-pane'),
});
