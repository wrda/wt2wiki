(function () {
  "use strict";

  const data = window.WT2_DATA || { recipes: [], items: {}, sourcesByItem: {} };
  const recipes = data.recipes || [];
  const items = data.items || {};
  const sourcesByItem = data.sourcesByItem || {};
  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const recipesByResult = new Map();
  const usageByItem = new Map();

  for (const recipe of recipes) {
    addToMapList(recipesByResult, recipe.result, recipe);
    for (const material of recipe.materials || []) {
      addToMapList(usageByItem, material.item, recipe);
    }
  }

  const state = {
    query: "",
    kind: "all",
    skill: "",
    current: null,
    history: [],
  };

  const els = {
    searchInput: document.getElementById("searchInput"),
    skillFilter: document.getElementById("skillFilter"),
    resultMeta: document.getElementById("resultMeta"),
    resultList: document.getElementById("resultList"),
    recipeKind: document.getElementById("recipeKind"),
    recipeTitle: document.getElementById("recipeTitle"),
    recipeDetails: document.getElementById("recipeDetails"),
    formulaBoard: document.getElementById("formulaBoard"),
    emptyInspector: document.getElementById("emptyInspector"),
    inspectorContent: document.getElementById("inspectorContent"),
    backButton: document.getElementById("backButton"),
    homeButton: document.getElementById("homeButton"),
    filterButtons: Array.from(document.querySelectorAll(".filter-button")),
  };

  initialize();

  function initialize() {
    hydrateSkillFilter();
    bindEvents();
    const firstRecipe = recipes.find((recipe) => recipe.kind === "craft") || recipes[0];
    if (firstRecipe) {
      navigate({ type: "recipe", id: firstRecipe.id }, true);
    }
    renderSearchResults();
  }

  function bindEvents() {
    els.searchInput.addEventListener("input", () => {
      state.query = els.searchInput.value.trim();
      renderSearchResults();
    });

    els.skillFilter.addEventListener("change", () => {
      state.skill = els.skillFilter.value;
      renderSearchResults();
    });

    for (const button of els.filterButtons) {
      button.addEventListener("click", () => {
        state.kind = button.dataset.kind || "all";
        els.filterButtons.forEach((item) => item.classList.toggle("is-active", item === button));
        renderSearchResults();
      });
    }

    els.backButton.addEventListener("click", () => {
      const previous = state.history.pop();
      if (previous) {
        navigate(previous, true);
      }
    });

    els.homeButton.addEventListener("click", () => {
      state.history = [];
      const firstRecipe = recipes.find((recipe) => recipe.kind === "craft") || recipes[0];
      if (firstRecipe) {
        navigate({ type: "recipe", id: firstRecipe.id });
      }
    });
  }

  function hydrateSkillFilter() {
    const skills = Array.from(new Set(recipes.map((recipe) => recipe.skill).filter(Boolean))).sort((a, b) => {
      return displaySkill(a).localeCompare(displaySkill(b));
    });

    for (const skill of skills) {
      const option = document.createElement("option");
      option.value = skill;
      option.textContent = displaySkill(skill);
      els.skillFilter.appendChild(option);
    }
  }

  function renderSearchResults() {
    const query = normalize(state.query);
    const filteredRecipes = recipes
      .filter((recipe) => state.kind === "all" || recipe.kind === state.kind)
      .filter((recipe) => !state.skill || recipe.skill === state.skill)
      .filter((recipe) => !query || recipeMatches(recipe, query))
      .sort(sortRecipes);

    const matchingItems = query.length >= 2
      ? Object.values(items)
        .filter((item) => itemMatches(item, query))
        .sort((a, b) => sortItemsForQuery(a, b, query))
        .slice(0, 35)
      : [];

    els.resultList.innerHTML = "";
    els.resultMeta.textContent = `${filteredRecipes.length} recipes` + (matchingItems.length ? `, ${matchingItems.length} matching items` : "");

    for (const item of matchingItems) {
      els.resultList.appendChild(renderResultItemRow(item));
    }

    for (const recipe of filteredRecipes.slice(0, 140)) {
      els.resultList.appendChild(renderResultRecipeRow(recipe));
    }

    if (!matchingItems.length && !filteredRecipes.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "No matches found. Try an internal item name such as IronIngot or an English item name.";
      els.resultList.appendChild(empty);
    }
  }

  function renderResultItemRow(item) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "result-row";
    if (state.current?.type === "item" && state.current.id === item.id) row.classList.add("is-active");
    row.appendChild(renderIcon(item.id));

    const body = document.createElement("span");
    const produces = recipesByResult.get(item.id)?.length || 0;
    const uses = usageByItem.get(item.id)?.length || 0;
    const sources = sourcesByItem[item.id]?.length || 0;
    body.innerHTML = `
      <span class="result-title" dir="auto">${escapeHtml(item.name)}</span>
      <span class="result-subtitle">Item · crafted by: ${produces} · used in: ${uses} · sources: ${sources}</span>
    `;
    row.appendChild(body);
    row.addEventListener("click", () => navigate({ type: "item", id: item.id }));
    return row;
  }

  function renderResultRecipeRow(recipe) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "result-row";
    if (state.current?.type === "recipe" && state.current.id === recipe.id) row.classList.add("is-active");
    row.appendChild(renderIcon(recipe.result));

    const body = document.createElement("span");
    const context = recipeContext(recipe);
    body.innerHTML = `
      <span class="result-title" dir="auto">${escapeHtml(itemName(recipe.result))}</span>
      <span class="result-subtitle">${recipeKindLabel(recipe.kind)} · ${escapeHtml(context)}${recipe.skill ? " · " + escapeHtml(displaySkill(recipe.skill)) : ""}</span>
    `;
    row.appendChild(body);
    row.addEventListener("click", () => navigate({ type: "recipe", id: recipe.id }));
    return row;
  }

  function navigate(next, replace) {
    if (!replace && state.current) {
      state.history.push(state.current);
      if (state.history.length > 50) state.history.shift();
    }
    state.current = next;

    if (next.type === "recipe") {
      renderRecipe(recipesById.get(next.id));
      const recipe = recipesById.get(next.id);
      if (recipe) renderItemInspector(recipe.result);
    } else if (next.type === "item") {
      renderItemRoute(next.id);
    }
    renderSearchResults();
  }

  function renderItemRoute(itemId) {
    renderItemInspector(itemId);
    const produced = recipesByResult.get(itemId) || [];
    if (produced.length) {
      renderRecipe(produced[0], itemId);
      return;
    }

    els.recipeKind.textContent = "Item";
    els.recipeTitle.textContent = itemName(itemId);
    els.recipeDetails.innerHTML = "";
    els.recipeDetails.appendChild(pill("No local craft/build/process recipe creates this item"));

    const board = document.createElement("div");
    board.className = "formula-flow";
    board.appendChild(renderItemTile(itemId, "", "result"));
    els.formulaBoard.innerHTML = "";
    els.formulaBoard.appendChild(board);
  }

  function renderRecipe(recipe, highlightedItem) {
    if (!recipe) return;

    els.recipeKind.textContent = recipeKindHeader(recipe.kind);
    els.recipeTitle.textContent = itemName(recipe.result);
    els.recipeDetails.innerHTML = "";
    els.recipeDetails.appendChild(pill(recipeContext(recipe)));
    if (recipe.processName) els.recipeDetails.appendChild(pill(`process: ${recipe.processName}`));
    if (recipe.stations?.length) els.recipeDetails.appendChild(pill(`station: ${stationNames(recipe).join(", ")}`));
    if (recipe.skill) els.recipeDetails.appendChild(pill(`${displaySkill(recipe.skill)} · level ${recipe.level || 0}`));
    if (recipe.timeMs) els.recipeDetails.appendChild(pill(`time ${formatTime(recipe.timeMs)}`));
    if (recipe.fuels?.length) els.recipeDetails.appendChild(pill(`fuel options: ${recipe.fuels.map(formatMaterialLabel).slice(0, 4).join(", ")}`));
    if (recipe.toolRequired) els.recipeDetails.appendChild(pill(`tool: ${itemName(recipe.toolRequired)}`));
    if (recipe.bonusesRequired?.length) {
      els.recipeDetails.appendChild(pill(`station/requirement: ${recipe.bonusesRequired.map(itemName).join(", ")}`));
    }
    if (recipe.hidden) els.recipeDetails.appendChild(pill("Hidden"));
    if (recipe.purchaseLock) els.recipeDetails.appendChild(pill("Purchase lock"));

    const flow = document.createElement("div");
    flow.className = "formula-flow";
    const materials = recipe.materials || [];

    materials.forEach((material, index) => {
      if (index > 0) flow.appendChild(symbol("+"));
      const tile = renderItemTile(material.item, formatAmount(material), "material");
      if (material.item === highlightedItem) tile.classList.add("is-active");
      flow.appendChild(tile);
    });

    if (materials.length) flow.appendChild(symbol("→"));
    flow.appendChild(renderItemTile(recipe.result, recipe.amount > 1 ? recipe.amount : "", "result"));

    els.formulaBoard.innerHTML = "";
    els.formulaBoard.appendChild(flow);
  }

  function renderItemInspector(itemId) {
    const item = itemRecord(itemId);
    const produced = recipesByResult.get(itemId) || [];
    const used = usageByItem.get(itemId) || [];
    const sources = sourcesByItem[itemId] || [];

    els.emptyInspector.classList.add("is-hidden");
    els.inspectorContent.classList.remove("is-hidden");
    els.inspectorContent.innerHTML = "";

    const head = document.createElement("div");
    head.className = "item-head";
    head.appendChild(renderIcon(itemId, "large"));
    const title = document.createElement("div");
    title.innerHTML = `
      <h2 dir="auto">${escapeHtml(item.name)}</h2>
      <p>${escapeHtml(item.id)}</p>
    `;
    head.appendChild(title);
    els.inspectorContent.appendChild(head);

    if (item.description) {
      const block = sectionBlock("Description");
      const note = document.createElement("div");
      note.className = "empty-note";
      note.textContent = item.description;
      block.appendChild(note);
      els.inspectorContent.appendChild(block);
    }

    const panels = document.createElement("div");
    panels.className = "inspector-panels";
    panels.appendChild(recipeListBlock("Recipes that create this item", produced, { showIcons: true }));
    panels.appendChild(recipeListBlock("Used in recipes", used, { showIcons: true }));
    panels.appendChild(sourceListBlock("Known sources", sources));
    els.inspectorContent.appendChild(panels);

    if (!produced.length && !used.length && !sources.length) {
      const block = sectionBlock("Note", 0);
      const note = document.createElement("div");
      note.className = "empty-note";
      note.textContent = "No clear source was found in the local recipe or drop files. It may come from gathering, a shop, a quest, an NPC, or server-side data.";
      block.appendChild(note);
      els.inspectorContent.appendChild(block);
    }
  }

  function recipeListBlock(title, list, options = {}) {
    const block = sectionBlock(title, list.length);
    const wrap = document.createElement("div");
    wrap.className = "mini-list";
    const limited = list.slice(0, 60);

    for (const recipe of limited) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "mini-row";
      if (options.showIcons) {
        row.classList.add("has-icon");
        row.appendChild(renderIcon(recipe.result));
      }

      const body = document.createElement("span");
      body.className = "mini-body";
      body.innerHTML = `
        <span class="mini-title" dir="auto">${escapeHtml(itemName(recipe.result))}</span>
        <span class="mini-subtitle">${recipeKindLabel(recipe.kind)} · ${escapeHtml(recipeContext(recipe))}${recipe.skill ? " · " + escapeHtml(displaySkill(recipe.skill)) : ""}</span>
      `;
      row.appendChild(body);
      row.addEventListener("click", () => navigate({ type: "recipe", id: recipe.id }));
      wrap.appendChild(row);
    }

    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "None found in the local data.";
      wrap.appendChild(empty);
    } else if (list.length > limited.length) {
      const more = document.createElement("div");
      more.className = "empty-note";
      more.textContent = `Showing the first ${limited.length} of ${list.length}. Use search to narrow the list.`;
      wrap.appendChild(more);
    }

    block.appendChild(wrap);
    return block;
  }

  function sourceListBlock(title, list) {
    const block = sectionBlock(title, list.length);
    const wrap = document.createElement("div");
    wrap.className = "mini-list";
    const sorted = list.slice().sort(sortSources);
    const limited = sorted.slice(0, 80);

    for (const source of limited) {
      const row = document.createElement("div");
      row.className = "source-row";
      const metaLines = sourceMetaLines(source);
      row.innerHTML = `
        <div class="source-top">
          <span dir="auto">${escapeHtml(sourceTitle(source))}</span>
          <span>${escapeHtml(source.kind || "Source")}</span>
        </div>
        ${metaLines.map((line) => `<div class="source-meta">${escapeHtml(line)}</div>`).join("")}
      `;
      wrap.appendChild(row);
    }

    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "No clear source found in the local data.";
      wrap.appendChild(empty);
    } else if (list.length > limited.length) {
      const more = document.createElement("div");
      more.className = "empty-note";
      more.textContent = `Showing the first ${limited.length} sources of ${list.length}.`;
      wrap.appendChild(more);
    }

    block.appendChild(wrap);
    return block;
  }

  function sourceTitle(source) {
    return source.sourceDisplay || source.worldTypesDisplay || source.source || "Unknown source";
  }

  function sourceMetaLines(source) {
    const lines = [];
    const action = source.skillDisplay || source.skill;
    if (action || source.level) {
      lines.push(`action: ${action || source.kind}${source.level ? ` · level ${source.level}` : ""}`);
    }
    if (source.requiredItemsDisplay?.length) {
      lines.push(`requires: ${source.requiredItemsDisplay.join(", ")}`);
    }
    const location = source.worldTypesDisplay || source.worldTypes || "";
    if (location && normalize(location) !== normalize(sourceTitle(source))) {
      lines.push(`object: ${location}`);
    }
    lines.push(`amount: ${source.amount || "?"} · chance: ${source.chance || "unknown"}`);
    return lines;
  }

  function sortSources(a, b) {
    const priority = sourcePriority(a) - sourcePriority(b);
    if (priority) return priority;
    const level = sourceLevel(a) - sourceLevel(b);
    if (level) return level;
    const name = sourceTitle(a).localeCompare(sourceTitle(b));
    if (name) return name;
    return String(a.amount || "").localeCompare(String(b.amount || ""));
  }

  function sourceLevel(source) {
    const value = Number(source.level);
    return Number.isFinite(value) && value > 0 ? value : 9999;
  }

  function sourcePriority(source) {
    const kind = normalize(source.kind);
    if (kind === "skinning") return 0;
    if (kind === "butchering") return 1;
    if (kind === "mining" || kind === "lumberjacking" || kind === "gathering") return 2;
    if (kind === "drop") return 3;
    if (kind === "gift") return 4;
    return 5;
  }

  function sectionBlock(title, count) {
    const block = document.createElement("section");
    block.className = "section-block";
    const heading = document.createElement("h3");
    heading.className = "section-title";
    heading.innerHTML = count == null
      ? `<span>${escapeHtml(title)}</span>`
      : `<span>${escapeHtml(title)}</span><span class="count-chip">${count}</span>`;
    block.appendChild(heading);
    return block;
  }

  function renderItemTile(itemId, amount, role) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `item-tile ${role || ""}`;
    button.title = `${itemName(itemId)} (${itemId})`;
    button.appendChild(renderIcon(itemId));
    if (amount) {
      const badge = document.createElement("span");
      badge.className = "amount-badge";
      badge.textContent = amount;
      button.appendChild(badge);
    }
    const label = document.createElement("span");
    label.className = "item-label";
    label.dir = "auto";
    label.textContent = itemName(itemId);
    button.appendChild(label);
    button.addEventListener("click", () => navigate({ type: "item", id: itemId }));
    return button;
  }

  function renderIcon(itemId, size) {
    const item = itemRecord(itemId);
    const icon = document.createElement("span");
    icon.className = "item-icon";
    if (size === "large") {
      icon.style.width = "64px";
      icon.style.height = "64px";
    }

    if (item.icon) {
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.src = item.icon;
      icon.appendChild(img);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "fallback-icon";
      fallback.textContent = initials(item.name || item.id);
      icon.appendChild(fallback);
    }
    return icon;
  }

  function symbol(value) {
    const span = document.createElement("span");
    span.className = "flow-symbol";
    span.textContent = value;
    return span;
  }

  function pill(text) {
    const span = document.createElement("span");
    span.className = "pill";
    span.textContent = text;
    return span;
  }

  function recipeMatches(recipe, query) {
    if (normalize(recipe.result).includes(query)) return true;
    if (normalize(itemName(recipe.result)).includes(query)) return true;
    if (normalize(recipe.folder).includes(query)) return true;
    if (normalize(recipe.processName).includes(query)) return true;
    if (normalize(recipe.skill).includes(query) || normalize(displaySkill(recipe.skill)).includes(query)) return true;
    if ((recipe.stations || []).some((station) => {
      return normalize(station.name).includes(query) || normalize(itemName(station.name)).includes(query);
    })) return true;
    if ((recipe.fuels || []).some((fuel) => {
      return normalize(fuel.item).includes(query) || normalize(itemName(fuel.item)).includes(query);
    })) return true;
    return (recipe.materials || []).some((material) => {
      return normalize(material.item).includes(query) || normalize(itemName(material.item)).includes(query);
    });
  }

  function itemMatches(item, query) {
    return normalize(item.id).includes(query) ||
      normalize(item.name).includes(query) ||
      normalize(item.description || "").includes(query);
  }

  function sortRecipes(a, b) {
    const aName = itemName(a.result);
    const bName = itemName(b.result);
    return aName.localeCompare(bName);
  }

  function sortItemsForQuery(a, b, query) {
    const score = itemSearchScore(a, query) - itemSearchScore(b, query);
    if (score) return score;
    return a.name.localeCompare(b.name);
  }

  function itemSearchScore(item, query) {
    const name = normalize(item.name);
    const id = normalize(item.id);
    if (name === query || id === query) return 0;
    if (name.startsWith(query) || id.startsWith(query)) return 1;
    if (name.includes(query)) return 2;
    if (id.includes(query)) return 3;
    if (normalize(item.description).includes(query)) return 4;
    return 5;
  }

  function itemRecord(itemId) {
    return items[itemId] || { id: itemId, name: itemId, description: "", icon: "" };
  }

  function itemName(itemId) {
    return itemRecord(itemId).name || itemId;
  }

  function displaySkill(skill) {
    if (!skill) return "";
    return data.skills?.[skill] || skill;
  }

  function recipeKindLabel(kind) {
    if (kind === "build") return "Build";
    if (kind === "process") return "Process";
    return "Craft";
  }

  function recipeKindHeader(kind) {
    if (kind === "build") return "Build recipe";
    if (kind === "process") return "Process recipe";
    return "Craft recipe";
  }

  function recipeContext(recipe) {
    if (recipe.kind === "process" && recipe.stations?.length) {
      return stationNames(recipe).join(", ");
    }
    return recipe.folder || "General";
  }

  function stationNames(recipe) {
    return (recipe.stations || [])
      .map((station) => station.name)
      .filter(Boolean)
      .map(itemName);
  }

  function formatMaterialLabel(material) {
    const amount = formatAmount(material);
    return amount ? `${itemName(material.item)} x${amount}` : itemName(material.item);
  }

  function formatAmount(material) {
    if (!material) return "";
    if (material.amountMax && material.amountMax !== material.amount) {
      return `${material.amount}-${material.amountMax}`;
    }
    return material.amount && material.amount !== 1 ? String(material.amount) : "";
  }

  function formatTime(ms) {
    const seconds = Math.round(Number(ms) / 1000);
    if (!Number.isFinite(seconds) || seconds <= 0) return "";
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  }

  function initials(value) {
    const words = String(value || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .split(/[\s_-]+/)
      .filter(Boolean);
    if (!words.length) return "?";
    return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  }

  function normalize(value) {
    return String(value || "").toLocaleLowerCase();
  }

  function addToMapList(map, key, value) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
