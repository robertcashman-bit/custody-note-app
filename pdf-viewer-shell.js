'use strict';

(function () {
  var api = window.pdfViewerApi;
  if (!api) return;

  function bind(id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }

  api.getInit().then(function (info) {
    if (info && info.fileName) {
      var titleEl = document.getElementById('doc-title');
      if (titleEl) titleEl.textContent = info.fileName;
      if (info.title) document.title = info.title;
    }
  }).catch(function () { /* non-fatal */ });

  bind('btn-print', function () {
    api.print().catch(function () { /* main shows errors */ });
  });
  bind('btn-save', function () {
    api.saveAs().catch(function () { /* main shows errors */ });
  });
  bind('btn-email', function () {
    api.email().then(function (res) {
      if (res && res.error) window.alert('Email failed: ' + res.error);
    }).catch(function () { /* ignore */ });
  });
  bind('btn-external', function () {
    api.openExternal().catch(function () { /* main shows errors */ });
  });
  bind('btn-close', function () {
    api.close().catch(function () { /* ignore */ });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      api.close().catch(function () { /* ignore */ });
    }
  });
})();
