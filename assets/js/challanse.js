(function () {
  "use strict";

  const workflow = document.querySelector("[data-cs-workflow]");
  const year = document.getElementById("cs-year");
  const pilotDialog = document.getElementById("cs-pilot-dialog");
  const pilotForm = document.getElementById("cs-pilot-form");
  const formStatus = document.getElementById("cs-form-status");
  const runtimeConfig = window.ChallanSeConfig || {};
  let turnstileToken = "";
  let turnstileWidgetId = null;

  if (year) {
    year.textContent = new Date().getFullYear();
  }

  function openPilotDialog() {
    if (!pilotDialog) return;
    if (typeof pilotDialog.showModal === "function") pilotDialog.showModal();
    else pilotDialog.setAttribute("open", "");
    pilotDialog.querySelector("input")?.focus();
  }

  document.querySelectorAll("[data-pilot-request]").forEach((button) => {
    button.addEventListener("click", openPilotDialog);
  });

  pilotDialog?.querySelector(".cs-dialog-close")?.addEventListener("click", () => pilotDialog.close());
  pilotDialog?.addEventListener("click", (event) => {
    if (event.target === pilotDialog) pilotDialog.close();
  });

  function renderTurnstile() {
    if (!pilotForm || turnstileWidgetId !== null || !window.turnstile) return;
    if (!runtimeConfig.turnstileSiteKey || runtimeConfig.turnstileSiteKey.startsWith("__")) {
      if (formStatus) formStatus.textContent = "Pilot requests are not configured yet.";
      return;
    }
    turnstileWidgetId = window.turnstile.render("#cs-turnstile", {
      sitekey: runtimeConfig.turnstileSiteKey,
      callback(token) { turnstileToken = token; },
      "expired-callback"() { turnstileToken = ""; },
    });
  }

  const turnstileTimer = window.setInterval(() => {
    renderTurnstile();
    if (turnstileWidgetId !== null) window.clearInterval(turnstileTimer);
  }, 250);
  window.setTimeout(() => window.clearInterval(turnstileTimer), 10000);

  pilotForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!runtimeConfig.apiBaseUrl || runtimeConfig.apiBaseUrl.startsWith("__") || !turnstileToken) {
      if (formStatus) formStatus.textContent = "Complete the verification before sending.";
      return;
    }
    const submit = pilotForm.querySelector('[type="submit"]');
    submit.disabled = true;
    if (formStatus) formStatus.textContent = "Sending…";
    const data = new FormData(pilotForm);
    try {
      const response = await fetch(`${runtimeConfig.apiBaseUrl.replace(/\/$/, "")}/v1/pilot-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"), company: data.get("company"), email: data.get("email"),
          phone: data.get("phone"), message: data.get("message"), website: data.get("website"),
          turnstileToken,
        }),
      });
      if (!response.ok) throw new Error("request_failed");
      pilotForm.reset();
      if (formStatus) formStatus.textContent = "Request received. We will contact you about the one-site pilot.";
      if (turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
      turnstileToken = "";
    } catch {
      if (formStatus) formStatus.textContent = "Request could not be sent. Please try again.";
    } finally {
      submit.disabled = false;
    }
  });

  if (!workflow) {
    return;
  }

  const tabs = Array.from(workflow.querySelectorAll('[role="tab"]'));
  const panels = Array.from(workflow.querySelectorAll('[role="tabpanel"]'));

  function activateTab(nextIndex, moveFocus) {
    tabs.forEach((tab, index) => {
      const selected = index === nextIndex;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[index].hidden = !selected;
    });

    if (moveFocus) {
      tabs[nextIndex].focus();
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateTab(index, false));
    tab.addEventListener("keydown", (event) => {
      let nextIndex = index;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        nextIndex = (index + 1) % tabs.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = tabs.length - 1;
      } else {
        return;
      }

      event.preventDefault();
      activateTab(nextIndex, true);
    });
  });

  activateTab(0, false);

  /* ══════════════════════════════════════════════════════════════════
     INVOICE IMAGE UPLOAD LOOP
     Lets the user pick one image at a time, accumulate a queue,
     and submit all at once. No existing functionality is touched.
     ══════════════════════════════════════════════════════════════════ */
  const dropzone    = document.getElementById("cs-upload-dropzone");
  const fileInput   = document.getElementById("cs-upload-input");
  const queue       = document.getElementById("cs-upload-queue");
  const submitBar   = document.getElementById("cs-upload-submit-bar");
  const countEl     = document.getElementById("cs-upload-count");
  const submitBtn   = document.getElementById("cs-upload-submit");
  const previewImg  = document.getElementById("cs-upload-preview-img");
  const previewMeta = document.getElementById("cs-upload-preview-meta");
  const previewEmpty  = document.getElementById("cs-upload-preview-empty");
  const previewActive = document.getElementById("cs-upload-preview-active");

  /* Skip if the upload section does not exist on this page. */
  if (!dropzone || !fileInput || !queue) return;

  const uploadedFiles = [];   // each entry: { file, name, size, dataUrl }

  /* ── helpers ─────────────────────────────────────────────────── */
  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1_048_576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1_048_576).toFixed(1) + " MB";
  }

  function renderQueue() {
    queue.innerHTML = "";
    uploadedFiles.forEach(function (entry, index) {
      var li = document.createElement("li");
      li.className = "cs-upload__queue-item";

      var thumb = document.createElement("img");
      thumb.className = "cs-upload__queue-thumb";
      thumb.src = entry.dataUrl;
      thumb.alt = entry.name;
      li.appendChild(thumb);

      var info = document.createElement("div");
      var nameSpan = document.createElement("div");
      nameSpan.className = "cs-upload__queue-name";
      nameSpan.textContent = entry.name;
      info.appendChild(nameSpan);
      var sizeSpan = document.createElement("div");
      sizeSpan.className = "cs-upload__queue-size";
      sizeSpan.textContent = formatFileSize(entry.size);
      info.appendChild(sizeSpan);
      li.appendChild(info);

      var removeBtn = document.createElement("button");
      removeBtn.className = "cs-upload__queue-remove";
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", "Remove " + entry.name);
      removeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        uploadedFiles.splice(index, 1);
        renderQueue();
        updateSubmitBar();
        /* If the removed item was in preview, clear preview */
        if (previewImg && previewImg.src === entry.dataUrl) {
          showPreview(null);
        }
      });
      li.appendChild(removeBtn);

      /* Click on a queue item previews it */
      li.addEventListener("click", function () {
        showPreview(entry);
      });

      queue.appendChild(li);
    });

    /* If queue is empty, show preview-empty fallback */
    if (uploadedFiles.length === 0) {
      showPreview(null);
    }
  }

  function updateSubmitBar() {
    var count = uploadedFiles.length;
    countEl.textContent = count + " invoice" + (count !== 1 ? "s" : "") + " ready";
    submitBar.hidden = count === 0;
  }

  function showPreview(entry) {
    if (!previewImg || !previewEmpty || !previewActive || !previewMeta) return;
    if (!entry) {
      previewEmpty.hidden = false;
      previewActive.hidden = true;
      return;
    }
    previewEmpty.hidden = true;
    previewActive.hidden = false;
    previewImg.src = entry.dataUrl;
    previewImg.alt = entry.name;
    previewMeta.textContent = entry.name + "  ·  " + formatFileSize(entry.size);
  }

  /* ── open file picker on click / Enter / Space ───────────────── */
  function openFilePicker() {
    fileInput.value = "";
    fileInput.click();
  }
  dropzone.addEventListener("click", openFilePicker);
  dropzone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openFilePicker();
    }
  });

  /* ── handle file selection (one at a time) ───────────────────── */
  fileInput.addEventListener("change", function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;

    /* Validate image type */
    if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
      alert("Please select a PNG, JPEG, or WebP image.");
      return;
    }

    /* Validate size (max 10 MB) */
    if (file.size > 10_000_000) {
      alert("Image is too large. Maximum size is 10 MB.");
      return;
    }

    var reader = new FileReader();
    reader.addEventListener("load", function () {
      uploadedFiles.push({
        file: file,
        name: file.name,
        size: file.size,
        dataUrl: reader.result
      });

      renderQueue();
      updateSubmitBar();

      /* Auto-preview the newly added image */
      showPreview(uploadedFiles[uploadedFiles.length - 1]);

      /* Reset the file input so the user can pick the SAME file again
         if they want, or a different one — INFINITE LOOP */
      fileInput.value = "";
    });
    reader.readAsDataURL(file);
  });

  /* ── drag-and-drop support ───────────────────────────────────── */
  var dragCounter = 0;
  dropzone.addEventListener("dragenter", function (e) {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) dropzone.style.borderColor = "var(--cs-amber)";
  });
  dropzone.addEventListener("dragover", function (e) { e.preventDefault(); });
  dropzone.addEventListener("dragleave", function (e) {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) dropzone.style.borderColor = "";
  });
  dropzone.addEventListener("drop", function (e) {
    e.preventDefault();
    dragCounter = 0;
    dropzone.style.borderColor = "";
    var droppedFile = e.dataTransfer.files && e.dataTransfer.files[0];
    if (droppedFile) {
      /* Simulate picking the file through the file input */
      var dt = new DataTransfer();
      dt.items.add(droppedFile);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event("change"));
    }
  });

  /* ── submit all ───────────────────────────────────────────────── */
  submitBtn.addEventListener("click", function () {
    var count = uploadedFiles.length;
    if (count === 0) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Processing " + count + " invoice" + (count !== 1 ? "s" : "") + "…";

    /* Simulate a short async submission delay (real submission would hit an API) */
    setTimeout(function () {
      /* Clean up queue */
      uploadedFiles.length = 0;
      renderQueue();
      updateSubmitBar();
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit all invoices";

      /* Show the pilot request dialog so the user can follow up */
      openPilotDialog();

      /* Scroll to the dialog if it's off-screen */
      var dialog = document.getElementById("cs-pilot-dialog");
      if (dialog) dialog.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 800);
  });

  /* ── initial state ────────────────────────────────────────────── */
  renderQueue();
  updateSubmitBar();
})();
