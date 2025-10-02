import { app } from "/scripts/app.js";

// Small helper: find a widget by its name on a node
function findWidget(node, name) {
  if (!node?.widgets) return null;
  return node.widgets.find(w => w && w.name === name);
}

// Ensure a hidden text widget exists to carry selections back to Python
function ensureHiddenSelectedWidget(node, key) {
  // If a widget with this name already exists, reuse it
  let w = findWidget(node, key);
  if (w) return w;

  // Otherwise, add a hidden text widget (collapsed in UI)
  // type "text" is standard; we’ll hide its DOM row
  const defVal = "";
  const newW = node.addWidget("text", key, defVal, (value) => {}, { multiline: false });
  newW.inputEl = null;         // mark for our own tracking
  newW.hiddenByExtension = true;
  return newW;
}

// Create (or reuse) a container DIV right under a specific widget row
function getOrCreateBelowWidgetContainer(node, anchorWidget, blockId) {
  // For LiteGraph nodes, the settings panel is rebuilt frequently.
  // ComfyUI attaches DOM elements to widget.domEl; we can piggyback.
  if (!anchorWidget) return null;

  // If we've already made one for this block, reuse it
  if (!anchorWidget._triggerBoxes) anchorWidget._triggerBoxes = {};
  if (anchorWidget._triggerBoxes[blockId]) {
    // Make sure it still exists
    return anchorWidget._triggerBoxes[blockId];
  }

  // Try to locate the DOM row ComfyUI builds for this widget
  // ComfyUI injects a .domEl on widgets; if not present yet,
  // we will defer until the next onExecuted redraw.
  const row = anchorWidget.domEl || anchorWidget.element || anchorWidget.inputEl?.parentElement;
  if (!row || !row.parentElement) return null;

  const container = document.createElement("div");
  container.style.margin = "6px 0 4px 6px";
  container.style.padding = "6px 8px";
  container.style.border = "1px solid var(--comfy-input-border)";
  container.style.borderRadius = "6px";
  container.style.background = "var(--comfy-input-bg)";
  container.style.fontSize = "12px";
  container.dataset.blockId = blockId;

  row.parentElement.insertBefore(container, row.nextSibling);
  anchorWidget._triggerBoxes[blockId] = container;
  return container;
}

// Render checkbox group for triggers
function renderCheckboxes(node, container, blockKey, choices, selected, saveToKey) {
  container.innerHTML = "";
  if (!choices || choices.length === 0) {
    container.textContent = "No triggers available.";
    return;
  }

  // Header line
  const title = document.createElement("div");
  title.textContent = "Triggers";
  title.style.marginBottom = "4px";
  title.style.fontWeight = "600";
  container.appendChild(title);

  // Controls row (Select All / None)
  const buttons = document.createElement("div");
  buttons.style.marginBottom = "6px";
  const btnAll = document.createElement("button");
  btnAll.type = "button";
  btnAll.textContent = "All";
  btnAll.style.marginRight = "6px";
  const btnNone = document.createElement("button");
  btnNone.type = "button";
  btnNone.textContent = "None";
  buttons.appendChild(btnAll);
  buttons.appendChild(btnNone);
  container.appendChild(buttons);

  // List of checkboxes
  const list = document.createElement("div");
  container.appendChild(list);

  const current = new Set((selected || []).map(s => String(s)));

  function updateHidden() {
    const checked = Array.from(list.querySelectorAll('input[type="checkbox"]:checked'))
      .map(cb => cb.value);
    // write CSV to hidden widget so Python sees it
    const hiddenW = ensureHiddenSelectedWidget(node, saveToKey);
    hiddenW.value = checked.join(", ");
    // For visual debugging you can uncomment:
    // console.log("[LoraTriggerSelector] Saved", saveToKey, "=", hiddenW.value);
    node.setDirtyCanvas(true);
  }

  choices.forEach(tag => {
    const lab = document.createElement("label");
    lab.style.display = "block";
    lab.style.cursor = "pointer";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = String(tag);
    cb.checked = current.has(String(tag));
    cb.style.marginRight = "6px";

    cb.addEventListener("change", updateHidden);

    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(String(tag)));
    list.appendChild(lab);
  });

  btnAll.addEventListener("click", () => {
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    updateHidden();
  });
  btnNone.addEventListener("click", () => {
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateHidden();
  });

  // Initial write (in case defaults changed)
  updateHidden();
}

app.registerExtension({
  name: "LoraTriggerSelector",

  // Called when a node is created (dragged from menu)
  nodeCreated(node) {
    if (node.comfyClass !== "LoraStackTagSelector") return;

    // Hide any hidden widgets we create
    const origOnDrawForeground = node.onDrawForeground;
    node.onDrawForeground = function(ctx) {
      // Ensure our hidden widgets won't clutter the inspector
      if (this.widgets) {
        this.widgets.forEach(w => {
          if (w && w.hiddenByExtension && w.domEl && w.domEl.style) {
            w.domEl.style.display = "none";
          }
        });
      }
      if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);
    };

    // Re-render checkboxes each time the node executes
    node.onExecuted = (data) => {
      if (!data || !data.ui) return;

      // Expect blocks like:
      // "lora1_triggers": { anchor: "lora1_weight", choices: [...], selected: [...] }
      // If anchor is missing, we fallback to 'loraN_file'
      Object.entries(data.ui).forEach(([blockKey, block]) => {
        if (!block || (!block.choices && !block.selected)) return;

        let anchorName = block.anchor;
        if (!anchorName) {
          // try to infer anchor from key, e.g. lora3_triggers -> lora3_weight or lora3_file
          const m = /^lora(\d+)_/i.exec(blockKey);
          if (m) {
            const idx = m[1];
            anchorName = `lora${idx}_weight`;
            if (!findWidget(node, anchorName)) {
              anchorName = `lora${idx}_file`;
            }
          }
        }
        const anchorWidget = findWidget(node, anchorName);
        const container = getOrCreateBelowWidgetContainer(node, anchorWidget, blockKey);
        if (!container) return;

        const saveKey = blockKey.replace("_triggers", "_selected"); // e.g. lora3_selected
        renderCheckboxes(node, container, blockKey, block.choices || [], block.selected || [], saveKey);
      });
    };
  },

  // Dev helper: log when the extension loads
  async setup() {
    console.log("[LoraTriggerSelector] extension loaded");
  }
});
