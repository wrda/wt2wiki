(function () {
  "use strict";

  const data = window.WT2_DATA || { recipes: [], items: {}, sourcesByItem: {} };
  const wikiData = window.WT2_WIKI_DATA || { entries: [], importedPages: [], stats: {}, sources: [] };
  const recipes = data.recipes || [];
  const items = data.items || {};
  const sourcesByItem = data.sourcesByItem || {};
  const wikiEntries = wikiData.entries || [];
  const itemEconomy = wikiData.itemEconomy || {};
  const shopsByItem = wikiData.shopsByItem || {};
  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const wikiEntriesById = new Map(wikiEntries.map((entry) => [entry.id, entry]));
  const mapEntriesByLookup = new Map();
  const recipesByResult = new Map();
  const usageByItem = new Map();

  for (const entry of wikiEntries) {
    if (entry.type !== "area") continue;
    const regionKeys = (entry.regions || []).flatMap((region) => [region.name, region.localId, region.sourceName]);
    for (const key of [entry.id, entry.localId, entry.name, ...(entry.regionAliases || []), ...regionKeys]) {
      const normalized = normalize(key);
      if (normalized) mapEntriesByLookup.set(normalized, entry);
    }
  }

  for (const recipe of recipes) {
    addToMapList(recipesByResult, recipe.result, recipe);
    for (const material of recipe.materials || []) {
      addToMapList(usageByItem, material.item, recipe);
    }
  }

  const state = {
    mode: "recipes",
    query: "",
    kind: "all",
    wikiKind: "all",
    current: null,
    history: [],
  };

  const els = {
    searchInput: document.getElementById("searchInput"),
    recipeFilters: document.getElementById("recipeFilters"),
    wikiFilters: document.getElementById("wikiFilters"),
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
    modeButtons: Array.from(document.querySelectorAll(".mode-button")),
    filterButtons: Array.from(document.querySelectorAll(".filter-button")),
    wikiFilterButtons: Array.from(document.querySelectorAll(".wiki-filter-button")),
  };

  initialize();

  function initialize() {
    bindEvents();
    syncModeChrome();
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

    for (const button of els.filterButtons) {
      button.addEventListener("click", () => {
        setUnifiedFilter(button.dataset.kind || "all");
      });
    }

    for (const button of els.wikiFilterButtons) {
      button.addEventListener("click", () => {
        setUnifiedFilter(button.dataset.wikiKind || "all");
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

  function syncModeChrome() {
    els.recipeFilters.classList.remove("is-hidden");
    els.wikiFilters.classList.remove("is-hidden");
    els.searchInput.placeholder = "Item, recipe, monster, map, NPC shop...";
    syncUnifiedFilterButtons();
  }

  function setUnifiedFilter(filter) {
    state.kind = filter || "all";
    state.wikiKind = wikiFilterTypes().has(state.kind) ? state.kind : "all";
    syncUnifiedFilterButtons();
    renderSearchResults();
  }

  function syncUnifiedFilterButtons() {
    els.filterButtons.forEach((button) => {
      button.classList.toggle("is-active", (button.dataset.kind || "all") === state.kind);
    });
    els.wikiFilterButtons.forEach((button) => {
      button.classList.toggle("is-active", (button.dataset.wikiKind || "all") === state.kind);
    });
  }

  function activateWikiKind(kind, options = {}) {
    state.mode = "wiki";
    state.kind = kind || "all";
    state.wikiKind = wikiFilterTypes().has(state.kind) ? state.kind : "all";
    if (options.clearQuery) {
      state.query = "";
      els.searchInput.value = "";
    }
    syncModeChrome();
    renderSearchResults();
  }

  function renderSearchResults() {
    const query = normalize(state.query);
    const filter = state.kind || "all";
    const includeItems = filter === "all" || filter === "items";
    const includeRecipes = filter === "all" || recipeFilterTypes().has(filter);
    const includeWiki = filter === "all" || wikiFilterTypes().has(filter);

    const filteredRecipes = includeRecipes ? recipes
      .filter((recipe) => filter === "all" || filter === "items" || recipe.kind === filter)
      .filter((recipe) => !query || recipeMatches(recipe, query))
      .sort(sortRecipes) : [];

    const allMatchingItems = includeItems && (query.length >= 2 || filter === "items")
      ? Object.values(items)
        .filter((item) => itemMatches(item, query))
        .sort((a, b) => sortItemsForQuery(a, b, query))
      : [];

    const filteredWiki = includeWiki ? wikiEntries
      .filter(isPublicWikiEntry)
      .filter((entry) => filter === "all" || entry.type === filter)
      .filter((entry) => !query || wikiEntryMatches(entry, query))
      .sort(sortWikiEntries) : [];

    const matchingItems = allMatchingItems.slice(0, filter === "items" ? 160 : 35);
    const recipeLimit = filter === "all" ? 95 : 160;
    const wikiLimit = filter === "all" ? 95 : 180;

    els.resultList.innerHTML = "";
    els.resultMeta.textContent = [
      includeItems ? `${allMatchingItems.length} items` : "",
      includeRecipes ? `${filteredRecipes.length} recipes` : "",
      includeWiki ? `${filteredWiki.length} wiki entries` : "",
    ].filter(Boolean).join(", ");

    for (const item of matchingItems) {
      els.resultList.appendChild(renderResultItemRow(item));
    }

    for (const recipe of filteredRecipes.slice(0, recipeLimit)) {
      els.resultList.appendChild(renderResultRecipeRow(recipe));
    }

    for (const entry of filteredWiki.slice(0, wikiLimit)) {
      els.resultList.appendChild(renderWikiResultRow(entry));
    }

    if (!matchingItems.length && !filteredRecipes.length && !filteredWiki.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "No matches found. Try an English item name, monster, map, NPC shop, or internal item name such as IronIngot.";
      els.resultList.appendChild(empty);
    } else if (
      allMatchingItems.length > matchingItems.length ||
      filteredRecipes.length > recipeLimit ||
      filteredWiki.length > wikiLimit
    ) {
      const more = document.createElement("div");
      more.className = "empty-note";
      more.textContent = "Showing the first matches. Use search or filters to narrow the list.";
      els.resultList.appendChild(more);
    }
  }

  function renderWikiSearchResults() {
    const query = normalize(state.query);
    const filtered = wikiEntries
      .filter(isPublicWikiEntry)
      .filter((entry) => state.wikiKind === "all" || entry.type === state.wikiKind)
      .filter((entry) => !query || wikiEntryMatches(entry, query))
      .sort(sortWikiEntries)
      .slice(0, 180);

    const totalMatches = wikiEntries
      .filter(isPublicWikiEntry)
      .filter((entry) => state.wikiKind === "all" || entry.type === state.wikiKind)
      .filter((entry) => !query || wikiEntryMatches(entry, query)).length;

    els.resultList.innerHTML = "";
    els.resultMeta.textContent = `${totalMatches} wiki entries` + (totalMatches > filtered.length ? `, showing ${filtered.length}` : "");

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "No wiki entries matched. Try Bear, Main Land Forest, Alburnus, Skinning, or Fishing.";
      els.resultList.appendChild(empty);
      return;
    }

    for (const entry of filtered) {
      els.resultList.appendChild(renderWikiResultRow(entry));
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
    const shops = shopsByItem[item.id]?.length || 0;
    body.innerHTML = `
      <span class="result-title" dir="auto">${escapeHtml(item.name)}</span>
      <span class="result-subtitle">Item · crafted by: ${produces} · used in: ${uses} · sources: ${sources} · shops: ${shops}</span>
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

  function renderWikiResultRow(entry) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "result-row";
    if (state.current?.type === "wiki" && state.current.id === entry.id) row.classList.add("is-active");
    row.appendChild(renderWikiIcon(entry));

    const body = document.createElement("span");
    body.innerHTML = `
      <span class="result-title" dir="auto">${escapeHtml(entry.name)}</span>
      <span class="result-subtitle">${escapeHtml(wikiTypeLabel(entry.type))} · ${escapeHtml(publicSummary(entry))}</span>
      <span class="result-badge">${hasImportedSummary(entry) ? "Wiki summary" : "Game data"}</span>
    `;
    row.appendChild(body);
    row.addEventListener("click", () => navigate({ type: "wiki", id: entry.id }));
    return row;
  }

  function navigate(next, replace) {
    if (!replace && state.current) {
      state.history.push(state.current);
      if (state.history.length > 50) state.history.shift();
    }
    state.current = next;

    if (next.type === "recipe") {
      state.mode = "recipes";
      setActiveModeButton();
      syncModeChrome();
      renderRecipe(recipesById.get(next.id));
      const recipe = recipesById.get(next.id);
      if (recipe) renderItemInspector(recipe.result);
    } else if (next.type === "item") {
      state.mode = "recipes";
      setActiveModeButton();
      syncModeChrome();
      renderItemRoute(next.id);
    } else if (next.type === "wiki") {
      state.mode = "wiki";
      setActiveModeButton();
      syncModeChrome();
      renderWikiEntry(wikiEntriesById.get(next.id));
    }
    renderSearchResults();
  }

  function setActiveModeButton() {
    els.modeButtons.forEach((button) => {
      button.classList.toggle("is-active", (button.dataset.mode || "recipes") === state.mode);
    });
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

  function renderWikiEntry(entry) {
    if (!entry) return;

    els.recipeKind.textContent = wikiTypeLabel(entry.type);
    els.recipeTitle.textContent = entry.name;
    els.recipeDetails.innerHTML = "";
    els.recipeDetails.appendChild(pill(wikiTypeLabel(entry.type)));
    if (hasImportedSummary(entry)) els.recipeDetails.appendChild(pill("wiki summary included"));

    const article = document.createElement("div");
    article.className = "wiki-article";

    const imported = entry.externalInfo;
    if (imported?.extract) {
      article.appendChild(renderImportedInfoBlock(imported));
    }

    if (entry.type === "area" && entry.image) {
      article.appendChild(renderWikiMapImage(entry));
    }

    const leadText = entry.description ? cleanupPublicText(entry.description) : publicSummary(entry);
    if (leadText) {
      const lead = document.createElement("p");
      lead.className = "wiki-lead";
      lead.textContent = leadText;
      article.appendChild(lead);
    }

    if (entry.type === "skill") {
      const overview = renderSkillOverview(entry);
      if (overview) article.appendChild(overview);
    }

    const statBlock = renderWikiStats(publicStats(entry));
    if (statBlock) article.appendChild(statBlock);

    if (entry.type === "skill") {
      const bonusesBlock = renderSkillBonuses(entry);
      if (bonusesBlock) article.appendChild(bonusesBlock);
      const abilitiesBlock = renderSkillAbilities(entry);
      if (abilitiesBlock) article.appendChild(abilitiesBlock);
    }

    if (entry.type === "area") {
      const mapRegions = renderMapRegions(entry);
      if (mapRegions) article.appendChild(mapRegions);
      const mapFish = renderMapFishGrid(entry.fish);
      if (mapFish) article.appendChild(mapFish);
      const mapMonsters = renderMapEntityGrid("Monsters", entry.monsters, "creature");
      if (mapMonsters) article.appendChild(mapMonsters);
      const mapNpcs = renderMapEntityGrid("NPCs", entry.npcs, "shop");
      if (mapNpcs) article.appendChild(mapNpcs);
    }

    if (entry.type === "creature") {
      const abilitiesBlock = renderMonsterAbilities(entry);
      if (abilitiesBlock) article.appendChild(abilitiesBlock);
      const dropsBlock = renderMonsterDrops(entry);
      if (dropsBlock) article.appendChild(dropsBlock);
    }

    for (const list of entry.lists || []) {
      const block = sectionBlock(list.title);
      const chips = document.createElement("div");
      chips.className = "wiki-list";
      for (const item of (list.items || []).slice(0, 80)) {
        chips.appendChild(renderWikiListChip(entry, list, item));
      }
      block.appendChild(chips);
      article.appendChild(block);
    }

    for (const table of entry.tables || []) {
      article.appendChild(renderWikiTable(table));
    }

    if (entry.itemId && items[entry.itemId]) {
      const block = sectionBlock("Related item");
      const related = document.createElement("div");
      related.className = "formula-flow";
      related.appendChild(renderItemTile(entry.itemId, "", "result"));
      block.appendChild(related);
      article.appendChild(block);
    }

    els.formulaBoard.innerHTML = "";
    els.formulaBoard.appendChild(article);

    if (entry.itemId && items[entry.itemId]) {
      renderItemInspector(entry.itemId);
    } else {
      renderWikiInspector(entry);
    }
  }

  function renderWikiMapImage(entry) {
    const block = sectionBlock("Map image");
    const figure = document.createElement("figure");
    figure.className = "wiki-map-preview";

    const img = document.createElement("img");
    img.src = entry.image;
    img.alt = entry.name;
    figure.appendChild(img);

    const caption = document.createElement("figcaption");
    caption.textContent = "In-game map image from local game files";
    figure.appendChild(caption);

    block.appendChild(figure);
    return block;
  }

  function renderMapRegions(entry) {
    const regions = entry.regions || [];
    if (!regions.length) return null;

    const block = sectionBlock("Regions", regions.length);
    const grid = document.createElement("div");
    grid.className = "map-region-grid";
    for (const region of regions) {
      const card = document.createElement("div");
      card.className = "map-region-card";
      const meta = region.level ? `level ${region.level}` : "";
      card.innerHTML = `
        <strong dir="auto">${escapeHtml(region.name)}</strong>
        <span>${escapeHtml(meta || "Map region")}</span>
      `;
      grid.appendChild(card);
    }
    block.appendChild(grid);
    return block;
  }

  function renderMapFishGrid(entries) {
    const list = entries || [];
    if (!list.length) return null;

    const block = sectionBlock("Fish", list.length);
    const grid = document.createElement("div");
    grid.className = "map-entity-grid";
    for (const item of list.slice(0, 80)) {
      const card = document.createElement(item.id && wikiEntriesById.has(item.id) ? "button" : "div");
      if (card.tagName === "BUTTON") {
        card.type = "button";
        card.addEventListener("click", () => {
          activateWikiKind("fish", { clearQuery: true });
          navigate({ type: "wiki", id: item.id });
        });
      }
      card.className = "map-entity-card map-fish-card";
      card.appendChild(renderInlineImage(item.image, item.name, "FS"));
      const body = document.createElement("span");
      body.innerHTML = `<strong dir="auto">${escapeHtml(item.name)}</strong>`;
      card.appendChild(body);
      grid.appendChild(card);
    }
    block.appendChild(grid);
    return block;
  }

  function renderMapEntityGrid(title, entries, fallbackType) {
    const list = entries || [];
    if (!list.length) return null;

    const block = sectionBlock(title, list.length);
    const grid = document.createElement("div");
    grid.className = "map-entity-grid";
    for (const item of list.slice(0, 80)) {
      const card = document.createElement(item.id && wikiEntriesById.has(item.id) ? "button" : "div");
      if (card.tagName === "BUTTON") {
        card.type = "button";
        card.addEventListener("click", () => navigate({ type: "wiki", id: item.id }));
      }
      card.className = "map-entity-card";
      card.appendChild(renderInlineImage(item.image, item.name, fallbackType === "shop" ? "NPC" : "MO"));
      const meta = mapEntityMeta(item, fallbackType);
      const body = document.createElement("span");
      body.innerHTML = `
        <strong dir="auto">${escapeHtml(item.name)}</strong>
        <small>${escapeHtml(meta)}</small>
      `;
      card.appendChild(body);
      grid.appendChild(card);
    }
    if (list.length > 80) {
      const more = document.createElement("div");
      more.className = "empty-note";
      more.textContent = `Showing the first 80 of ${list.length}. Use search to narrow the list.`;
      block.appendChild(more);
    }
    block.appendChild(grid);
    return block;
  }

  function mapEntityMeta(item, fallbackType) {
    if (fallbackType === "shop") {
      return cleanupPublicText(item.summary || "NPC shop.");
    }
    const parts = [];
    if (item.level) parts.push(`level ${item.level}`);
    if (item.regions?.length) parts.push(item.regions.slice(0, 3).join(", "));
    return parts.join(" · ") || cleanupPublicText(item.summary || "Monster");
  }

  function renderWikiListChip(entry, list, item) {
    const mapEntry = entry.type === "creature" && list.title === "Found in"
      ? mapEntryForLabel(item)
      : null;

    const chip = document.createElement(mapEntry ? "button" : "span");
    chip.className = "wiki-chip";
    if (mapEntry) {
      chip.type = "button";
      chip.classList.add("wiki-chip-button");
      chip.title = `Open ${mapEntry.name}`;
      if (mapEntry.image) {
        const img = document.createElement("img");
        img.className = "wiki-chip-icon";
        img.src = mapEntry.image;
        img.alt = "";
        chip.appendChild(img);
      }
      const label = document.createElement("span");
      label.textContent = item;
      chip.appendChild(label);
      chip.addEventListener("click", () => {
        activateWikiKind("area", { clearQuery: true });
        navigate({ type: "wiki", id: mapEntry.id });
      });
      return chip;
    }

    chip.textContent = item;
    return chip;
  }

  function mapEntryForLabel(label) {
    return mapEntriesByLookup.get(normalize(label)) || null;
  }

  function renderWikiStats(stats) {
    const rows = Object.entries(stats || {})
      .filter(([, value]) => value !== "" && value !== null && value !== undefined && value !== false);
    if (!rows.length) return null;

    const block = sectionBlock("Details", rows.length);
    const grid = document.createElement("div");
    grid.className = "wiki-grid";
    for (const [label, value] of rows) {
      const cell = document.createElement("div");
      cell.className = "wiki-stat";
      cell.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`;
      grid.appendChild(cell);
    }
    block.appendChild(grid);
    return block;
  }

  function renderSkillOverview(entry) {
    const block = sectionBlock("Skill overview");
    const wrap = document.createElement("div");
    wrap.className = "skill-overview";
    const icon = renderInlineImage(entry.image, entry.name, "SK");
    icon.classList.add("skill-overview-icon");
    wrap.appendChild(icon);

    const content = document.createElement("div");
    content.className = "skill-overview-body";
    const values = [
      ["Group", entry.skillGroup || "Skill"],
      ["Type", entry.skillType || "Skill"],
      ["Max level", entry.levelCap || "0"],
      ["Combat", entry.combat ? "Yes" : "No"],
    ];
    content.innerHTML = values.map(([label, value]) => `
      <span>
        <small>${escapeHtml(label)}</small>
        <strong>${escapeHtml(value)}</strong>
      </span>
    `).join("");
    wrap.appendChild(content);
    block.appendChild(wrap);
    return block;
  }

  function renderSkillBonuses(entry) {
    const bonuses = entry.bonuses || [];
    if (!bonuses.length) return null;

    const block = sectionBlock("Bonuses", bonuses.length);
    const list = document.createElement("div");
    list.className = "skill-bonus-list";
    for (const bonus of bonuses) {
      const row = document.createElement("div");
      row.className = "skill-bonus-row";
      row.innerHTML = `
        <strong>${escapeHtml(bonus.name || humanizeLabel(bonus.bonusId || bonus.id || "Bonus"))}</strong>
        <span>${escapeHtml(bonus.text || "Bonus per skill level")}</span>
      `;
      list.appendChild(row);
    }
    block.appendChild(list);
    return block;
  }

  function renderSkillAbilities(entry) {
    const abilities = entry.abilities || [];
    if (!abilities.length) return null;

    const block = sectionBlock("Abilities", abilities.length);
    const grid = document.createElement("div");
    grid.className = "skill-ability-grid";
    for (const ability of abilities) {
      const card = document.createElement("div");
      card.className = "skill-ability-card";
      card.appendChild(renderInlineImage(ability.icon, ability.name, "SK"));
      const body = document.createElement("span");
      const meta = [
        ability.level !== "" && ability.level !== null && ability.level !== undefined ? `level ${ability.level}` : "",
        ability.kind || "",
      ].filter(Boolean).join(" · ");
      const details = [
        cleanupPublicText(ability.description || ""),
        ...(ability.details || []),
      ].filter(Boolean).join(" · ");
      body.innerHTML = `
        <strong>${escapeHtml(ability.name || "Ability")}</strong>
        <small>${escapeHtml(meta || "Unlock")}</small>
        ${details ? `<em>${escapeHtml(details)}</em>` : ""}
      `;
      card.appendChild(body);
      grid.appendChild(card);
    }
    block.appendChild(grid);
    return block;
  }

  function renderMonsterAbilities(entry) {
    const abilities = entry.abilities || [];
    if (!abilities.length) return null;

    const block = sectionBlock("Skills", abilities.length);
    const grid = document.createElement("div");
    grid.className = "monster-skill-grid";
    for (const ability of abilities) {
      const card = document.createElement("div");
      card.className = "monster-skill-card";
      card.appendChild(renderInlineImage(ability.icon, ability.name, "SK"));
      const body = document.createElement("span");
      body.innerHTML = `
        <strong>${escapeHtml(ability.name)}</strong>
      `;
      card.appendChild(body);
      grid.appendChild(card);
    }
    block.appendChild(grid);
    return block;
  }

  function renderMonsterDrops(entry) {
    const drops = entry.drops || [];
    if (!drops.length) return null;

    const block = sectionBlock("Drops and yields", drops.length);
    const grid = document.createElement("div");
    grid.className = "monster-drop-grid";
    for (const drop of drops) {
      const card = document.createElement(items[drop.itemId] ? "button" : "div");
      if (card.tagName === "BUTTON") {
        card.type = "button";
        card.addEventListener("click", () => navigate({ type: "item", id: drop.itemId }));
      }
      card.className = "monster-drop-card";
      card.appendChild(items[drop.itemId] ? renderIcon(drop.itemId) : renderInlineImage(drop.icon, drop.name, initials(drop.name)));
      const meta = [drop.kind, drop.amount ? `x${drop.amount}` : "", drop.chance].filter(Boolean).join(" · ");
      const body = document.createElement("span");
      body.innerHTML = `
        <strong>${escapeHtml(drop.name)}</strong>
        <small>${escapeHtml(meta || "Drop")}</small>
      `;
      card.appendChild(body);
      grid.appendChild(card);
    }
    block.appendChild(grid);
    return block;
  }

  function renderInlineImage(src, alt, fallbackText) {
    const icon = document.createElement("span");
    icon.className = "item-icon";
    if (src) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = alt || "";
      icon.appendChild(img);
      return icon;
    }
    const fallback = document.createElement("span");
    fallback.className = "fallback-icon";
    fallback.textContent = fallbackText || initials(alt || "WT");
    icon.appendChild(fallback);
    return icon;
  }

  function renderWikiTable(table) {
    const rows = table.rows || [];
    const columns = (table.columns || []).filter(isPublicWikiColumn);
    if (!rows.length || !columns.length) return document.createDocumentFragment();
    const block = sectionBlock(table.title || "Table");
    const wrap = document.createElement("div");
    wrap.className = "wiki-table-wrap";
    const htmlRows = rows.map((row) => {
      const cells = columns.map((column) => `<td>${escapeHtml(formatWikiTableValue(row[column], column))}</td>`).join("");
      return `<tr>${cells}</tr>`;
    }).join("");
    wrap.innerHTML = `
      <table class="wiki-table">
        <thead><tr>${columns.map((column) => `<th>${escapeHtml(wikiColumnLabel(column))}</th>`).join("")}</tr></thead>
        <tbody>${htmlRows}</tbody>
      </table>
    `;
    block.appendChild(wrap);
    return block;
  }

  function formatWikiTableValue(value, column) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "number") {
      return Number.isInteger(value) ? String(value) : Number(value.toFixed(2)).toString();
    }
    return value;
  }

  function isPublicWikiColumn(column) {
    const hidden = new Set(["density", "respawn", "respawnTime", "group", "id", "localId"]);
    return !hidden.has(column);
  }

  function wikiColumnLabel(column) {
    const labels = {
      name: "Name",
      type: "Type",
      note: "Note",
      bait: "Bait",
      result: "Result",
    };
    if (labels[column]) return labels[column];
    return humanizeLabel(column);
  }

  function renderImportedInfoBlock(reference) {
    const block = sectionBlock("Wiki overview");
    const row = document.createElement("div");
    row.className = "wiki-link-row";
    row.innerHTML = `
      <strong>${escapeHtml(reference.title || "Imported wiki summary")}</strong>
      <p>${escapeHtml(reference.extract || "")}</p>
    `;
    block.appendChild(row);
    return block;
  }

  function renderWikiInspector(entry) {
    els.emptyInspector.classList.add("is-hidden");
    els.inspectorContent.classList.remove("is-hidden");
    els.inspectorContent.innerHTML = "";

    const head = document.createElement("div");
    head.className = "item-head";
    head.appendChild(renderWikiIcon(entry, "large"));
    const title = document.createElement("div");
    title.innerHTML = `
      <h2 dir="auto">${escapeHtml(entry.name)}</h2>
      <p>${escapeHtml(wikiTypeLabel(entry.type))}</p>
    `;
    head.appendChild(title);
    els.inspectorContent.appendChild(head);

    const imported = entry.externalInfo;
    if (imported?.extract) {
      els.inspectorContent.appendChild(renderImportedInfoBlock(imported));
    }

    const noteBlock = sectionBlock("Available here");
    const note = document.createElement("div");
    note.className = "wiki-inspector-note";
    note.innerHTML = `
      <strong>${escapeHtml(wikiTypeLabel(entry.type))}</strong>
      <span>This page is kept inside the wiki and does not link to an external site.</span>
    `;
    noteBlock.appendChild(note);
    els.inspectorContent.appendChild(noteBlock);
  }

  function renderItemInspector(itemId) {
    const item = itemRecord(itemId);
    const produced = recipesByResult.get(itemId) || [];
    const used = usageByItem.get(itemId) || [];
    const sources = sourcesByItem[itemId] || [];
    const economy = itemEconomy[itemId] || null;
    const soldBy = shopsByItem[itemId] || [];

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
    panels.appendChild(itemEconomyBlock("Item economy", economy));
    panels.appendChild(shopSaleListBlock("Sold by shops", soldBy));
    panels.appendChild(recipeListBlock("Recipes that create this item", produced, { showIcons: true }));
    panels.appendChild(recipeListBlock("Used in recipes", used, { showIcons: true }));
    panels.appendChild(sourceListBlock("Known sources", sources));
    els.inspectorContent.appendChild(panels);

    if (!produced.length && !used.length && !sources.length && !soldBy.length && !hasEconomyInfo(economy)) {
      const block = sectionBlock("Note", 0);
      const note = document.createElement("div");
      note.className = "empty-note";
      note.textContent = "No clear source was found in the local recipe, shop, economy, or drop files. It may come from gathering, an NPC, or server-side data.";
      block.appendChild(note);
      els.inspectorContent.appendChild(block);
    }
  }

  function itemEconomyBlock(title, economy) {
    const block = sectionBlock(title, hasEconomyInfo(economy) ? 1 : 0);
    if (!hasEconomyInfo(economy)) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "No public price fields found in the local item data.";
      block.appendChild(empty);
      return block;
    }

    const stats = {};
    stats["Can sell to trader"] = hasPrice(economy.buyUpPrice) && !economy.tradeRestricted
      ? "Likely yes"
      : "No clear buy-up price";
    if (hasPrice(economy.buyUpPrice)) stats["Trader buy-up"] = formatEconomyPrice(economy.buyUpPrice);
    if (hasPrice(economy.sellPrice)) stats["Base shop price"] = formatEconomyPrice(economy.sellPrice);
    if (hasPrice(economy.repairPrice)) stats["Repair price"] = formatEconomyPrice(economy.repairPrice);
    stats["Trade flag"] = economy.tradeRestricted ? "Restricted" : "Allowed";
    const grid = document.createElement("div");
    grid.className = "wiki-grid";
    for (const [label, value] of Object.entries(stats)) {
      const cell = document.createElement("div");
      cell.className = "wiki-stat";
      cell.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`;
      grid.appendChild(cell);
    }
    block.appendChild(grid);
    return block;
  }

  function shopSaleListBlock(title, list) {
    const block = sectionBlock(title, list.length);
    const wrap = document.createElement("div");
    wrap.className = "mini-list";
    const limited = list.slice(0, 80);

    for (const sale of limited) {
      const row = document.createElement(sale.shopId && wikiEntriesById.has(sale.shopId) ? "button" : "div");
      row.className = "source-row";
      if (row.tagName === "BUTTON") {
        row.type = "button";
        row.addEventListener("click", () => navigate({ type: "wiki", id: sale.shopId }));
      }
      const details = [
        sale.amount ? `amount: ${sale.amount}` : "",
        sale.price ? `price: ${sale.price}` : "",
        sale.note ? `note: ${sale.note}` : "",
      ].filter(Boolean);
      row.innerHTML = `
        <div class="source-top">
          <span dir="auto">${escapeHtml(sale.shop || "NPC shop")}</span>
          <span>Shop</span>
        </div>
        ${details.map((line) => `<div class="source-meta">${escapeHtml(line)}</div>`).join("")}
      `;
      wrap.appendChild(row);
    }

    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "No NPC shop was found selling this item in the local shop data.";
      wrap.appendChild(empty);
    }

    block.appendChild(wrap);
    return block;
  }

  function hasEconomyInfo(economy) {
    return Boolean(economy && (
      hasPrice(economy.buyUpPrice) ||
      hasPrice(economy.sellPrice) ||
      hasPrice(economy.repairPrice) ||
      economy.tradeRestricted
    ));
  }

  function hasPrice(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0;
  }

  function formatEconomyPrice(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    const rounded = Math.abs(number - Math.round(number)) < 0.01
      ? String(Math.round(number))
      : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return `${rounded} coins`;
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

  function renderWikiIcon(entry, size) {
    if (entry?.image) {
      const icon = renderInlineImage(entry.image, entry.name, wikiInitials(entry));
      if (size === "large") {
        icon.style.width = "64px";
        icon.style.height = "64px";
      }
      return icon;
    }
    if (entry?.itemId && items[entry.itemId]) {
      return renderIcon(entry.itemId, size);
    }

    const icon = document.createElement("span");
    icon.className = "item-icon";
    if (size === "large") {
      icon.style.width = "64px";
      icon.style.height = "64px";
    }

    const fallback = document.createElement("span");
    fallback.className = "fallback-icon";
    fallback.textContent = wikiInitials(entry);
    icon.appendChild(fallback);
    return icon;
  }

  function wikiInitials(entry) {
    const typeMap = {
      creature: "MO",
      area: "MP",
      fish: "FS",
      shop: "SH",
      quest: "QT",
      skill: "SK",
    };
    return typeMap[entry?.type] || initials(entry?.name || "Wiki");
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

  function wikiEntryMatches(entry, query) {
    if (normalize(entry.name).includes(query)) return true;
    if (normalize(entry.localId).includes(query)) return true;
    if (normalize(entry.id).includes(query)) return true;
    if (normalize(entry.type).includes(query)) return true;
    if (normalize(entry.summary).includes(query)) return true;
    if (normalize(entry.description).includes(query)) return true;
    if (normalize(entry.searchText).includes(query)) return true;
    if (entry.externalInfo && normalize(entry.externalInfo.title).includes(query)) return true;
    if (entry.externalInfo && normalize(entry.externalInfo.extract).includes(query)) return true;
    return false;
  }

  function isPublicWikiEntry(entry) {
    if (!entry || entry.type === "quest") return false;
    if (entry.type === "fish" && isFishingLootBucket(entry)) return false;
    return true;
  }

  function isFishingLootBucket(entry) {
    const text = normalize(`${entry?.id || ""} ${entry?.localId || ""} ${entry?.name || ""}`);
    return text.includes("garbage");
  }

  function hasImportedSummary(entry) {
    const imported = entry?.externalInfo;
    return Boolean(imported?.extract);
  }

  function publicSummary(entry) {
    if (!entry) return "";
    if (entry.type === "area") return areaSummary(entry);
    if (entry.type === "skill") return skillSummary(entry);
    return cleanupPublicText(entry.summary || entry.description || entry.name || "");
  }

  function skillSummary(entry) {
    const parts = [];
    if (entry.skillGroup) parts.push(entry.skillGroup);
    if (entry.levelCap !== "" && entry.levelCap !== null && entry.levelCap !== undefined) {
      parts.push(`max level ${entry.levelCap}`);
    }
    if (entry.abilities?.length) parts.push(`${entry.abilities.length} unlocks`);
    if (entry.bonuses?.length) parts.push(`${entry.bonuses.length} bonuses`);
    return parts.join(" · ") || cleanupPublicText(entry.summary || "Skill");
  }

  function areaSummary(entry) {
    if (entry.regions?.length || entry.monsters?.length || entry.fish?.length || entry.npcs?.length) {
      const parts = [];
      if (entry.levelRange) parts.push(`Level ${entry.levelRange}`);
      if (entry.regions?.length) parts.push(`${entry.regions.length} regions`);
      if (entry.monsters?.length) parts.push(`${entry.monsters.length} monsters`);
      if (entry.fish?.length) parts.push(`${entry.fish.length} fish`);
      if (entry.npcs?.length) parts.push(`${entry.npcs.length} NPCs`);
      return parts.join(" · ") || "Main map information from local game data.";
    }
    const table = (entry.tables || []).find((item) => item.title === "Found here" || item.title === "Spawn samples");
    const rows = table?.rows || [];
    const names = rows.map((row) => row.name).filter(Boolean);
    if (names.length) {
      const preview = names.slice(0, 4).join(", ");
      return `Found here: ${preview}${names.length > 4 ? ", and more" : ""}`;
    }
    return "Map information from local game data.";
  }

  function publicStats(entry) {
    const stats = { ...(entry?.stats || {}) };
    if (!entry || entry.type === "shop") return {};
    if (entry.type === "area") return stats;
    delete stats.parse;
    delete stats.class;
    delete stats.items;
    delete stats.prices;
    delete stats.spawns;
    delete stats.density;
    delete stats.respawn;

    if (stats["quest type"]) {
      stats["quest type"] = cleanupQuestType(stats["quest type"]);
    }

    return Object.fromEntries(
      Object.entries(stats).filter(([, value]) => value !== "" && value !== null && value !== undefined && value !== false)
    );
  }

  function cleanupQuestType(value) {
    return humanizeLabel(String(value || "")
      .replace(/^WT/i, "")
      .replace(/\bQuest\b/gi, "")
      .trim());
  }

  function cleanupPublicText(value) {
    return String(value || "")
      .replace(/\b\d+\s+local spawn entries\b/gi, "Map information from local game data.")
      .replace(/\bArea definition; no public spawn rows parsed\.\b/gi, "Map information from local game data.")
      .replace(/\bdefinition from local game data\b/gi, "information from game data")
      .replace(/\bNPC shop definition\.\b/gi, "NPC shop.")
      .replace(/\bFish or fishing loot definition\.\b/gi, "Fish or fishing loot.")
      .trim();
  }

  function humanizeLabel(value) {
    return String(value || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^./, (char) => char.toUpperCase());
  }

  function itemMatches(item, query) {
    return normalize(item.id).includes(query) ||
      normalize(item.name).includes(query) ||
      normalize(item.description || "").includes(query);
  }

  function recipeFilterTypes() {
    return new Set(["craft", "build", "process"]);
  }

  function wikiFilterTypes() {
    return new Set(["creature", "area", "fish", "shop", "skill"]);
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

  function sortWikiEntries(a, b) {
    const priority = wikiTypePriority(a.type) - wikiTypePriority(b.type);
    if (priority) return priority;
    if (a.type === "creature" && b.type === "creature") {
      const levelDelta = wikiMonsterLevel(a) - wikiMonsterLevel(b);
      if (levelDelta) return levelDelta;
    }
    if (a.type === "area" && b.type === "area") {
      const orderDelta = wikiMapOrder(a) - wikiMapOrder(b);
      if (orderDelta) return orderDelta;
      const levelDelta = wikiMapLevel(a) - wikiMapLevel(b);
      if (levelDelta) return levelDelta;
    }
    if (a.type === "fish" && b.type === "fish") {
      const levelDelta = wikiFishLevel(a) - wikiFishLevel(b);
      if (levelDelta) return levelDelta;
    }
    if (a.type === "skill" && b.type === "skill") {
      const groupDelta = wikiSkillGroupOrder(a) - wikiSkillGroupOrder(b);
      if (groupDelta) return groupDelta;
      const skillDelta = wikiSkillOrder(a) - wikiSkillOrder(b);
      if (skillDelta) return skillDelta;
    }
    return a.name.localeCompare(b.name);
  }

  function wikiMonsterLevel(entry) {
    const value = Number(entry?.stats?.level);
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  }

  function wikiMapOrder(entry) {
    const value = Number(entry?.mapOrder);
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  }

  function wikiMapLevel(entry) {
    const value = Number(entry?.minLevel);
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  }

  function wikiFishLevel(entry) {
    const rawValue = entry?.stats?.["fishing level"];
    if (rawValue === "" || rawValue === null || rawValue === undefined) return Number.MAX_SAFE_INTEGER;
    const value = Number(rawValue);
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  }

  function wikiSkillGroupOrder(entry) {
    const value = Number(entry?.skillGroupOrder);
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  }

  function wikiSkillOrder(entry) {
    const value = Number(entry?.skillOrder);
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  }

  function wikiTypePriority(type) {
    if (type === "creature") return 0;
    if (type === "area") return 1;
    if (type === "fish") return 2;
    if (type === "shop") return 3;
    if (type === "skill") return 4;
    return 9;
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

  function wikiTypeLabel(type) {
    if (type === "creature") return "Monster";
    if (type === "area") return "Map";
    if (type === "fish") return "Fishing";
    if (type === "shop") return "NPC shop";
    if (type === "skill") return "Skill";
    return "Wiki";
  }

  function preferredWikiEntry() {
    return wikiEntriesById.get("skill:Fishery") ||
      wikiEntriesById.get("skill:Agriculture") ||
      wikiEntries.find((entry) => entry.type === "creature") ||
      wikiEntries[0];
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
