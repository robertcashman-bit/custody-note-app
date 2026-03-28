/* ═══════════════════════════════════════════════════════
   DOCUMENTS SCREEN (Workflow Step 1)
   Upload, manage, and auto-rename attachments.
   Rendered inside #wf-body by workflow-stepper.js.
   Depends on: filenameUtils.js, workflow-stepper.js globals,
               app.js globals (formData, quietSave, renderPhotoThumbs)
   ═══════════════════════════════════════════════════════ */

function _wfRenderDocumentsStep(body, footer) {
  var meta = _wfMatterMeta();
  var data = meta.data;

  var attachments = _wfGetAttachments(data);

  var html =
    '<div class="wf-screen wf-documents">' +
      '<div class="wf-screen-header">' +
        '<h3>Documents</h3>' +
        '<p class="wf-screen-sub">Upload and standardise attendance files before billing.</p>' +
      '</div>' +

      '<div class="wf-card wf-upload-card">' +
        '<div class="wf-upload-area" id="wf-upload-dropzone">' +
          '<div class="wf-upload-icon">&#128196;</div>' +
          '<p class="wf-upload-text">Drag files here or click Add Files</p>' +
          '<button type="button" id="wf-add-files-btn" class="btn btn-primary">Add Files</button>' +
        '</div>' +
      '</div>' +

      '<div class="wf-card">' +
        '<h4 class="wf-card-title">Attachment List</h4>' +
        _wfBuildAttachmentTable(attachments, meta) +
      '</div>' +

      _wfBuildValidationPanel(attachments, meta) +
    '</div>';

  body.innerHTML = html;
  _wfBuildDocFooter(footer);
  _wfBindDocEvents(meta);
}

function _wfGetAttachments(data) {
  var attachments = [];
  if (data && data.photos && data.photos.attachments) {
    data.photos.attachments.forEach(function (att, i) {
      attachments.push({
        index: i,
        originalName: att.name || att.originalName || 'file_' + i,
        documentType: att.documentType || '',
        customDocumentType: att.customDocumentType || '',
        notes: att.notes || '',
        addedAt: att.addedAt || '',
        hasData: !!(att.dataUrl),
      });
    });
  }
  return attachments;
}

function _wfBuildAttachmentTable(attachments, meta) {
  if (!attachments.length) {
    return '<p class="wf-empty-state">No attachments yet. Use the upload area above to add files.</p>';
  }
  var html =
    '<div class="wf-table-wrap">' +
    '<table class="wf-table">' +
      '<thead><tr>' +
        '<th>Original file</th>' +
        '<th>Document type</th>' +
        '<th>Renamed preview</th>' +
        '<th>Actions</th>' +
      '</tr></thead><tbody>';

  attachments.forEach(function (att) {
    var typeOptions = '';
    DOCUMENT_TYPE_OPTIONS.forEach(function (opt) {
      var sel = opt.value === att.documentType ? ' selected' : '';
      typeOptions += '<option value="' + opt.value + '"' + sel + '>' + _wfEsc(opt.label) + '</option>';
    });
    if (!att.documentType) {
      typeOptions = '<option value="" selected>— Select —</option>' + typeOptions;
    }

    var renamed = '';
    if (att.documentType) {
      renamed = formatAttachmentFilename({
        clientName: meta.clientName,
        policeStation: meta.stationName,
        attendanceDate: meta.attendanceDate,
        documentType: att.documentType,
        customDocumentType: att.customDocumentType,
        firmName: meta.firmName,
        extension: _wfExtFromName(att.originalName),
      });
    }

    html += '<tr data-att-idx="' + att.index + '">' +
      '<td class="wf-att-original">' + _wfEsc(att.originalName) + '</td>' +
      '<td><select class="form-input wf-att-type" data-att-idx="' + att.index + '">' + typeOptions + '</select>' +
        (att.documentType === 'other' ? '<input type="text" class="form-input wf-att-custom-type" data-att-idx="' + att.index + '" placeholder="Custom type" value="' + _wfEsc(att.customDocumentType) + '">' : '') +
      '</td>' +
      '<td class="wf-att-renamed" data-att-idx="' + att.index + '">' +
        (renamed ? '<span class="wf-renamed-preview">' + _wfEsc(renamed) + '</span>' : '<span class="wf-no-rename">Select a type</span>') +
      '</td>' +
      '<td>' +
        '<button type="button" class="btn btn-small wf-att-remove" data-att-idx="' + att.index + '" title="Remove">&#10005;</button>' +
      '</td>' +
    '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function _wfExtFromName(name) {
  if (!name) return '.pdf';
  var dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '.pdf';
}

function _wfBuildValidationPanel(attachments, meta) {
  var warnings = [];
  if (!attachments.length) {
    warnings.push({ type: 'info', msg: 'No attachments uploaded — you can proceed to billing without them.' });
  }
  attachments.forEach(function (att) {
    if (!att.documentType) {
      warnings.push({ type: 'warn', msg: 'Attachment "' + att.originalName + '" has no document type selected.' });
    }
    if (att.documentType === 'other' && !att.customDocumentType) {
      warnings.push({ type: 'warn', msg: 'Attachment "' + att.originalName + '" is type "other" but has no custom label.' });
    }
  });

  var dupes = {};
  attachments.forEach(function (att) {
    if (att.documentType) {
      var key = att.documentType + (att.customDocumentType || '');
      dupes[key] = (dupes[key] || 0) + 1;
    }
  });
  Object.keys(dupes).forEach(function (key) {
    if (dupes[key] > 1) {
      warnings.push({ type: 'warn', msg: 'Duplicate document type: "' + key + '" appears ' + dupes[key] + ' times.' });
    }
  });

  if (!warnings.length) return '';

  var html = '<div class="wf-card wf-validation-panel">' +
    '<h4 class="wf-card-title">Validation</h4><ul class="wf-validation-list">';
  warnings.forEach(function (w) {
    var icon = w.type === 'warn' ? '&#9888;' : '&#8505;';
    html += '<li class="wf-validation-item wf-validation--' + w.type + '">' + icon + ' ' + _wfEsc(w.msg) + '</li>';
  });
  html += '</ul></div>';
  return html;
}

function _wfBuildDocFooter(footer) {
  footer.innerHTML =
    '<button type="button" id="wf-doc-back" class="btn btn-secondary">Close</button>' +
    '<button type="button" id="wf-doc-next" class="btn btn-primary">Next: Billing &#9654;</button>';

  document.getElementById('wf-doc-back').addEventListener('click', closeWorkflow);
  document.getElementById('wf-doc-next').addEventListener('click', _wfGoNext);
}

function _wfBindDocEvents(meta) {
  var addBtn = document.getElementById('wf-add-files-btn');
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      var picker = (window.api && window.api.pickFile) ? window.api.pickFile : null;
      if (!picker) { showToast('File picker not available', 'error'); return; }
      picker().then(function (result) {
        if (!result || result.error) { if (result && result.error) showToast(result.error, 'error'); return; }
        var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
        if (!data.photos) data.photos = {};
        if (!data.photos.attachments) data.photos.attachments = [];
        if (data.photos.attachments.length >= 20) {
          showToast('Maximum 20 attachments per record', 'error');
          return;
        }
        data.photos.attachments.push({
          dataUrl: result.dataUrl,
          name: result.name,
          mime: result.mime,
          documentType: '',
          customDocumentType: '',
          notes: '',
          addedAt: new Date().toISOString(),
        });
        if (typeof quietSave === 'function') quietSave();
        _wfRenderCurrentStep();
      });
    });
  }

  var dropzone = document.getElementById('wf-upload-dropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', function (e) { e.preventDefault(); dropzone.classList.add('wf-upload-drag'); });
    dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('wf-upload-drag'); });
    dropzone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropzone.classList.remove('wf-upload-drag');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        showToast('Drop upload is not yet available — use the Add Files button.', 'info');
      }
    });
  }

  document.querySelectorAll('.wf-att-type').forEach(function (sel) {
    sel.addEventListener('change', function () {
      var idx = parseInt(sel.getAttribute('data-att-idx'), 10);
      var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
      if (data.photos && data.photos.attachments && data.photos.attachments[idx]) {
        data.photos.attachments[idx].documentType = sel.value;
        if (sel.value !== 'other') data.photos.attachments[idx].customDocumentType = '';
        if (typeof quietSave === 'function') quietSave();
        _wfRenderCurrentStep();
      }
    });
  });

  document.querySelectorAll('.wf-att-custom-type').forEach(function (inp) {
    inp.addEventListener('input', function () {
      var idx = parseInt(inp.getAttribute('data-att-idx'), 10);
      var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
      if (data.photos && data.photos.attachments && data.photos.attachments[idx]) {
        data.photos.attachments[idx].customDocumentType = inp.value;
        if (typeof quietSave === 'function') quietSave();
        var renamedEl = document.querySelector('.wf-att-renamed[data-att-idx="' + idx + '"]');
        if (renamedEl) {
          var renamed = formatAttachmentFilename({
            clientName: meta.clientName, policeStation: meta.stationName,
            attendanceDate: meta.attendanceDate, documentType: 'other',
            customDocumentType: inp.value, firmName: meta.firmName,
            extension: _wfExtFromName(data.photos.attachments[idx].name || ''),
          });
          renamedEl.innerHTML = '<span class="wf-renamed-preview">' + _wfEsc(renamed) + '</span>';
        }
      }
    });
  });

  document.querySelectorAll('.wf-att-remove').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var idx = parseInt(btn.getAttribute('data-att-idx'), 10);
      var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
      if (data.photos && data.photos.attachments) {
        data.photos.attachments.splice(idx, 1);
        if (typeof quietSave === 'function') quietSave();
        _wfRenderCurrentStep();
      }
    });
  });
}
