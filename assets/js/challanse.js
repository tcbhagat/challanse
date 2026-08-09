(function () {
  "use strict";

  const workflow = document.querySelector("[data-cs-workflow]");
  const year = document.getElementById("cs-year");
  const pilotDialog = document.getElementById("cs-pilot-dialog");
  const sampleDialog = document.getElementById("cs-sample-dialog");
  const pilotForm = document.getElementById("cs-pilot-form");
  const formStatus = document.getElementById("cs-form-status");
  const runtimeConfig = window.ChallanSeConfig || {};
  let turnstileToken = "";
  let turnstileWidgetId = null;
  const sampleInvoices = Object.freeze({
    cement: { vendor: "Synthetic Cement Co", challan: "CH-1001", material: "OPC Cement", quantity: "25 BAG" },
    steel: { vendor: "Synthetic Steel Works", challan: "CH-1002", material: "TMT Steel", quantity: "250 KG" },
    sand: { vendor: "Synthetic Sand Supply", challan: "CH-1003", material: "M Sand", quantity: "12.50 TON" },
  });
  let selectedSampleId = "";

  if (year) {
    year.textContent = new Date().getFullYear();
  }

  function openPilotDialog() {
    if (!runtimeConfig.pilotRequestsEnabled) return;
    if (!pilotDialog) return;
    if (typeof pilotDialog.showModal === "function") pilotDialog.showModal();
    else pilotDialog.setAttribute("open", "");
    pilotDialog.querySelector("input")?.focus();
  }

  document.addEventListener("click", (event) => {
    const control = event.target.closest?.("[data-pilot-request]");
    if (!control) return;
    event.preventDefault();
    openPilotDialog();
  });

  function showSampleStep(step) {
    sampleDialog?.querySelectorAll("[data-sample-step]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-sample-step") !== step;
    });
  }

  function resetSampleSelection() {
    selectedSampleId = "";
    sampleDialog.querySelectorAll("[data-sample-id]").forEach((control) => control.setAttribute("aria-pressed", "false"));
    const viewControl = sampleDialog.querySelector("[data-sample-view]");
    if (viewControl) viewControl.disabled = true;
    showSampleStep("choose");
  }

  function openSampleDialog() {
    if (!sampleDialog) return;
    resetSampleSelection();
    if (typeof sampleDialog.showModal === "function") sampleDialog.showModal();
    else sampleDialog.setAttribute("open", "");
    sampleDialog.querySelector("[data-sample-id]")?.focus();
  }

  document.addEventListener("click", (event) => {
    const openControl = event.target.closest?.("[data-sample-demo]");
    if (openControl) {
      event.preventDefault();
      openSampleDialog();
      return;
    }
    if (event.target.closest?.("[data-sample-close]")) {
      sampleDialog?.close();
      return;
    }
    if (event.target.closest?.("[data-sample-reset]")) {
      resetSampleSelection();
      sampleDialog?.querySelector("[data-sample-id]")?.focus();
      return;
    }
    if (event.target.closest?.("[data-sample-view]")) {
      const sample = sampleInvoices[selectedSampleId];
      if (!sample || !sampleDialog) return;
      sampleDialog.querySelector("[data-sample-vendor]").textContent = sample.vendor;
      sampleDialog.querySelector("[data-sample-challan]").textContent = sample.challan;
      sampleDialog.querySelector("[data-sample-material]").textContent = sample.material;
      sampleDialog.querySelector("[data-sample-quantity]").textContent = sample.quantity;
      showSampleStep("result");
      sampleDialog.querySelector("[data-sample-reset]")?.focus();
      return;
    }
    const sampleControl = event.target.closest?.("[data-sample-id]");
    if (!sampleControl || !sampleDialog) return;
    selectedSampleId = sampleControl.getAttribute("data-sample-id") || "";
    sampleDialog.querySelectorAll("[data-sample-id]").forEach((control) => {
      control.setAttribute("aria-pressed", String(control === sampleControl));
    });
    const viewControl = sampleDialog.querySelector("[data-sample-view]");
    if (viewControl) viewControl.disabled = !sampleInvoices[selectedSampleId];
  });

  sampleDialog?.addEventListener("click", (event) => {
    if (event.target === sampleDialog) sampleDialog.close();
  });

  pilotDialog?.querySelector(".cs-dialog-close")?.addEventListener("click", () => pilotDialog.close());
  pilotDialog?.addEventListener("click", (event) => {
    if (event.target === pilotDialog) pilotDialog.close();
  });

  function renderTurnstile() {
    if (!runtimeConfig.pilotRequestsEnabled || !pilotForm || turnstileWidgetId !== null || !window.turnstile) return;
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

  window.turnstile?.ready?.(() => {
    renderTurnstile();
  });

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
    } catch (error) {
      console.warn("Pilot request failed:", error);
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
      panels[index].tabIndex = selected ? 0 : -1;
      panels[index].setAttribute("aria-hidden", String(!selected));
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

})();
