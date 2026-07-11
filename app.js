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
  const accessibleBuyUpNames = accessibleBuyUpBuyerNames(wikiEntries);
  const buyUpBuyers = (wikiData.buyUpBuyers || [])
    .filter((buyer) => accessibleBuyUpNames.has(normalize(buyer.name)));
  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const wikiEntriesById = new Map(wikiEntries.map((entry) => [entry.id, entry]));
  const wikiEntryByItemId = new Map(wikiEntries.filter((entry) => entry.itemId).map((entry) => [entry.itemId, entry]));
  const itemsByLookup = buildItemLookup();
  const buyUpBuyersById = new Map(buyUpBuyers.map((buyer) => [buyer.id, buyer]));
  const buyUpBuyerSpecialItems = new Map(buyUpBuyers.map((buyer) => [buyer.id, new Set(buyer.specialItemIds || [])]));
  const mapEntriesByLookup = new Map();
  const recipesByResult = new Map();
  const recipesByStation = new Map();
  const recipesByTool = new Map();
  const recipesByRequirement = new Map();
  const toolIconCache = new Map();
  const craftSkillsByItem = new Map();
  const usageByItem = new Map();
  const fishButcheringYieldsByFish = buildFishButcheringYields();
  const weaponPoisonItemIds = ["WeaponPoison", "WeaponPoisonBurningSkeleton"];
  const weaponPoisonRelatedItemIds = [
    "WeaponPoison",
    "WeaponPoisonBurningSkeleton",
    "WitchcraftCauldron",
    "WitchcraftPot",
    "EmptyFlask",
    "CornPie",
    "PoisonArrow",
  ];
  const cthulhuPoisonComponentIds = new Set(["CthulhuEye", "CthulhuLarva", "CthulhuTentacles"]);
  const weaponPoisonOrganTraits = data.witchcraftOrgans || {};
  const weaponPoisonOrganSlotCount = 2;
  const weaponPoisonCraftRequirements = [
    "Empty Flask x1",
    `Witchcraft organs x${weaponPoisonOrganSlotCount}`,
    "Reagent Powder x5",
  ];
  const sacrificialOrganRules = data.sacrificialOrganRules || [];
  const sacrificialOrganRelatedItemIds = [
    "SacrificialOrgan",
    "WitchcraftCauldron",
    "WitchcraftPot",
    "InfectedRawHide",
    "ReagentPowder",
  ];
  const sacrificialOrganCraftRequirements = [
    "Witchcraft organ x1",
    "Infected raw hide x5",
    "Reagent Powder x10",
  ];
  const poisonWitchcraftMaterialIds = new Set([
    "ReagentPotion",
    "BattleHungerPotion",
    "BurningRingPotion",
    "PoisonProjectilePotion",
    "WeaknessPotion",
  ]);

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
    if (recipe.result && recipe.skill) addToMapList(craftSkillsByItem, recipe.result, recipe.skill);
    for (const stationId of uniqueStationIds(recipe)) {
      addToMapList(recipesByStation, stationId, recipe);
    }
    if (recipe.toolRequired) {
      addToMapList(recipesByTool, recipe.toolRequired, recipe);
    }
    for (const requirementId of recipe.bonusesRequired || []) {
      addToMapList(recipesByRequirement, requirementId, recipe);
    }
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
    sellItems: [],
    sellTab: "calculator",
    cookingTab: "all",
    poisonTab: "weapon",
    poisonMixerItems: [],
    poisonMixerQuery: "",
    sacrificialOrganItem: "",
    sacrificialOrganQuery: "",
    goldGoblinMode: "recommended",
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
    navigate({ type: "home" }, true);
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
      navigate({ type: "home" });
    });

    bindItemTooltipEvents();
  }

  function bindItemTooltipEvents() {
    const tooltip = document.createElement("div");
    tooltip.className = "item-tooltip is-hidden";
    document.body.appendChild(tooltip);

    let activeTarget = null;

    const showTooltip = (event) => {
      const eventTarget = event.target instanceof Element ? event.target : null;
      const target = eventTarget?.closest("[data-rich-tooltip-html], [data-pet-tooltip-html], [data-pet-tooltip], [data-item-id]");
      if (!target) return;
      if (target === activeTarget && !tooltip.classList.contains("is-hidden")) {
        moveItemTooltip(event, tooltip);
        return;
      }
      const html = target.dataset.richTooltipHtml || target.dataset.petTooltipHtml || "";
      const text = target.dataset.petTooltip || itemTooltipText(target.dataset.itemId);
      if (!html && !text) return;
      activeTarget = target;
      tooltip.classList.toggle("is-rich-tooltip", Boolean(target.dataset.richTooltipHtml));
      tooltip.classList.toggle("is-pet-tooltip", Boolean(target.dataset.petTooltipHtml));
      if (html) {
        tooltip.innerHTML = html;
      } else {
        tooltip.textContent = text;
      }
      tooltip.classList.remove("is-hidden");
      moveItemTooltip(event, tooltip);
    };

    document.addEventListener("pointerover", showTooltip);
    document.addEventListener("mouseover", showTooltip);

    document.addEventListener("pointermove", (event) => {
      if (!activeTarget || tooltip.classList.contains("is-hidden")) return;
      moveItemTooltip(event, tooltip);
    });

    document.addEventListener("mousemove", (event) => {
      if (!activeTarget || tooltip.classList.contains("is-hidden")) {
        showTooltip(event);
        return;
      }
      moveItemTooltip(event, tooltip);
    });

    const hideTooltip = (event) => {
      if (!activeTarget) return;
      if (event.relatedTarget && activeTarget.contains(event.relatedTarget)) return;
      activeTarget = null;
      tooltip.classList.add("is-hidden");
      tooltip.classList.remove("is-rich-tooltip");
      tooltip.classList.remove("is-pet-tooltip");
    };

    document.addEventListener("pointerout", hideTooltip);
    document.addEventListener("mouseout", hideTooltip);
  }

  function moveItemTooltip(event, tooltip) {
    const margin = 14;
    const rect = tooltip.getBoundingClientRect();
    let left = event.clientX + margin;
    let top = event.clientY + margin;
    if (left + rect.width + margin > window.innerWidth) {
      left = Math.max(margin, event.clientX - rect.width - margin);
    }
    if (top + rect.height + margin > window.innerHeight) {
      top = Math.max(margin, event.clientY - rect.height - margin);
    }
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
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
    if (state.kind === "sell") {
      navigate({ type: "sell" });
      return;
    }
    if (state.kind === "cooking") {
      navigate({ type: "cooking" });
      return;
    }
    if (state.kind === "poison") {
      navigate({ type: "poison" });
      return;
    }
    if (state.kind === "sacrifice") {
      navigate({ type: "sacrifice" });
      return;
    }
    if (state.kind === "all") {
      navigate({ type: "home" });
      return;
    }

    let target = firstTargetForFilter(state.kind, state.query);
    if (!target && state.query) {
      state.query = "";
      els.searchInput.value = "";
      target = firstTargetForFilter(state.kind, "");
    }
    if (target) {
      navigate(target);
      return;
    }
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

  function firstTargetForFilter(filter, rawQuery) {
    const query = normalize(rawQuery);
    if (filter === "items") {
      const item = Object.values(items)
        .filter((record) => itemMatches(record, query))
        .sort((a, b) => sortItemsForQuery(a, b, query))[0];
      return item ? { type: "item", id: item.id } : null;
    }

    if (filter === "sacrifice") return { type: "sacrifice" };

    if (recipeFilterTypes().has(filter)) {
      if (filter === "cooking") return { type: "cooking" };
      if (filter === "potion") return { type: "potion" };
      if (filter === "poison") return { type: "poison" };
      const recipe = recipes
        .filter((record) => recipeMatchesFilter(record, filter))
        .filter((record) => !query || recipeMatches(record, query))
        .sort(sortRecipes)[0];
      return recipe ? { type: "recipe", id: recipe.id } : null;
    }

    if (wikiFilterTypes().has(filter)) {
      const entry = wikiEntries
        .filter(isPublicWikiEntry)
        .filter((record) => record.type === filter)
        .filter((record) => !query || wikiEntryMatches(record, query))
        .sort(sortWikiEntries)[0];
      return entry ? { type: "wiki", id: entry.id } : null;
    }

    return null;
  }

  function renderSearchResults() {
    if (state.kind === "sell") {
      renderSellSearchResults();
      return;
    }
    if (state.kind === "poison") {
      renderWeaponPoisonSearchResults();
      return;
    }
    if (state.kind === "sacrifice") {
      renderSacrificialOrganSearchResults();
      return;
    }
    const query = normalize(state.query);
    const filter = state.kind || "all";
    const includeItems = filter === "all" || filter === "items";
    const includeRecipes = filter === "all" || recipeFilterTypes().has(filter);
    const includeWiki = filter === "all" || wikiFilterTypes().has(filter);

    const filteredRecipes = includeRecipes ? recipes
      .filter((recipe) => recipeMatchesFilter(recipe, filter))
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
    const recipeLimit = (filter === "cooking" || filter === "potion" || filter === "poison") ? filteredRecipes.length : (filter === "all" ? 95 : 160);
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

  function renderSellSearchResults() {
    const query = normalize(state.query);
    const sellable = Object.values(items)
      .filter((item) => isItemSellable(item.id))
      .filter((item) => !query || itemMatches(item, query))
      .sort((a, b) => sortItemsForQuery(a, b, query));
    const limited = sellable.slice(0, 180);

    els.resultList.innerHTML = "";
    els.resultMeta.textContent = `${sellable.length} sellable items` + (sellable.length > limited.length ? `, showing ${limited.length}` : "");

    for (const item of limited) {
      els.resultList.appendChild(renderSellResultItemRow(item));
    }

    if (!sellable.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "No sellable items matched. Try Small hides, fish, ore, leather, or a crafted item name.";
      els.resultList.appendChild(empty);
    }
  }

  function renderWeaponPoisonSearchResults() {
    const query = normalize(state.query);
    const ids = [...new Set([...weaponPoisonRelatedItemIds, ...weaponPoisonComponentItemIds()])]
      .filter((itemId) => items[itemId])
      .filter((itemId) => !query || weaponPoisonSearchText(itemId).includes(query));
    els.resultList.innerHTML = "";
    els.resultMeta.textContent = `${ids.length} weapon poison items`;
    for (const itemId of ids.slice(0, 180)) {
      els.resultList.appendChild(renderCombinationItemRow(itemId, "weapon"));
    }
    if (!ids.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "No Weapon Poison item matched. Try Dragon eye, Scorpion tail, or Reagent powder.";
      els.resultList.appendChild(empty);
    }
  }

  function renderSacrificialOrganSearchResults() {
    const query = normalize(state.query);
    const ids = [...new Set([...sacrificialOrganRelatedItemIds, ...sacrificialOrganCandidateItemIds()])]
      .filter((itemId) => items[itemId])
      .filter((itemId) => !query || combinationSearchText(itemId).includes(query));
    els.resultList.innerHTML = "";
    els.resultMeta.textContent = `${ids.length} Sacrificial Organ items`;
    for (const itemId of ids.slice(0, 180)) {
      els.resultList.appendChild(renderCombinationItemRow(itemId, "sacrifice"));
    }
    if (!ids.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "No Sacrificial Organ item matched. Try Dragon eye, Bear paw, or Reagent powder.";
      els.resultList.appendChild(empty);
    }
  }

  function weaponPoisonSearchText(itemId) {
    return normalize([
      itemId,
      itemName(itemId),
      itemDescription(itemId),
      poisonItemRole(itemId),
      weaponPoisonOrganTraitSearchText(itemId),
    ].join(" "));
  }

  function combinationSearchText(itemId) {
    const sacrificialRule = sacrificialRuleForOrgan(itemId);
    return normalize([
      weaponPoisonSearchText(itemId),
      sacrificialRule?.entityName,
      sacrificialRule?.entityId,
      compactWitchcraftOrganText(itemId),
    ].join(" "));
  }

  function renderCombinationItemRow(itemId, mode) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "result-row";
    if (weaponPoisonOrganTraits[itemId]) {
      attachWeaponPoisonOrganTooltip(row, itemId);
    } else {
      attachItemTooltip(row, itemId);
    }
    row.appendChild(renderUntooltippedIcon(itemId));

    const body = document.createElement("span");
    const role = mode === "sacrifice"
      ? sacrificialCombinationSubtitle(itemId)
      : weaponPoisonCombinationSubtitle(itemId);
    body.innerHTML = `
      <span class="result-title" dir="auto">${escapeHtml(itemName(itemId))}</span>
      <span class="result-subtitle">${escapeHtml(role)}</span>
    `;
    row.appendChild(body);
    row.addEventListener("click", () => {
      if (mode === "weapon" && weaponPoisonOrganTraits[itemId]) {
        state.poisonMixerItems = normalizeWeaponPoisonMixerSelection([...state.poisonMixerItems, itemId]);
        renderPoisonBrowser();
      } else if (mode === "sacrifice" && weaponPoisonOrganTraits[itemId]) {
        state.sacrificialOrganItem = itemId;
        state.kind = "sacrifice";
        state.wikiKind = "all";
        syncUnifiedFilterButtons();
        renderSacrificialOrganBrowser();
      }
      renderItemInspector(itemId);
      renderSearchResults();
    });
    return row;
  }

  function weaponPoisonCombinationSubtitle(itemId) {
    if (weaponPoisonOrganTraits[itemId]) return `Weapon Poison organ · ${compactWitchcraftOrganText(itemId)}`;
    return poisonItemRole(itemId);
  }

  function sacrificialCombinationSubtitle(itemId) {
    if (weaponPoisonOrganTraits[itemId]) {
      const rule = sacrificialRuleForOrgan(itemId);
      return `Sacrificial Organ input · result: ${rule?.entityName || "Unknown"}`;
    }
    return itemDescription(itemId) || "Sacrificial Organ related item";
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
    attachItemTooltip(row, item.id);
    if (state.current?.type === "item" && state.current.id === item.id) row.classList.add("is-active");
    row.appendChild(renderIcon(item.id));

    const body = document.createElement("span");
    const produces = recipesByResult.get(item.id)?.length || 0;
    const uses = usageByItem.get(item.id)?.length || 0;
    const sources = sourcesByItem[item.id]?.length || 0;
    const shops = shopsByItem[item.id]?.length || 0;
    body.innerHTML = `
      <span class="result-title" dir="auto">${escapeHtml(itemName(item.id))}</span>
      <span class="result-subtitle">Item · crafted by: ${produces} · used in: ${uses} · sources: ${sources} · shops: ${shops}</span>
    `;
    row.appendChild(body);
    row.addEventListener("click", () => navigate({ type: "item", id: item.id }));
    return row;
  }

  function renderSellResultItemRow(item) {
    const economy = itemEconomy[item.id] || {};
    const best = bestBuyUpBuyerForItem(item.id);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "result-row";
    attachItemTooltip(row, item.id);
    row.appendChild(renderIcon(item.id));

    const body = document.createElement("span");
    body.innerHTML = `
      <span class="result-title" dir="auto">${escapeHtml(itemName(item.id))}</span>
      <span class="result-subtitle">Sell item · base ${formatCurrencyHtml(economy.buyUpPrice)} · best ${escapeHtml(best?.name || "buyer")}</span>
      <span class="result-badge">Click to add</span>
    `;
    row.appendChild(body);
    row.addEventListener("click", () => {
      addSellItem(item.id);
      renderSellCalculator();
      renderItemInspector(item.id);
      renderSearchResults();
    });
    return row;
  }

  function renderResultRecipeRow(recipe) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "result-row";
    attachItemTooltip(row, recipe.result);
    if (state.current?.type === "recipe" && state.current.id === recipe.id) row.classList.add("is-active");
    row.appendChild(renderIcon(recipe.result));

    const body = document.createElement("span");
    const context = recipeContext(recipe);
    const kindLabel = state.kind === "cooking" && isCookingRecipe(recipe)
      ? cookingRecipeKindLabel(recipe)
      : state.kind === "poison" && isPoisonRecipe(recipe)
        ? poisonRecipeKindLabel(recipe)
        : recipeKindLabel(recipe.kind);
    body.innerHTML = `
      <span class="result-title" dir="auto">${escapeHtml(itemName(recipe.result))}</span>
      <span class="result-subtitle">${escapeHtml(kindLabel)} · ${escapeHtml(context)}${recipe.skill ? " · " + escapeHtml(displaySkill(recipe.skill)) : ""}${recipe.hidden ? " · Hidden" : ""}</span>
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
    } else if (next.type === "station") {
      state.mode = "recipes";
      setActiveModeButton();
      syncModeChrome();
      renderStationRecipes(next.id);
      renderItemInspector(next.id);
    } else if (next.type === "tool") {
      state.mode = "recipes";
      setActiveModeButton();
      syncModeChrome();
      renderToolRecipes(next.id);
      renderItemInspector(next.id);
    } else if (next.type === "requirement") {
      state.mode = "recipes";
      setActiveModeButton();
      syncModeChrome();
      renderRequirementRecipes(next.id);
      renderItemInspector(next.id);
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
    } else if (next.type === "sell") {
      state.mode = "recipes";
      state.kind = "sell";
      state.wikiKind = "all";
      setActiveModeButton();
      syncModeChrome();
      renderSellCalculator();
    } else if (next.type === "cooking") {
      state.mode = "recipes";
      state.kind = "cooking";
      state.wikiKind = "all";
      setActiveModeButton();
      syncModeChrome();
      renderCookingBrowser();
    } else if (next.type === "potion") {
      state.mode = "recipes";
      state.kind = "potion";
      state.wikiKind = "all";
      setActiveModeButton();
      syncModeChrome();
      renderPotionBrowser();
    } else if (next.type === "poison") {
      state.mode = "recipes";
      state.kind = "poison";
      state.wikiKind = "all";
      setActiveModeButton();
      syncModeChrome();
      renderPoisonBrowser();
    } else if (next.type === "sacrifice") {
      state.mode = "recipes";
      state.kind = "sacrifice";
      state.wikiKind = "all";
      setActiveModeButton();
      syncModeChrome();
      renderSacrificialOrganBrowser();
    } else if (next.type === "home") {
      state.mode = "recipes";
      state.kind = "all";
      state.wikiKind = "all";
      setActiveModeButton();
      syncModeChrome();
      renderHomePage();
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

  function renderHomePage() {
    els.recipeKind.textContent = "Home";
    els.recipeTitle.textContent = "Welcome to WT2 Wiki Lab";
    els.recipeDetails.innerHTML = "";
    els.recipeDetails.appendChild(pill("Local game data"));
    els.recipeDetails.appendChild(pill("No external links"));
    els.recipeDetails.appendChild(pill("Recipes, maps, monsters, fishing, shops, and sell prices"));

    const page = document.createElement("div");
    page.className = "home-page";
    page.innerHTML = `
      <section class="home-hero">
        <strong>Find what you need without leaving the site.</strong>
        <p>Search items, recipes, monsters, maps, fishing catches, baits, shops, and sell values from the local WT2 data gathered for this wiki.</p>
      </section>
      <section class="home-report-card">
        <strong>Have feedback or suggestions?</strong>
        <p>Let us know on Discord: <span>wrda_man</span></p>
      </section>
      <section class="home-card-grid">
        <article>
          <span>Search</span>
          <strong>Use English item names</strong>
          <p>Try names like Leather, Pike, Bear, Tanning Vat, or a map name. Internal item ids also work when a public name is unclear.</p>
        </article>
        <article>
          <span>Craft</span>
          <strong>Follow stations and tools</strong>
          <p>Station, tool, and requirement chips are clickable. Open one to see every recipe that can be made there or with that tool.</p>
        </article>
        <article>
          <span>Wiki</span>
          <strong>Use maps as a hub</strong>
          <p>Maps group their regions, monsters, NPCs, and fish. Click a map from a monster or fish page to jump to the full map entry.</p>
        </article>
        <article>
          <span>Fishing</span>
          <strong>Check baits and yields</strong>
          <p>Baits and butchered fish yields are clickable item cards, so you can trace where each material comes from.</p>
        </article>
        <article>
          <span>Sell</span>
          <strong>Use the best buyer calculator</strong>
          <p>The Sell tab estimates buy-up payouts and automatically chooses the highest reachable buyer from the available shop data.</p>
        </article>
        <article>
          <span>Notes</span>
          <strong>Some data can be incomplete</strong>
          <p>If an item has no source, it may come from server-side logic, a hidden event, or data that is not exposed in the local files.</p>
        </article>
      </section>
    `;

    els.formulaBoard.innerHTML = "";
    els.formulaBoard.appendChild(page);
    renderHomeInspector();
  }

  function renderHomeInspector() {
    els.inspectorContent.classList.add("is-hidden");
    els.inspectorContent.classList.remove("pet-inspector-content");
    els.emptyInspector.classList.remove("is-hidden");
    const title = els.emptyInspector.querySelector("h2");
    const copy = els.emptyInspector.querySelector("p");
    if (title) title.textContent = "Pick a result";
    if (copy) copy.textContent = "Open an item, recipe, monster, map, fish, skill, or shop to see detailed local data.";
  }

  function renderSellCalculator() {
    els.recipeKind.textContent = "Sell";
    els.recipeTitle.textContent = state.sellTab === "gold" ? "Gold Goblin" : "Sell calculator";
    els.recipeDetails.innerHTML = "";
    els.recipeDetails.appendChild(renderSellTabControls());
    els.recipeDetails.appendChild(pill("Best buyer selected automatically"));

    if (state.sellTab === "gold") {
      els.recipeDetails.appendChild(pill(`${goldGoblinCandidates().length} craftable sell routes`));
      renderGoldGoblinPanel();
      return;
    }

    els.recipeDetails.appendChild(pill("Buying up"));
    els.recipeDetails.appendChild(pill(`${buyUpBuyers.length} reachable buyers from map data`));
    renderSellCalculatorPanel();
  }

  function renderSellTabControls() {
    const tabs = document.createElement("div");
    tabs.className = "sell-tabs";
    [
      ["calculator", "Calculator"],
      ["gold", "Gold Goblin"],
    ].forEach(([id, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sell-tab";
      button.textContent = label;
      button.title = `Open ${label}`;
      button.setAttribute("aria-pressed", state.sellTab === id ? "true" : "false");
      button.classList.toggle("is-active", state.sellTab === id);
      button.addEventListener("click", () => {
        state.sellTab = id;
        renderSellCalculator();
      });
      tabs.appendChild(button);
    });
    return tabs;
  }

  function renderCookingBrowser() {
    const cookingOnlyRecipes = cookingRecipes().filter((recipe) => !isFermentationTabRecipe(recipe)).sort(sortCookingRecipes);
    const fermentedRecipes = cookingRecipes().filter(isFermentationTabRecipe).sort(sortCookingRecipes);
    const activeRecipes = state.cookingTab === "fermented" ? fermentedRecipes : cookingOnlyRecipes;
    const hiddenCount = activeRecipes.filter((recipe) => recipe.hidden).length;

    els.recipeKind.textContent = "Cooking";
    els.recipeTitle.textContent = state.cookingTab === "fermented" ? "عصائر" : "Cooking recipes";
    els.recipeDetails.innerHTML = "";
    els.recipeDetails.appendChild(renderCookingTabControls(cookingOnlyRecipes.length, fermentedRecipes.length));
    els.recipeDetails.appendChild(pill(`${activeRecipes.length} recipes`));
    els.recipeDetails.appendChild(pill(`${hiddenCount} hidden included`));
    if (state.cookingTab === "fermented") {
      els.recipeDetails.appendChild(pill("Juices and fermented drinks"));
    } else {
      els.recipeDetails.appendChild(pill("Cookery, ovens, campfires, and food processes"));
    }

    const panel = document.createElement("div");
    panel.className = "station-recipe-browser cooking-recipe-browser";

    const grid = document.createElement("div");
    grid.className = "station-recipe-grid cooking-recipe-grid";
    for (const recipe of activeRecipes) {
      grid.appendChild(renderCookingRecipeCard(recipe));
    }

    if (!activeRecipes.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note sell-empty";
      empty.textContent = "No cooking recipes were found in the local data.";
      grid.appendChild(empty);
    }

    panel.appendChild(grid);
    els.formulaBoard.innerHTML = "";
    els.formulaBoard.appendChild(panel);
    renderCookingInspector();
  }

  function renderCookingTabControls(allCount, fermentedCount) {
    const tabs = document.createElement("div");
    tabs.className = "sell-tabs cooking-tabs";
    [
      ["all", `All cooking (${allCount})`],
      ["fermented", `عصائر (${fermentedCount})`],
    ].forEach(([id, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sell-tab cooking-tab";
      button.textContent = label;
      button.title = `Open ${label}`;
      button.setAttribute("aria-pressed", state.cookingTab === id ? "true" : "false");
      button.classList.toggle("is-active", state.cookingTab === id);
      button.addEventListener("click", () => {
        state.cookingTab = id;
        renderCookingBrowser();
        renderSearchResults();
      });
      tabs.appendChild(button);
    });
    return tabs;
  }

  function renderCookingRecipeCard(recipe) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "station-recipe-card cooking-recipe-card";
    attachItemTooltip(card, recipe.result);
    if (recipe.hidden) card.classList.add("is-hidden-recipe");
    if (isFermentationTabRecipe(recipe)) card.classList.add("is-fermented-recipe");
    card.appendChild(renderIcon(recipe.result));

    const body = document.createElement("span");
    body.className = "station-recipe-body";
    const materials = (recipe.materials || []).slice(0, 4).map(formatMaterialLabel).join(" · ");
    const more = (recipe.materials || []).length > 4 ? ` · +${(recipe.materials || []).length - 4} more` : "";
    const stationText = stationNames(recipe).slice(0, 3).join(", ");
    const badges = [
      cookingRecipeKindLabel(recipe),
    ].filter(Boolean).join(" · ");
    const meta = [
      badges,
      recipe.skill ? displaySkill(recipe.skill) : "",
      recipe.level ? `level ${recipe.level}` : "",
      recipe.timeMs ? formatTime(recipe.timeMs) : "",
      stationText,
    ].filter(Boolean).join(" · ");

    body.innerHTML = `
      <span class="station-recipe-title" dir="auto">${escapeHtml(itemName(recipe.result))}${recipe.amount > 1 ? ` x${recipe.amount}` : ""}</span>
      <span class="station-recipe-meta">${escapeHtml(meta)}</span>
      <span class="station-recipe-materials">${escapeHtml(materials || "No materials")}${escapeHtml(more)}</span>
    `;

    card.appendChild(body);
    card.addEventListener("click", () => navigate({ type: "recipe", id: recipe.id }));
    return card;
  }

  function renderCookingInspector() {
    els.inspectorContent.classList.add("is-hidden");
    els.inspectorContent.classList.remove("pet-inspector-content");
    els.emptyInspector.classList.remove("is-hidden");
    const title = els.emptyInspector.querySelector("h2");
    const copy = els.emptyInspector.querySelector("p");
    if (title) title.textContent = "Select a cooking recipe";
    if (copy) copy.textContent = "Hover a recipe for the item description, or open it to inspect ingredients, stations, tools, and sell data.";
  }

  function renderPotionBrowser() {
    const activeRecipes = potionRecipes().sort(sortPotionRecipes);
    const hiddenCount = activeRecipes.filter((recipe) => recipe.hidden).length;

    els.recipeKind.textContent = "Potions";
    els.recipeTitle.textContent = "Potions";
    els.recipeDetails.innerHTML = "";
    els.recipeDetails.appendChild(pill(`${activeRecipes.length} recipes`));
    els.recipeDetails.appendChild(pill(`${hiddenCount} hidden included`));
    els.recipeDetails.appendChild(pill("Healing, buffs, searching potions, and useful medicines"));

    const panel = document.createElement("div");
    panel.className = "station-recipe-browser cooking-recipe-browser potion-recipe-browser";

    const grid = document.createElement("div");
    grid.className = "station-recipe-grid cooking-recipe-grid potion-recipe-grid";
    for (const recipe of activeRecipes) {
      grid.appendChild(renderPotionRecipeCard(recipe));
    }

    if (!activeRecipes.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note sell-empty";
      empty.textContent = "No potion or healing recipes were found in the local data.";
      grid.appendChild(empty);
    }

    panel.appendChild(grid);
    els.formulaBoard.innerHTML = "";
    els.formulaBoard.appendChild(panel);
    renderPotionInspector("recipes");
  }

  function renderPotionRecipeCard(recipe) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "station-recipe-card cooking-recipe-card potion-recipe-card";
    card.dataset.recipeId = recipe.id;
    attachItemTooltip(card, recipe.result);
    if (recipe.hidden) card.classList.add("is-hidden-recipe");
    card.appendChild(renderIcon(recipe.result));

    const body = document.createElement("span");
    body.className = "station-recipe-body";
    const materials = (recipe.materials || []).slice(0, 4).map(formatMaterialLabel).join(" · ");
    const more = (recipe.materials || []).length > 4 ? ` · +${(recipe.materials || []).length - 4} more` : "";
    const stationText = stationNames(recipe).slice(0, 3).join(", ");
    const meta = [
      potionRecipeKindLabel(recipe),
      recipe.skill ? displaySkill(recipe.skill) : "",
      recipe.level ? `level ${recipe.level}` : "",
      recipe.timeMs ? formatTime(recipe.timeMs) : "",
      stationText,
    ].filter(Boolean).join(" · ");

    body.innerHTML = `
      <span class="station-recipe-title" dir="auto">${escapeHtml(itemName(recipe.result))}${recipe.amount > 1 ? ` x${recipe.amount}` : ""}</span>
      <span class="station-recipe-meta">${escapeHtml(meta)}</span>
      <span class="station-recipe-materials">${escapeHtml(materials || "No materials")}${escapeHtml(more)}</span>
    `;

    card.appendChild(body);
    card.addEventListener("click", () => navigate({ type: "recipe", id: recipe.id }));
    return card;
  }

  function renderPotionInspector(tab = "recipes") {
    els.inspectorContent.classList.add("is-hidden");
    els.inspectorContent.classList.remove("pet-inspector-content");
    els.emptyInspector.classList.remove("is-hidden");
    const title = els.emptyInspector.querySelector("h2");
    const copy = els.emptyInspector.querySelector("p");
    if (title) title.textContent = tab === "combinations" ? "Select a combination item" : "Select a potion recipe";
    if (copy) {
      copy.textContent = tab === "combinations"
        ? "Open a cauldron item, organ, or resulting creature/item to inspect the local data."
        : "Hover a potion for its item description, or open it to inspect ingredients, stations, tools, and sell data.";
    }
  }

  function renderPoisonBrowser() {
    state.poisonTab = "weapon";
    const weaponRelatedRecipes = weaponPoisonRelatedRecipes().sort(sortPoisonRecipes);

    els.recipeKind.textContent = "Weapon Poison";
    els.recipeTitle.textContent = "Weapon Poison";
    els.recipeDetails.innerHTML = "";
    els.recipeDetails.appendChild(pill(`${weaponPoisonItemIds.filter((id) => items[id]).length} weapon poison items`));
    els.recipeDetails.appendChild(pill(`${weaponRelatedRecipes.length} related recipes`));
    els.recipeDetails.appendChild(pill("Two organ slots from local process data"));
    renderWeaponPoisonPanel(weaponRelatedRecipes);
    renderPoisonInspector("weapon");
  }

  function renderSacrificialOrganBrowser() {
    els.recipeKind.textContent = "Sacrificial Organ";
    els.recipeTitle.textContent = "Sacrificial Organ";
    els.recipeDetails.innerHTML = "";
    els.recipeDetails.appendChild(pill(`${sacrificialOrganRules.length} setup rules`));
    els.recipeDetails.appendChild(pill(`${Object.keys(weaponPoisonOrganTraits).length} organ records`));
    els.recipeDetails.appendChild(pill("One organ slot from local process data"));
    els.formulaBoard.innerHTML = "";
    els.formulaBoard.appendChild(renderSacrificialOrganPanelContent());
    renderPotionInspector("combinations");
  }

  function renderPoisonRecipeCard(recipe) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "station-recipe-card cooking-recipe-card potion-recipe-card poison-recipe-card";
    card.dataset.recipeId = recipe.id;
    attachItemTooltip(card, recipe.result);
    if (recipe.hidden) card.classList.add("is-hidden-recipe");
    card.appendChild(renderIcon(recipe.result));

    const body = document.createElement("span");
    body.className = "station-recipe-body";
    const materials = (recipe.materials || []).slice(0, 4).map(formatMaterialLabel).join(" · ");
    const more = (recipe.materials || []).length > 4 ? ` · +${(recipe.materials || []).length - 4} more` : "";
    const stationText = stationNames(recipe).slice(0, 3).join(", ");
    const description = poisonRecipeDescription(recipe);
    const statText = compactItemDetailText(recipe.result, 3);
    const meta = [
      poisonRecipeKindLabel(recipe),
      recipe.skill ? displaySkill(recipe.skill) : "",
      recipe.level ? `level ${recipe.level}` : "",
      recipe.timeMs ? formatTime(recipe.timeMs) : "",
      stationText,
    ].filter(Boolean).join(" · ");

    body.innerHTML = `
      <span class="station-recipe-title" dir="auto">${escapeHtml(itemName(recipe.result))}${recipe.amount > 1 ? ` x${recipe.amount}` : ""}</span>
      <span class="station-recipe-meta">${escapeHtml(meta)}</span>
      <span class="station-recipe-description">${escapeHtml(description)}</span>
      ${statText ? `<span class="station-recipe-details">${escapeHtml(statText)}</span>` : ""}
      <span class="station-recipe-materials">${escapeHtml(materials || "No materials")}${escapeHtml(more)}</span>
    `;

    card.appendChild(body);
    card.addEventListener("click", () => navigate({ type: "recipe", id: recipe.id }));
    return card;
  }

  function renderWeaponPoisonPanel(relatedRecipes) {
    els.formulaBoard.innerHTML = "";
    els.formulaBoard.appendChild(renderWeaponPoisonPanelContent(relatedRecipes));
  }

  function renderWeaponPoisonPanelContent(relatedRecipes) {
    const panel = document.createElement("div");
    panel.className = "poison-weapon-panel";

    const note = document.createElement("div");
    note.className = "poison-note";
    note.innerHTML = `
      <strong>Weapon Poison system</strong>
      <p>The local process data shows Weapon Poison as a Witchcraft cauldron mix with two organ slots: Empty Flask x1, two witchcraft organs, and Reagent Powder x5. The organ records below show the original values extracted from the game files.</p>
    `;
    panel.appendChild(note);

    panel.appendChild(renderWeaponPoisonFacts());
    panel.appendChild(renderWeaponPoisonMixer());

    const itemHeading = document.createElement("div");
    itemHeading.className = "poison-section-title";
    itemHeading.innerHTML = `
      <strong>Core items and modifiers</strong>
      <span>${weaponPoisonRelatedItemIds.filter((id) => items[id]).length} items</span>
    `;
    panel.appendChild(itemHeading);

    const itemGrid = document.createElement("div");
    itemGrid.className = "poison-item-grid";
    for (const itemId of weaponPoisonRelatedItemIds) {
      if (!items[itemId]) continue;
      itemGrid.appendChild(renderPoisonItemCard(itemId));
    }
    panel.appendChild(itemGrid);

    const recipeBlock = document.createElement("div");
    recipeBlock.className = "station-recipe-browser poison-related-recipes";
    const recipeHeading = document.createElement("div");
    recipeHeading.className = "poison-section-title";
    recipeHeading.innerHTML = `
      <strong>Related recipes</strong>
      <span>${relatedRecipes.length} recipes</span>
    `;
    recipeBlock.appendChild(recipeHeading);

    const recipeGrid = document.createElement("div");
    recipeGrid.className = "station-recipe-grid poison-recipe-grid";
    for (const recipe of relatedRecipes) {
      recipeGrid.appendChild(renderPoisonRecipeCard(recipe));
    }
    if (!relatedRecipes.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note sell-empty";
      empty.textContent = "No direct Weapon Poison recipe was found in the local craft/process data.";
      recipeGrid.appendChild(empty);
    }
    recipeBlock.appendChild(recipeGrid);
    panel.appendChild(recipeBlock);

    return panel;
  }

  function renderSacrificialOrganPanelContent() {
    const panel = document.createElement("div");
    panel.className = "poison-weapon-panel sacrificial-organ-panel";

    const note = document.createElement("div");
    note.className = "poison-note";
    note.innerHTML = `
      <strong>Sacrificial Organ system</strong>
      <p>The local process data shows Sacrificial Organ as a Witchcraft cauldron mix with one organ slot: one witchcraft organ, Infected Raw Hide x5, and Reagent Powder x10. The result rule comes from WTSacrificialOrganSetup.</p>
    `;
    panel.appendChild(note);

    panel.appendChild(renderSacrificialOrganFacts());
    panel.appendChild(renderSacrificialOrganMixer());

    const itemHeading = document.createElement("div");
    itemHeading.className = "poison-section-title";
    itemHeading.innerHTML = `
      <strong>Core items</strong>
      <span>${sacrificialOrganRelatedItemIds.filter((id) => items[id]).length} items</span>
    `;
    panel.appendChild(itemHeading);

    const itemGrid = document.createElement("div");
    itemGrid.className = "poison-item-grid";
    for (const itemId of sacrificialOrganRelatedItemIds) {
      if (!items[itemId]) continue;
      itemGrid.appendChild(renderPoisonItemCard(itemId));
    }
    panel.appendChild(itemGrid);

    return panel;
  }

  function renderSacrificialOrganFacts() {
    const wrap = document.createElement("div");
    wrap.className = "poison-facts-grid";
    [
      {
        title: "How to make it",
        value: "Use the Witchcrafter's cauldron",
        detail: "This is a special organ-based process, not a normal potion recipe.",
      },
      {
        title: "Required materials",
        value: "1 organ + Infected Raw Hide x5 + Reagent Powder x10",
        detail: "The organ slot decides the resulting summon/target rule.",
      },
      {
        title: "Rules extracted",
        value: `${sacrificialOrganRules.length} setup rules`,
        detail: "Rules come from WTSacrificialOrganSetup in the local game resources.",
      },
      {
        title: "Fallback",
        value: "Other organs become Cursed kobold",
        detail: "The final setup rule has no specific organ list, so it is shown as the fallback.",
      },
    ].forEach((fact) => wrap.appendChild(renderPoisonFactCard(fact)));
    return wrap;
  }

  function renderSacrificialOrganMixer() {
    const section = document.createElement("div");
    section.className = "poison-mixer sacrificial-organ-mixer";

    const componentIds = sacrificialOrganCandidateItemIds();
    const filteredIds = filterSacrificialOrganItems(componentIds);
    state.sacrificialOrganItem = normalizeSacrificialOrganSelection(state.sacrificialOrganItem);
    const selectedItemId = state.sacrificialOrganItem;

    const heading = document.createElement("div");
    heading.className = "poison-section-title";
    heading.innerHTML = `
      <strong>Organ mixer</strong>
      <span>${selectedItemId ? "1/1 selected" : "0/1 selected"}</span>
    `;
    section.appendChild(heading);

    const intro = document.createElement("div");
    intro.className = "poison-note poison-compact-note";
    intro.innerHTML = `
      <strong>Choose one organ to preview the sacrifice result</strong>
      <p>The result is matched against the original WTSacrificialOrganSetup rules. Specific organs have special outputs; all other organs use the fallback rule.</p>
    `;
    section.appendChild(intro);

    const controls = document.createElement("div");
    controls.className = "poison-mixer-controls";
    const searchLabel = document.createElement("label");
    searchLabel.className = "field";
    searchLabel.innerHTML = `
      <span>Filter organs</span>
      <input type="search" value="${escapeHtml(state.sacrificialOrganQuery)}" placeholder="Search organ or result...">
    `;
    const searchInput = searchLabel.querySelector("input");
    searchInput.addEventListener("input", () => {
      state.sacrificialOrganQuery = searchInput.value.trim();
      renderSacrificialOrganBrowser();
    });
    controls.appendChild(searchLabel);

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "secondary-action poison-mixer-clear";
    clear.textContent = "Clear mix";
    clear.disabled = !selectedItemId;
    clear.addEventListener("click", () => {
      state.sacrificialOrganItem = "";
      renderSacrificialOrganBrowser();
    });
    controls.appendChild(clear);
    section.appendChild(controls);

    section.appendChild(renderSacrificialOrganCauldronRecipe(selectedItemId));
    section.appendChild(renderSacrificialOrganResult(selectedItemId));

    const pickerTitle = document.createElement("div");
    pickerTitle.className = "poison-section-title poison-picker-title";
    pickerTitle.innerHTML = `
      <strong>Available organs/components</strong>
      <span>${filteredIds.length} shown</span>
    `;
    section.appendChild(pickerTitle);

    const picker = document.createElement("div");
    picker.className = "poison-mixer-picker";
    for (const itemId of filteredIds) picker.appendChild(renderSacrificialOrganChoice(itemId, selectedItemId === itemId));
    if (!filteredIds.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note sell-empty";
      empty.textContent = "No organs match this filter.";
      picker.appendChild(empty);
    }
    section.appendChild(picker);
    return section;
  }

  function normalizeSacrificialOrganSelection(itemId) {
    return itemId && items[itemId] ? itemId : "";
  }

  function sacrificialOrganCandidateItemIds() {
    const explicit = sacrificialOrganRules.flatMap((rule) => rule.specificOrgansOnly || []);
    return [...new Set([...Object.keys(weaponPoisonOrganTraits), ...explicit])]
      .filter((itemId) => items[itemId])
      .sort((a, b) => {
        const levelDelta = Number(weaponPoisonOrganTraits[a]?.requiredWitchcraft || 999) - Number(weaponPoisonOrganTraits[b]?.requiredWitchcraft || 999);
        if (levelDelta) return levelDelta;
        return itemName(a).localeCompare(itemName(b));
      });
  }

  function filterSacrificialOrganItems(componentIds) {
    const query = normalize(state.sacrificialOrganQuery);
    if (!query) return componentIds;
    return componentIds.filter((itemId) => {
      const rule = sacrificialRuleForOrgan(itemId);
      return [
        itemId,
        itemName(itemId),
        itemDescription(itemId),
        compactWitchcraftOrganText(itemId),
        rule?.entityId,
        rule?.entityName,
        rule?.specificOrgansOnly?.length ? "specific" : "fallback",
      ].some((value) => normalize(value).includes(query));
    });
  }

  function sacrificialRuleForOrgan(itemId) {
    const organ = weaponPoisonOrganTraits[itemId];
    const organLevel = Number(organ?.requiredWitchcraft || 0);
    const specific = sacrificialOrganRules.find((rule) =>
      (rule.specificOrgansOnly || []).includes(itemId) &&
      organLevel >= Number(rule.organMinLevel || 0)
    );
    if (specific) return specific;
    return sacrificialOrganRules.find((rule) => !(rule.specificOrgansOnly || []).length) || null;
  }

  function renderSacrificialOrganCauldronRecipe(itemId) {
    const result = evaluateSacrificialOrganMix(itemId);
    const wrap = document.createElement("div");
    wrap.className = "poison-cauldron-recipe sacrificial-cauldron-recipe";
    wrap.appendChild(renderSacrificialOrganSlot(itemId));
    wrap.appendChild(renderPoisonRecipeOperator("+"));
    wrap.appendChild(renderPoisonRecipeFixedSlot("InfectedRawHide", "Infected raw hide", "x5"));
    wrap.appendChild(renderPoisonRecipeOperator("+"));
    wrap.appendChild(renderPoisonRecipeFixedSlot("ReagentPowder", "Reagent powder", "x10"));
    wrap.appendChild(renderPoisonRecipeOperator("→", "arrow"));
    wrap.appendChild(renderSacrificialOrganResultSlot(result));
    return wrap;
  }

  function renderSacrificialOrganSlot(itemId) {
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "poison-recipe-slot poison-organ-slot";
    slot.classList.toggle("is-empty", !itemId);
    if (itemId) {
      attachWeaponPoisonOrganTooltip(slot, itemId);
      slot.appendChild(renderUntooltippedIcon(itemId));
      const text = document.createElement("span");
      text.innerHTML = `
        <strong>${escapeHtml(itemName(itemId))}</strong>
        <small>Organ slot · click to remove</small>
      `;
      slot.appendChild(text);
      slot.addEventListener("click", () => {
        state.sacrificialOrganItem = "";
        renderSacrificialOrganBrowser();
      });
    } else {
      slot.innerHTML = `
        <span class="poison-empty-icon" aria-hidden="true"></span>
        <span>
          <strong>Organ slot</strong>
          <small>Choose an organ below</small>
        </span>
      `;
    }
    return slot;
  }

  function renderSacrificialOrganResultSlot(result) {
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "poison-recipe-slot poison-result-slot";
    const entry = result.entry || creatureEntryForLocalId(result.entityId);
    slot.appendChild(renderSacrificialEntityIcon(result.entityId, result.entityName));
    const text = document.createElement("span");
    text.innerHTML = `
      <strong>${escapeHtml(result.entityName || "Unknown result")}</strong>
      <small>${escapeHtml(sacrificialResultSlotSubtitle(result, entry))}</small>
    `;
    slot.appendChild(text);
    if (entry) {
      slot.title = `Open ${entry.name}`;
      slot.addEventListener("click", () => navigate({ type: "wiki", id: entry.id }));
    } else {
      slot.disabled = true;
    }
    return slot;
  }

  function renderSacrificialOrganResult(itemId) {
    const result = evaluateSacrificialOrganMix(itemId);
    const box = document.createElement("div");
    box.className = `poison-mixer-result is-${result.status}`;

    const head = document.createElement("div");
    head.className = "poison-mixer-result-head sacrificial-result-head";
    head.appendChild(renderSacrificialEntityIcon(result.entityId, result.entityName));
    const headText = document.createElement("span");
    headText.innerHTML = `
      <small>${escapeHtml(result.statusLabel)}</small>
      <strong>${escapeHtml(result.title)}</strong>
      <em>${escapeHtml(result.subtitle)}</em>
    `;
    head.appendChild(headText);
    box.appendChild(head);

    const effects = document.createElement("div");
    effects.className = "poison-mixer-effects";
    const effectRows = result.effects.length ? result.effects : ["No organ selected yet"];
    for (const effect of effectRows) {
      const chip = document.createElement("span");
      chip.textContent = effect;
      effects.appendChild(chip);
    }
    box.appendChild(effects);

    const requirements = document.createElement("div");
    requirements.className = "poison-mixer-requirements";
    for (const row of sacrificialOrganCraftRequirements) {
      const chip = document.createElement("span");
      chip.textContent = row;
      requirements.appendChild(chip);
    }
    box.appendChild(requirements);

    if (result.traits.length) {
      const traits = document.createElement("div");
      traits.className = "poison-mixer-traits sacrificial-result-traits";
      for (const row of result.traits) {
        const trait = document.createElement("div");
        trait.className = "poison-mixer-trait";
        trait.innerHTML = `
          <small>${escapeHtml(row.label)}</small>
          <strong>${escapeHtml(row.value)}</strong>
        `;
        traits.appendChild(trait);
      }
      box.appendChild(traits);
    }

    if (result.notes.length) {
      const notes = document.createElement("ul");
      for (const note of result.notes) {
        const li = document.createElement("li");
        li.textContent = note;
        notes.appendChild(li);
      }
      box.appendChild(notes);
    }
    return box;
  }

  function evaluateSacrificialOrganMix(itemId) {
    if (!itemId) {
      return {
        status: "empty",
        statusLabel: "No mix",
        title: "Select one organ to preview a result",
        subtitle: "The output will appear here after choosing an organ.",
        entityId: "",
        entityName: "Sacrificial Organ",
        ruleLabel: "No organ selected",
        entry: null,
        effects: [],
        traits: [],
        notes: ["The local Sacrificial Organ process uses one organ slot."],
      };
    }
    const organ = weaponPoisonOrganTraits[itemId] || {};
    const rule = sacrificialRuleForOrgan(itemId);
    const specific = Boolean(rule?.specificOrgansOnly?.length);
    const classes = (rule?.entityClasses || []).join(", ") || "Any";
    const entry = creatureEntryForLocalId(rule?.entityId) || creatureEntryForName(rule?.entityName);
    const organLevel = Number(organ.requiredWitchcraft || 0);
    const minLevel = Number(rule?.organMinLevel || 0);
    const levelStatus = organLevel >= minLevel ? "Meets rule" : "Below rule minimum";
    const entryLevel = entry?.level ?? entry?.stats?.level ?? "";
    const entryHealth = entry?.stats?.health ?? "";
    const dropCount = entry?.drops?.length || 0;
    return {
      status: "known",
      statusLabel: specific ? "Specific setup rule" : "Fallback setup rule",
      title: rule?.entityName || "Unknown result",
      subtitle: `${itemName(itemId)} creates ${rule?.entityName || "Unknown result"}`,
      entityId: rule?.entityId || "",
      entityName: rule?.entityName || "Unknown result",
      ruleLabel: specific ? "Specific organ result" : "Fallback result",
      entry,
      effects: [
        specific ? "Specific organ result" : "Fallback result for unmatched organs",
        entry ? "Creature page found" : "No creature page matched",
        dropCount ? `${dropCount} known drops` : "Drops not found in wiki data",
      ],
      traits: [
        { label: "Selected organ", value: itemName(itemId) },
        { label: "Organ Witchcraft", value: organ.requiredWitchcraft ?? "unknown" },
        { label: "Rule minimum", value: rule?.organMinLevel ?? 0 },
        { label: "Level check", value: levelStatus },
        { label: "Entity class rule", value: classes },
        { label: "Result entity id", value: rule?.entityId || "Unknown" },
        { label: "Wiki creature", value: entry ? entry.name : "Not matched" },
        { label: "Creature level", value: entryLevel || "Unknown" },
        { label: "Creature health", value: entryHealth || "Unknown" },
      ],
      notes: [
        "Values are extracted from WTSacrificialOrganSetup in the local game resources.",
        specific ? "This organ has a specific sacrifice result." : "No specific rule matched, so the fallback result is shown.",
        entry ? "Click the result card in the recipe row to open the creature page." : "The result exists in the setup rule, but no matching public creature entry was found in the current wiki data.",
      ],
    };
  }

  function sacrificialResultSlotSubtitle(result, entry) {
    if (!result?.entityId) return result?.ruleLabel || "No organ selected";
    const level = entry?.level ?? entry?.stats?.level;
    const parts = [result.ruleLabel || "Sacrifice result"];
    if (level) parts.push(`Level ${level}`);
    if (entry?.drops?.length) parts.push(`${entry.drops.length} drops`);
    if (!entry) parts.push(result.entityId);
    return parts.join(" · ");
  }

  function renderSacrificialOrganChoice(itemId, selected) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "poison-mixer-choice";
    button.classList.toggle("is-selected", selected);
    attachWeaponPoisonOrganTooltip(button, itemId);
    button.appendChild(renderUntooltippedIcon(itemId));
    const rule = sacrificialRuleForOrgan(itemId);
    const organData = weaponPoisonOrganTraits[itemId];
    const sourceCount = mergedDropSources(itemId).length;
    const body = document.createElement("span");
    body.className = "poison-mixer-choice-body";
    body.innerHTML = `
      <strong>${escapeHtml(itemName(itemId))}</strong>
      <small>${escapeHtml(`Witchcraft ${organData?.requiredWitchcraft ?? "?"} · ${rule?.entityName || "Unknown result"}`)}</small>
      <em>${selected ? "selected" : sourceCount ? `${sourceCount} sources` : "source unknown"}</em>
    `;
    button.appendChild(body);
    button.addEventListener("click", () => {
      state.sacrificialOrganItem = selected ? "" : itemId;
      renderSacrificialOrganBrowser();
    });
    return button;
  }

  function creatureEntryForLocalId(entityId) {
    const normalized = normalize(entityId);
    if (!normalized) return null;
    return wikiEntries.find((entry) =>
      entry.type === "creature" &&
      (normalize(entry.localId) === normalized || normalize(entry.id) === `creature:${normalized}` || normalize(entry.name) === normalized)
    ) || wikiEntries.find((entry) => {
      if (entry.type !== "creature") return false;
      const localId = normalize(entry.localId);
      return localId && (normalized.startsWith(localId) || localId.startsWith(normalized));
    }) || null;
  }

  function creatureEntryForName(entityName) {
    const normalized = normalize(entityName);
    if (!normalized) return null;
    return wikiEntries.find((entry) => entry.type === "creature" && normalize(entry.name) === normalized) || null;
  }

  function renderSacrificialEntityIcon(entityId, entityName) {
    const entry = creatureEntryForLocalId(entityId);
    return entry ? renderWikiIcon(entry) : renderInlineImage("", entityName, initials(entityName || entityId || "SO"));
  }

  function renderWeaponPoisonFacts() {
    const wrap = document.createElement("div");
    wrap.className = "poison-facts-grid";

    const witchcraftEntry = wikiEntries.find((entry) => entry.id === "skill:Witchcraft" || normalize(entry.name) === "witchcraft");
    const poisonChargeBonus = (witchcraftEntry?.bonuses || []).find((bonus) => /weapon poison charges/i.test(bonus.name || bonus.text || ""));

    const facts = [
      {
        title: "How to make it",
        value: "Use the Witchcrafter's cauldron",
        detail: "The extracted process is a cauldron mix, not a normal craft recipe in the public recipe list.",
      },
      {
        title: "Required materials",
        value: "Empty Flask + 2 organs + Reagent Powder x5",
        detail: itemDescription("EmptyFlask") || "The flask is consumed by the weapon poison process.",
      },
      {
        title: "Organ slots",
        value: `${weaponPoisonOrganSlotCount} organs per mix`,
        detail: "The local process has two separate organ slots, so this planner limits each preview to two selected organs.",
      },
      {
        title: "Witchcraft bonus",
        value: poisonChargeBonus?.text || "+0.6% charges per level, up to +45% at level 75",
        detail: "This bonus increases the number of weapon poison charges when applying the poison.",
      },
      {
        title: "Food modifier",
        value: "Corn pie: +10% charges for 10 min",
        detail: "Corn pie increases the number of charges when applying weapon poison.",
      },
      {
        title: "Organ data",
        value: `${Object.keys(weaponPoisonOrganTraits).length} organs extracted`,
        detail: "Required Witchcraft, charges, target type, and trait values come from WTWitchcraftOrgan records in the local files.",
      },
      {
        title: "Result preview",
        value: "Original organ values",
        detail: "The planner sums the selected organ records and leaves server-side roll details unguessed.",
      },
    ];

    for (const fact of facts) wrap.appendChild(renderPoisonFactCard(fact));
    return wrap;
  }

  function renderPoisonFactCard(fact) {
    const card = document.createElement("div");
    card.className = "poison-fact-card";
    card.innerHTML = `
      <small>${escapeHtml(fact.title)}</small>
      <strong>${escapeHtml(fact.value)}</strong>
      <span>${escapeHtml(fact.detail)}</span>
    `;
    return card;
  }

  function renderWeaponPoisonMixer() {
    const section = document.createElement("div");
    section.className = "poison-mixer";

    const componentIds = weaponPoisonComponentItemIds();
    const filteredIds = filterWeaponPoisonMixerItems(componentIds);
    const selectedIds = normalizeWeaponPoisonMixerSelection(state.poisonMixerItems);
    state.poisonMixerItems = selectedIds;

    const heading = document.createElement("div");
    heading.className = "poison-section-title";
    heading.innerHTML = `
      <strong>Organ mixer</strong>
      <span>${selectedIds.length}/${weaponPoisonOrganSlotCount} selected</span>
    `;
    section.appendChild(heading);

    const intro = document.createElement("div");
    intro.className = "poison-note poison-compact-note";
    intro.innerHTML = `
      <strong>Choose exactly two organs to preview the poison result</strong>
      <p>This planner reads the original WTWitchcraftOrgan records from the local game files. The cauldron process has two organ slots, so extra selections are blocked.</p>
    `;
    section.appendChild(intro);

    const controls = document.createElement("div");
    controls.className = "poison-mixer-controls";

    const searchLabel = document.createElement("label");
    searchLabel.className = "field";
    searchLabel.innerHTML = `
      <span>Filter organs</span>
      <input type="search" value="${escapeHtml(state.poisonMixerQuery)}" placeholder="Search organ or component...">
    `;
    const searchInput = searchLabel.querySelector("input");
    searchInput.addEventListener("input", () => {
      state.poisonMixerQuery = searchInput.value.trim();
      renderPoisonBrowser();
    });
    controls.appendChild(searchLabel);

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "secondary-action poison-mixer-clear";
    clear.textContent = "Clear mix";
    clear.disabled = !selectedIds.length;
    clear.addEventListener("click", () => {
      state.poisonMixerItems = [];
      renderPoisonBrowser();
    });
    controls.appendChild(clear);
    section.appendChild(controls);

    section.appendChild(renderWeaponPoisonMixerSelection(selectedIds));
    section.appendChild(renderWeaponPoisonCauldronRecipe(selectedIds));
    section.appendChild(renderWeaponPoisonMixerResult(selectedIds));

    const pickerTitle = document.createElement("div");
    pickerTitle.className = "poison-section-title poison-picker-title";
    pickerTitle.innerHTML = `
      <strong>Available organs/components</strong>
      <span>${filteredIds.length} shown</span>
    `;
    section.appendChild(pickerTitle);

    const picker = document.createElement("div");
    picker.className = "poison-mixer-picker";
    for (const itemId of filteredIds) picker.appendChild(renderWeaponPoisonMixerChoice(itemId, selectedIds));
    if (!filteredIds.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note sell-empty";
      empty.textContent = "No organs match this filter.";
      picker.appendChild(empty);
    }
    section.appendChild(picker);
    return section;
  }

  function normalizeWeaponPoisonMixerSelection(itemIds) {
    return (itemIds || [])
      .filter((itemId) => items[itemId])
      .slice(0, weaponPoisonOrganSlotCount);
  }

  function selectedOrganCount(selectedIds, itemId) {
    return selectedIds.filter((selectedId) => selectedId === itemId).length;
  }

  function removeSelectedOrganAt(index) {
    state.poisonMixerItems = state.poisonMixerItems.filter((_, selectedIndex) => selectedIndex !== index);
    renderPoisonBrowser();
  }

  function filterWeaponPoisonMixerItems(componentIds) {
    const query = normalize(state.poisonMixerQuery);
    if (!query) return componentIds;
    return componentIds.filter((itemId) => {
      const item = items[itemId] || {};
      return [
        itemId,
        itemName(itemId),
        item.description,
        poisonItemRole(itemId),
        weaponPoisonOrganTraitSearchText(itemId),
        weaponPoisonMixerClues([itemId]).map((clue) => clue.effect).join(" "),
      ].some((value) => normalize(value).includes(query));
    });
  }

  function renderWeaponPoisonMixerSelection(selectedIds) {
    const wrap = document.createElement("div");
    wrap.className = "poison-mixer-selection";
    if (!selectedIds.length) {
      wrap.innerHTML = `<span class="poison-mixer-empty">No organs selected. Choose two organs below.</span>`;
      return wrap;
    }

    selectedIds.forEach((itemId, index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "poison-mixer-chip";
      chip.title = `Remove ${itemName(itemId)} from slot ${index + 1}`;
      attachWeaponPoisonOrganTooltip(chip, itemId);
      chip.appendChild(renderUntooltippedIcon(itemId));
      const label = document.createElement("span");
      label.textContent = `${index + 1}. ${itemName(itemId)}`;
      chip.appendChild(label);
      chip.addEventListener("click", () => {
        removeSelectedOrganAt(index);
      });
      wrap.appendChild(chip);
    });
    return wrap;
  }

  function renderWeaponPoisonCauldronRecipe(selectedIds) {
    const result = evaluateWeaponPoisonMix(selectedIds);
    const wrap = document.createElement("div");
    wrap.className = "poison-cauldron-recipe";

    wrap.appendChild(renderPoisonRecipeFixedSlot("EmptyFlask", "Bottle", "x1"));
    wrap.appendChild(renderPoisonRecipeOperator("+"));
    wrap.appendChild(renderPoisonRecipeOrganSlot(selectedIds, 0));
    wrap.appendChild(renderPoisonRecipeOperator("+"));
    wrap.appendChild(renderPoisonRecipeOrganSlot(selectedIds, 1));
    wrap.appendChild(renderPoisonRecipeOperator("+"));
    wrap.appendChild(renderPoisonRecipeFixedSlot("ReagentPowder", "Reagent powder", "x5"));
    wrap.appendChild(renderPoisonRecipeOperator("→", "arrow"));
    wrap.appendChild(renderPoisonRecipeResultSlot(result));
    return wrap;
  }

  function renderPoisonRecipeFixedSlot(itemId, label, amountLabel) {
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "poison-recipe-slot is-fixed";
    attachItemTooltip(slot, itemId);
    slot.appendChild(renderUntooltippedIcon(itemId));
    const text = document.createElement("span");
    text.innerHTML = `
      <strong>${escapeHtml(label || itemName(itemId))}</strong>
      <small>${escapeHtml(amountLabel || "")}</small>
    `;
    slot.appendChild(text);
    slot.addEventListener("click", () => navigate({ type: "item", id: itemId }));
    return slot;
  }

  function renderPoisonRecipeOrganSlot(selectedIds, index) {
    const itemId = selectedIds[index];
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "poison-recipe-slot poison-organ-slot";
    slot.classList.toggle("is-empty", !itemId);
    if (itemId) {
      attachWeaponPoisonOrganTooltip(slot, itemId);
      slot.appendChild(renderUntooltippedIcon(itemId));
      const text = document.createElement("span");
      text.innerHTML = `
        <strong>${escapeHtml(itemName(itemId))}</strong>
        <small>Organ slot ${index + 1} · click to remove</small>
      `;
      slot.appendChild(text);
      slot.addEventListener("click", () => removeSelectedOrganAt(index));
    } else {
      slot.innerHTML = `
        <span class="poison-empty-icon" aria-hidden="true"></span>
        <span>
          <strong>Organ slot ${index + 1}</strong>
          <small>Choose an organ below</small>
        </span>
      `;
    }
    return slot;
  }

  function renderPoisonRecipeResultSlot(result) {
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "poison-recipe-slot poison-result-slot";
    attachItemTooltip(slot, "WeaponPoison");
    slot.appendChild(renderUntooltippedIcon("WeaponPoison"));
    const text = document.createElement("span");
    const summary = result.effects.length ? result.effects.slice(0, 3).join(" · ") : result.title;
    text.innerHTML = `
      <strong>Weapon Poison</strong>
      <small>${escapeHtml(summary)}</small>
    `;
    slot.appendChild(text);
    slot.addEventListener("click", () => navigate({ type: "item", id: "WeaponPoison" }));
    return slot;
  }

  function renderPoisonRecipeOperator(symbol, variant) {
    const op = document.createElement("span");
    op.className = `poison-recipe-operator${variant ? ` is-${variant}` : ""}`;
    op.textContent = symbol;
    return op;
  }

  function renderWeaponPoisonMixerResult(selectedIds) {
    const result = evaluateWeaponPoisonMix(selectedIds);
    const box = document.createElement("div");
    box.className = `poison-mixer-result is-${result.status}`;

    const effects = result.effects.length
      ? result.effects.map((effect) => `<span>${escapeHtml(effect)}</span>`).join("")
      : `<span>No effect selected yet</span>`;

    const notes = result.notes.length
      ? `<ul>${result.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`
      : "";
    const traits = result.traits?.length
      ? `<div class="poison-mixer-traits">${result.traits.map((row) => `
          <div class="poison-mixer-trait">
            <small>${escapeHtml(row.label)}</small>
            <strong>${escapeHtml(row.value)}</strong>
          </div>
        `).join("")}</div>`
      : "";
    const requirements = result.requirements?.length
      ? `<div class="poison-mixer-requirements">${result.requirements.map((row) => `<span>${escapeHtml(row)}</span>`).join("")}</div>`
      : "";

    box.innerHTML = `
      <div class="poison-mixer-result-head">
        <small>${escapeHtml(result.statusLabel)}</small>
        <strong>${escapeHtml(result.title)}</strong>
      </div>
      <div class="poison-mixer-effects">${effects}</div>
      ${requirements}
      ${traits}
      ${result.charges ? `<div class="poison-mixer-charge">${escapeHtml(result.charges)}</div>` : ""}
      ${notes}
    `;
    return box;
  }

  function renderWeaponPoisonMixerChoice(itemId, selectedIds) {
    const selectedCount = selectedOrganCount(selectedIds, itemId);
    const selected = selectedCount > 0;
    const mixFull = selectedIds.length >= weaponPoisonOrganSlotCount;
    const canAdd = selectedIds.length < weaponPoisonOrganSlotCount;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "poison-mixer-choice";
    button.classList.toggle("is-selected", selected);
    button.classList.toggle("is-locked", !canAdd);
    if (!canAdd) button.setAttribute("aria-disabled", "true");
    attachWeaponPoisonOrganTooltip(button, itemId);
    button.appendChild(renderUntooltippedIcon(itemId));

    const body = document.createElement("span");
    body.className = "poison-mixer-choice-body";
    const organData = weaponPoisonOrganTraits[itemId];
    const clues = weaponPoisonMixerClues([itemId]);
    const sourceCount = mergedDropSources(itemId).length;
    const summary = organData
      ? `Witchcraft ${organData.requiredWitchcraft} · ${organData.charges} charges · ${organData.affects || "All"} · ${(organData.traits || []).map((trait) => `${trait.label} ${trait.value}`).join(" · ")}`
      : clues.map((clue) => clue.effect).join(" · ") || poisonItemRole(itemId);
    body.innerHTML = `
      <strong>${escapeHtml(itemName(itemId))}</strong>
      <small>${escapeHtml(summary)}</small>
      <em>${selected ? `selected x${selectedCount}${mixFull ? " · two slots filled" : " · click to add again"}` : mixFull ? "two organ slots filled" : sourceCount ? `${sourceCount} sources` : "source unknown"}</em>
    `;
    button.appendChild(body);
    button.addEventListener("click", () => {
      if (selectedIds.length >= weaponPoisonOrganSlotCount) {
        return;
      }
      state.poisonMixerItems = [...state.poisonMixerItems, itemId];
      renderPoisonBrowser();
    });
    return button;
  }

  function countSelectedItems(itemIds) {
    const counts = new Map();
    for (const itemId of itemIds) counts.set(itemId, (counts.get(itemId) || 0) + 1);
    return counts;
  }

  function selectedOrganCountText(itemIds) {
    return [...countSelectedItems(itemIds).entries()]
      .map(([itemId, count]) => `${itemName(itemId)}${count > 1 ? ` x${count}` : ""}`)
      .join(", ");
  }

  function aggregateWitchcraftOrganTraits(confirmed) {
    const groups = new Map();
    for (const { data } of confirmed) {
      for (const trait of data.traits || []) {
        const parsed = parseStackableTraitValue(trait.value);
        const key = parsed
          ? `${trait.label}|${parsed.prefix}|${parsed.unit}|${parsed.suffix}`
          : `${trait.label}|${trait.value}`;
        if (!groups.has(key)) {
          groups.set(key, {
            label: trait.label,
            values: [],
            parsed,
            total: 0,
            count: 0,
          });
        }
        const group = groups.get(key);
        if (parsed && group.parsed) {
          group.total += parsed.amount;
          group.count += 1;
          group.parsed.decimals = Math.max(group.parsed.decimals, parsed.decimals);
        } else {
          group.values.push(trait.value);
        }
      }
    }

    return [...groups.values()].map((group) => {
      if (group.parsed) {
        return {
          label: group.label,
          value: formatStackedTraitValue(group.parsed, group.total),
        };
      }
      return {
        label: group.label,
        value: [...new Set(group.values)].join(" + "),
      };
    });
  }

  function parseStackableTraitValue(value) {
    const text = String(value || "").trim().replace(/\s+/g, " ");
    const multiplier = text.match(/^x\s*([+-]?\d+(?:\.\d+)?)\s*(.*)$/i);
    if (multiplier) {
      return {
        prefix: "x",
        amount: Number(multiplier[1]),
        unit: "",
        suffix: multiplier[2].trim(),
        decimals: decimalPlaces(multiplier[1]),
      };
    }
    const numeric = text.match(/^([+-]?)(\d+(?:\.\d+)?)\s*(%)?\s*(.*)$/);
    if (!numeric) return null;
    return {
      prefix: numeric[1] || "",
      amount: Number(numeric[2]),
      unit: numeric[3] || "",
      suffix: numeric[4].trim(),
      decimals: decimalPlaces(numeric[2]),
    };
  }

  function decimalPlaces(value) {
    const match = String(value).match(/\.(\d+)/);
    return match ? match[1].length : 0;
  }

  function formatStackedTraitValue(parsed, total) {
    const decimals = parsed.decimals ? Math.min(parsed.decimals, 2) : 0;
    const rounded = Number(total.toFixed(decimals || 2));
    const number = decimals ? rounded.toFixed(decimals).replace(/\.?0+$/, "") : String(Math.round(rounded));
    const suffix = parsed.suffix ? ` ${parsed.suffix}` : "";
    if (parsed.prefix === "x") return `x${number}${suffix}`;
    return `${parsed.prefix}${number}${parsed.unit}${suffix}`;
  }

  function evaluateWeaponPoisonMix(selectedIds) {
    if (!selectedIds.length) {
      return {
        status: "empty",
        statusLabel: "No mix",
        title: "Select two organs to preview a result",
        effects: [],
        charges: "",
        requirements: weaponPoisonCraftRequirements,
        traits: [],
        notes: ["The local Weapon Poison process uses exactly two organ slots."],
      };
    }

    const slotReady = selectedIds.length === weaponPoisonOrganSlotCount;
    const missingSlots = Math.max(0, weaponPoisonOrganSlotCount - selectedIds.length);
    const slotNote = slotReady
      ? "Both organ slots are filled."
      : `Select ${missingSlots} more organ${missingSlots === 1 ? "" : "s"} to match the cauldron process.`;
    const allCthulhu = selectedIds.every((itemId) => cthulhuPoisonComponentIds.has(itemId));
    const hasCthulhu = selectedIds.some((itemId) => cthulhuPoisonComponentIds.has(itemId));
    const confirmed = selectedIds
      .map((itemId) => ({ itemId, data: weaponPoisonOrganTraits[itemId] }))
      .filter((row) => row.data);
    const unknownSelected = selectedIds.filter((itemId) => !weaponPoisonOrganTraits[itemId] && !cthulhuPoisonComponentIds.has(itemId));
    const clues = weaponPoisonMixerClues(selectedIds);

    if (confirmed.length) {
      const allConfirmed = confirmed.length === selectedIds.length;
      const requirementRows = [
        selectedOrganCountText(selectedIds) ? `Selected organs: ${selectedOrganCountText(selectedIds)}` : "",
        `Required Witchcraft: ${Math.max(...confirmed.map(({ data }) => Number(data.requiredWitchcraft || 0)))}`,
        ...confirmed.flatMap(({ data }) => data.success ? [`Success ${data.success}`] : []),
      ].filter(Boolean);
      const affects = [...new Set(confirmed.map(({ data }) => data.affects).filter(Boolean))];
      const traitRows = [
        affects.length ? { label: "Affects on", value: affects.join(" · ") } : null,
        ...aggregateWitchcraftOrganTraits(confirmed),
      ].filter(Boolean);
      const chargeTotal = confirmed.reduce((sum, row) => sum + Number(row.data.charges || 0), 0);
      return {
        status: allConfirmed && slotReady ? "known" : "partial",
        statusLabel: allConfirmed ? "Original organ data" : "Partially original data",
        title: slotReady
          ? allConfirmed ? "Weapon poison contribution preview" : "Mixed original and unverified organs"
          : "One organ selected, choose the second slot",
        effects: [...new Set(traitRows.filter((row) => row.label !== "Affects on").map((row) => row.label))],
        charges: `${slotReady ? "Selected organ charge total" : "Selected organ charge so far"}: ${chargeTotal}.`,
        requirements: [...weaponPoisonCraftRequirements, ...new Set(requirementRows)],
        traits: traitRows,
        notes: [
          slotNote,
          "Values are extracted from WTWitchcraftOrgan in the local game resources.",
          ...(unknownSelected.length ? [`Unverified selected organs: ${unknownSelected.map(itemName).join(", ")}.`] : []),
          ...(allConfirmed ? [] : ["Only the original organ records above have exact numeric values right now."]),
        ],
      };
    }

    if (allCthulhu) {
      return {
        status: slotReady ? "known" : "partial",
        statusLabel: "Known charge group",
        title: slotReady ? "Cthulhu organ weapon poison" : "One Cthulhu organ selected",
        effects: ["Weapon poison", "Cthulhu organ group"],
        charges: "Base charges: 220 before Witchcraft level and Corn pie bonuses.",
        requirements: weaponPoisonCraftRequirements,
        traits: [],
        notes: [
          slotNote,
          "This is the only organ group with a confirmed charge value found so far.",
          "Exact poison damage or secondary effect is not exposed in the current local files.",
        ],
      };
    }

    if (hasCthulhu) {
      return {
        status: "partial",
        statusLabel: "Partially known",
        title: "Cthulhu organ mixed with other components",
        effects: ["Weapon poison", ...clues.map((clue) => clue.effect)],
        charges: "Cthulhu-only poison is confirmed at 220 base charges; mixed-organ charge output is not confirmed.",
        requirements: weaponPoisonCraftRequirements,
        traits: [],
        notes: [
          slotNote,
          "The current dataset does not confirm how Cthulhu organs behave when mixed with non-Cthulhu organs.",
          "Use this as a verification target inside the in-game Witchcraft window.",
        ],
      };
    }

    if (clues.length) {
      return {
        status: "partial",
        statusLabel: "Effect clue only",
        title: "Unverified organ effect clues",
        effects: clues.map((clue) => clue.effect),
        charges: "",
        requirements: weaponPoisonCraftRequirements,
        traits: [],
        notes: [
          slotNote,
          "These clues come from organ names and official examples of possible poison effects.",
          "The exact mix result is not confirmed in the extracted local data.",
        ],
      };
    }

    return {
      status: "unknown",
      statusLabel: "Unknown mix",
      title: "No confirmed effect mapping found",
      effects: ["Weapon poison component"],
      charges: "",
      requirements: weaponPoisonCraftRequirements,
      traits: [],
      notes: [
        slotNote,
        "These organs are marked as valid cauldron components, but their output effect is not present in the current files.",
        "A screenshot from the in-game Witchcraft organ journal would let us fill this rule accurately.",
      ],
    };
  }

  function weaponPoisonOrganTraitSearchText(itemId) {
    const data = weaponPoisonOrganTraits[itemId];
    if (!data) return "";
    return [
      data.requiredWitchcraft,
      itemName(data.requiredItem),
      data.success,
      data.affects,
      data.charges,
      ...(data.traits || []).flatMap((trait) => [trait.label, trait.value]),
      data.note,
    ].join(" ");
  }

  function weaponPoisonMixerClues(itemIds) {
    const text = itemIds.map((itemId) => `${itemId} ${itemName(itemId)} ${itemDescription(itemId)}`).join(" ");
    const clues = [];
    const add = (effect, reason) => {
      if (!clues.some((clue) => clue.effect === effect)) clues.push({ effect, reason });
    };
    if (/\b(frost|cold|ice)\b/i.test(text)) add("Chilling clue", "Official notes mention chilling as a weapon poison effect.");
    if (/\b(vampire|blood|ghoul|living flesh|heart)\b/i.test(text)) add("Life-stealing clue", "Official notes mention life-stealing as a weapon poison property.");
    if (/\b(snake|viper|scorpion|spider|mucus|fang|gland|poison)\b/i.test(text)) add("Toxic/poison clue", "The selected organ name suggests a poison theme.");
    if (/\b(fire|blazing|demon)\b/i.test(text)) add("Burning clue", "Official notes mention chilling is incompatible with burning, so burning-style poisons may exist.");
    return clues;
  }

  function renderPoisonItemCard(itemId) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "poison-item-card";
    attachItemTooltip(card, itemId);
    card.appendChild(renderIcon(itemId));

    const body = document.createElement("span");
    body.className = "poison-item-body";
    const description = itemDescriptionWithFallback(itemId);
    const stats = compactWitchcraftOrganText(itemId) || compactItemDetailText(itemId, 4);
    const produced = recipesByResult.get(itemId)?.length || 0;
    const used = usageByItem.get(itemId)?.length || 0;
    const sources = mergedDropSources(itemId).length;
    body.innerHTML = `
      <strong dir="auto">${escapeHtml(itemName(itemId))}</strong>
      <small>${escapeHtml(poisonItemRole(itemId))}</small>
      <span>${escapeHtml(description)}</span>
      ${stats ? `<em>${escapeHtml(stats)}</em>` : ""}
      <small>recipes: ${produced} create · ${used} use · ${sources} known sources</small>
    `;
    card.appendChild(body);
    card.addEventListener("click", () => navigate({ type: "item", id: itemId }));
    return card;
  }

  function renderPoisonInspector(tab) {
    els.inspectorContent.classList.add("is-hidden");
    els.inspectorContent.classList.remove("pet-inspector-content");
    els.emptyInspector.classList.remove("is-hidden");
    const title = els.emptyInspector.querySelector("h2");
    const copy = els.emptyInspector.querySelector("p");
    if (title) title.textContent = tab === "weapon" ? "Select a poison item" : "Select a poison recipe";
    if (copy) {
      copy.textContent = tab === "weapon"
        ? "Open a Weapon Poison item to see its full local description, sources, uses, stats, and prices."
        : "Hover a poison for its item description, or open it to inspect ingredients, stations, tools, and sources.";
    }
  }

  function renderSellCalculatorPanel() {
    const panel = document.createElement("div");
    panel.className = "sell-calculator";

    const bestNote = document.createElement("div");
    bestNote.className = "sell-best-note";
    bestNote.textContent = "Each item is priced with the highest paying buyer found in the local game data.";
    panel.appendChild(bestNote);

    const list = document.createElement("div");
    list.className = "sell-list";
    const rows = state.sellItems.filter((row) => isItemSellable(row.itemId));
    let total = 0;

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note sell-empty";
      empty.textContent = "No items selected.";
      list.appendChild(empty);
    }

    for (const row of rows) {
      const item = itemRecord(row.itemId);
      const quote = buyUpQuote(row.itemId, row.quantity, "best");
      total += quote.payout;

      const card = document.createElement("div");
      card.className = "sell-row";
      card.appendChild(renderIcon(row.itemId));

      const body = document.createElement("div");
      body.className = "sell-row-body";
      body.innerHTML = `
        <strong dir="auto">${escapeHtml(item.name)}</strong>
        <small>${escapeHtml(quote.buyer?.name || "Buyer")} · ${escapeHtml(formatPercent(quote.percent))}${quote.special ? " · special" : " · usual"} · base ${formatCurrencyHtml(quote.base)}</small>
      `;

      const qty = document.createElement("input");
      qty.type = "number";
      qty.min = "0";
      qty.step = "1";
      qty.value = String(row.quantity);
      qty.className = "sell-qty";
      qty.setAttribute("aria-label", `${item.name} quantity`);
      let quantityTimer = null;
      qty.addEventListener("input", () => {
        window.clearTimeout(quantityTimer);
        quantityTimer = window.setTimeout(() => {
          updateSellItemQuantity(row.itemId, qty.value);
          renderSellCalculator();
        }, 180);
      });
      qty.addEventListener("change", () => {
        window.clearTimeout(quantityTimer);
        updateSellItemQuantity(row.itemId, qty.value);
        renderSellCalculator();
      });

      const payout = document.createElement("div");
      payout.className = "sell-payout";
      payout.innerHTML = `
        <span>Payout</span>
        <strong>${formatCurrencyHtml(quote.payout)}</strong>
      `;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-command sell-remove";
      remove.title = "Remove";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        removeSellItem(row.itemId);
        renderSellCalculator();
        renderSearchResults();
      });

      body.appendChild(qty);
      card.append(body, payout, remove);
      list.appendChild(card);
    }

    panel.appendChild(list);

    const totalRow = document.createElement("div");
    totalRow.className = "sell-total";
    totalRow.innerHTML = `
      <span>Total payout</span>
      <strong>${formatCurrencyHtml(total)}</strong>
    `;
    panel.appendChild(totalRow);

    els.formulaBoard.innerHTML = "";
    els.formulaBoard.appendChild(panel);
  }

  function renderGoldGoblinPanel() {
    const panel = document.createElement("div");
    panel.className = "gold-goblin";

    const toolbar = document.createElement("div");
    toolbar.className = "gold-toolbar";

    const modes = document.createElement("div");
    modes.className = "gold-mode-tabs";
    [
      ["recommended", "Recommended"],
      ["profit", "Profit"],
      ["easy", "Easy"],
      ["fast", "Fast"],
    ].forEach(([id, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gold-mode";
      button.textContent = label;
      button.classList.toggle("is-active", state.goldGoblinMode === id);
      button.addEventListener("click", () => {
        state.goldGoblinMode = id;
        renderGoldGoblinPanel();
      });
      modes.appendChild(button);
    });

    const candidates = goldGoblinCandidates();
    const summary = document.createElement("div");
    summary.className = "gold-summary";
    summary.innerHTML = `<strong>${candidates.length}</strong><span>routes</span>`;
    toolbar.append(modes, summary);
    panel.appendChild(toolbar);

    const list = document.createElement("div");
    list.className = "gold-list";

    if (!candidates.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note sell-empty";
      empty.textContent = "No profitable craft routes found from the current local data.";
      list.appendChild(empty);
    }

    for (const candidate of candidates.slice(0, 40)) {
      list.appendChild(renderGoldGoblinCard(candidate));
    }

    panel.appendChild(list);
    els.formulaBoard.innerHTML = "";
    els.formulaBoard.appendChild(panel);
  }

  function renderGoldGoblinCard(candidate) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "gold-card";
    card.appendChild(renderIcon(candidate.itemId));

    const body = document.createElement("span");
    body.className = "gold-card-body";
    const materialPreview = candidate.materials
      .slice(0, 4)
      .map((material) => `${escapeHtml(itemName(material.item))} x${escapeHtml(String(material.quantity))}`)
      .join(" · ");
    const moreMaterials = candidate.materials.length > 4 ? ` · +${candidate.materials.length - 4} more` : "";
    const station = candidate.stationNames.length ? candidate.stationNames.join(", ") : "No station";
    const recipeMeta = [
      recipeKindLabel(candidate.recipe.kind),
      candidate.skill ? displaySkill(candidate.skill) : "",
      candidate.level ? `level ${candidate.level}` : "",
      candidate.timeLabel,
      station,
    ].filter(Boolean).join(" · ");

    body.innerHTML = `
      <span class="gold-title" dir="auto">${escapeHtml(candidate.name)}${candidate.amount > 1 ? ` x${candidate.amount}` : ""}</span>
      <span class="gold-meta">${escapeHtml(recipeMeta)}</span>
      <span class="gold-materials">${materialPreview || "No materials"}${escapeHtml(moreMaterials)}</span>
      <span class="gold-reasons">${candidate.reasons.map(escapeHtml).join(" · ")}</span>
    `;

    const metrics = document.createElement("span");
    metrics.className = "gold-metrics";
    metrics.innerHTML = `
      <span class="gold-metric"><em>Payout</em><strong>${formatCurrencyHtml(candidate.payout)}</strong></span>
      <span class="gold-metric"><em>Est. profit</em><strong>${formatCurrencyHtml(candidate.profit)}</strong></span>
      <span class="gold-metric"><em>Buyer</em><strong>${escapeHtml(candidate.buyerName)}</strong></span>
      <span class="gold-metric"><em>Ease</em><strong>${candidate.ease}</strong></span>
    `;

    card.append(body, metrics);
    card.addEventListener("click", () => {
      navigate({ type: "recipe", id: candidate.recipe.id });
    });
    return card;
  }

  function goldGoblinCandidates() {
    return recipes
      .map(buildGoldGoblinCandidate)
      .filter(Boolean)
      .sort(sortGoldGoblinCandidates);
  }

  function buildGoldGoblinCandidate(recipe) {
    if (!recipe || !recipe.result || recipe.hidden || recipe.purchaseLock) return null;
    if (recipe.kind !== "craft" && recipe.kind !== "process") return null;
    if (!isItemSellable(recipe.result)) return null;

    const materials = (recipe.materials || [])
      .filter((material) => material.item)
      .map((material) => ({
        ...material,
        quantity: normalizeMaterialQuantity(material),
      }))
      .filter((material) => material.quantity > 0);
    if (!materials.length) return null;

    const amount = normalizeSellQuantity(recipe.amount || 1) || 1;
    const quote = buyUpQuote(recipe.result, amount, "best");
    if (quote.raw <= 0) return null;

    let materialCostRaw = 0;
    let unknownMaterials = 0;
    let totalMaterialQty = 0;
    for (const material of materials) {
      totalMaterialQty += material.quantity;
      if (isItemSellable(material.item)) {
        materialCostRaw += buyUpQuote(material.item, material.quantity, "best").raw;
      } else {
        unknownMaterials += 1;
      }
    }

    const level = Number(recipe.level) || 0;
    const timeMs = Number(recipe.timeMs) || 0;
    const timeMinutes = timeMs > 0 ? timeMs / 60000 : 0;
    const stationCount = recipe.stations?.length || 0;
    const difficulty = 1 +
      (materials.length * 2) +
      (Math.log2(totalMaterialQty + 1) * 1.4) +
      (level * 0.9) +
      Math.min(timeMinutes / 4, 6) +
      (stationCount * 0.8) +
      (unknownMaterials * 6);
    const profitRaw = quote.raw - materialCostRaw;
    const scoreBase = profitRaw > 0 ? profitRaw * (unknownMaterials ? 0.45 : 1) : 0;
    if (scoreBase <= 0) return null;
    const ease = Math.max(1, Math.round(100 / difficulty));
    const lowLevelBoost = 1 / (1 + (level / 18));
    const confidenceBoost = unknownMaterials ? 0.75 : 1;
    const score = Math.log10(scoreBase + 1) * ease * lowLevelBoost * confidenceBoost;

    const reasons = [];
    if (level <= 10) reasons.push("low level");
    if (materials.length <= 3) reasons.push("few materials");
    if (timeMs > 0 && timeMs <= 60000) reasons.push("fast craft");
    if (quote.special) reasons.push(`${quote.buyer?.name || "Buyer"} special`);
    if (unknownMaterials) reasons.push(`${unknownMaterials} material values unknown`);
    if (!reasons.length) reasons.push("steady buyer value");

    return {
      recipe,
      itemId: recipe.result,
      name: itemName(recipe.result),
      amount,
      payout: quote.payout,
      profit: Math.max(0, Math.floor(scoreBase + 0.000001)),
      score,
      ease,
      buyerName: quote.buyer?.name || "Buyer",
      level,
      skill: recipe.skill,
      timeMs,
      timeLabel: formatTime(timeMs),
      materials,
      materialCostRaw,
      unknownMaterials,
      stationNames: stationNames(recipe),
      reasons: reasons.slice(0, 4),
    };
  }

  function sortGoldGoblinCandidates(a, b) {
    if (state.goldGoblinMode === "profit") {
      return (b.profit - a.profit) || (b.payout - a.payout) || a.name.localeCompare(b.name);
    }
    if (state.goldGoblinMode === "easy") {
      return (b.ease - a.ease) || (b.score - a.score) || a.name.localeCompare(b.name);
    }
    if (state.goldGoblinMode === "fast") {
      return ((a.timeMs || Infinity) - (b.timeMs || Infinity)) || (b.score - a.score) || a.name.localeCompare(b.name);
    }
    return (b.score - a.score) || (b.profit - a.profit) || a.name.localeCompare(b.name);
  }

  function normalizeMaterialQuantity(material) {
    const quantity = parsePriceValue(material.amountMax || material.amount || 1);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  }

  function renderRecipe(recipe, highlightedItem) {
    if (!recipe) return;

    els.recipeKind.textContent = recipeKindHeader(recipe.kind);
    els.recipeTitle.textContent = itemName(recipe.result);
    els.recipeDetails.innerHTML = "";
    els.recipeDetails.appendChild(pill(recipeContext(recipe)));
    if (recipe.processName) els.recipeDetails.appendChild(pill(`process: ${recipe.processName}`));
    if (recipe.skill) els.recipeDetails.appendChild(pill(`${displaySkill(recipe.skill)} · level ${recipe.level || 0}`));
    if (recipe.timeMs) els.recipeDetails.appendChild(pill(`time ${formatTime(recipe.timeMs)}`));
    if (recipe.fuels?.length) els.recipeDetails.appendChild(pill(`fuel options: ${recipe.fuels.map(formatMaterialLabel).slice(0, 4).join(", ")}`));
    const requirementStrip = renderRecipeRequirementStrip(recipe);
    if (requirementStrip) els.recipeDetails.appendChild(requirementStrip);
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

  function renderStationButtons(stations) {
    const strip = document.createElement("div");
    strip.className = "station-link-strip";
    for (const stationId of uniqueStationIds({ stations })) {
      strip.appendChild(renderStationButton(stationId));
    }
    return strip;
  }

  function renderStationButton(stationId, options = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "station-chip";
    button.title = `Show recipes crafted at ${itemName(stationId)}`;
    button.setAttribute("aria-label", `Show recipes crafted at ${itemName(stationId)}`);
    button.appendChild(renderIcon(stationId));

    const text = document.createElement("span");
    text.dir = "auto";
    text.textContent = options.showKind ? `Station · ${itemName(stationId)}` : itemName(stationId);
    button.appendChild(text);
    button.addEventListener("click", () => navigate({ type: "station", id: stationId }));
    return button;
  }

  function renderRecipeRequirementStrip(recipe) {
    const strip = document.createElement("div");
    strip.className = "recipe-requirement-strip";
    let count = 0;

    for (const stationId of uniqueStationIds(recipe)) {
      strip.appendChild(renderStationButton(stationId, { showKind: true }));
      count += 1;
    }

    if (recipe.toolRequired) {
      strip.appendChild(renderToolButton(recipe.toolRequired, { showKind: true }));
      count += 1;
    }

    for (const requirementId of recipe.bonusesRequired || []) {
      strip.appendChild(renderRequirementButton(requirementId));
      count += 1;
    }

    return count ? strip : null;
  }

  function renderStationRecipes(stationId) {
    const list = (recipesByStation.get(stationId) || []).slice().sort(sortRecipes);
    els.recipeKind.textContent = "Station";
    els.recipeTitle.textContent = itemName(stationId);
    els.recipeDetails.innerHTML = "";
    els.recipeDetails.appendChild(renderStationButtons([{ name: stationId }]));
    els.recipeDetails.appendChild(pill(`${list.length} recipes crafted here`));

    const panel = document.createElement("div");
    panel.className = "station-recipe-browser";

    const grid = document.createElement("div");
    grid.className = "station-recipe-grid";
    const limited = list.slice(0, 160);

    for (const recipe of limited) {
      grid.appendChild(renderStationRecipeCard(recipe));
    }

    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note sell-empty";
      empty.textContent = "No recipes were found for this station in the local data.";
      grid.appendChild(empty);
    } else if (list.length > limited.length) {
      const more = document.createElement("div");
      more.className = "empty-note sell-empty";
      more.textContent = `Showing the first ${limited.length} of ${list.length}. Use search to narrow the list.`;
      grid.appendChild(more);
    }

    panel.appendChild(grid);
    els.formulaBoard.innerHTML = "";
    els.formulaBoard.appendChild(panel);
  }

  function renderStationRecipeCard(recipe) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "station-recipe-card";
    card.appendChild(renderIcon(recipe.result));

    const body = document.createElement("span");
    body.className = "station-recipe-body";
    const materials = (recipe.materials || []).slice(0, 4).map(formatMaterialLabel).join(" · ");
    const more = (recipe.materials || []).length > 4 ? ` · +${(recipe.materials || []).length - 4} more` : "";
    const meta = [
      recipeKindLabel(recipe.kind),
      recipe.skill ? displaySkill(recipe.skill) : "",
      recipe.level ? `level ${recipe.level}` : "",
      recipe.timeMs ? formatTime(recipe.timeMs) : "",
    ].filter(Boolean).join(" · ");
    body.innerHTML = `
      <span class="station-recipe-title" dir="auto">${escapeHtml(itemName(recipe.result))}${recipe.amount > 1 ? ` x${recipe.amount}` : ""}</span>
      <span class="station-recipe-meta">${escapeHtml(meta)}</span>
      <span class="station-recipe-materials">${escapeHtml(materials || "No materials")}${escapeHtml(more)}</span>
    `;

    card.appendChild(body);
    card.addEventListener("click", () => navigate({ type: "recipe", id: recipe.id }));
    return card;
  }

  function renderToolButtons(toolIds) {
    const strip = document.createElement("div");
    strip.className = "tool-link-strip";
    const seen = new Set();
    for (const toolId of toolIds || []) {
      if (!toolId || seen.has(toolId)) continue;
      seen.add(toolId);
      strip.appendChild(renderToolButton(toolId));
    }
    return strip;
  }

  function renderToolButton(toolId, options = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tool-chip";
    button.title = `Show recipes requiring ${itemName(toolId)}`;
    button.setAttribute("aria-label", `Show recipes requiring ${itemName(toolId)}`);
    button.appendChild(renderToolIcon(toolId));

    const text = document.createElement("span");
    text.dir = "auto";
    text.textContent = options.showKind ? `Tool · ${itemName(toolId)}` : itemName(toolId);
    button.appendChild(text);
    button.addEventListener("click", () => navigate({ type: "tool", id: toolId }));
    return button;
  }

  function renderToolRecipes(toolId) {
    const list = (recipesByTool.get(toolId) || []).slice().sort(sortRecipes);
    els.recipeKind.textContent = "Tool";
    els.recipeTitle.textContent = itemName(toolId);
    els.recipeDetails.innerHTML = "";
    els.recipeDetails.appendChild(renderToolButtons([toolId]));
    els.recipeDetails.appendChild(pill(`${list.length} recipes require this tool`));

    const panel = document.createElement("div");
    panel.className = "station-recipe-browser tool-recipe-browser";

    const grid = document.createElement("div");
    grid.className = "station-recipe-grid";
    const limited = list.slice(0, 160);

    for (const recipe of limited) {
      grid.appendChild(renderStationRecipeCard(recipe));
    }

    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note sell-empty";
      empty.textContent = "No recipes were found for this tool in the local data.";
      grid.appendChild(empty);
    } else if (list.length > limited.length) {
      const more = document.createElement("div");
      more.className = "empty-note sell-empty";
      more.textContent = `Showing the first ${limited.length} of ${list.length}. Use search to narrow the list.`;
      grid.appendChild(more);
    }

    panel.appendChild(grid);
    els.formulaBoard.innerHTML = "";
    els.formulaBoard.appendChild(panel);
  }

  function renderRequirementButton(requirementId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "requirement-chip";
    button.title = `Show recipes requiring ${itemName(requirementId)}`;
    button.setAttribute("aria-label", `Show recipes requiring ${itemName(requirementId)}`);
    button.appendChild(renderIcon(requirementId));

    const text = document.createElement("span");
    text.dir = "auto";
    text.textContent = `Required · ${itemName(requirementId)}`;
    button.appendChild(text);
    button.addEventListener("click", () => navigate({ type: "requirement", id: requirementId }));
    return button;
  }

  function renderRequirementRecipes(requirementId) {
    const list = (recipesByRequirement.get(requirementId) || []).slice().sort(sortRecipes);
    els.recipeKind.textContent = "Requirement";
    els.recipeTitle.textContent = itemName(requirementId);
    els.recipeDetails.innerHTML = "";
    els.recipeDetails.appendChild(renderRequirementButton(requirementId));
    els.recipeDetails.appendChild(pill(`${list.length} recipes require this item or building`));

    const panel = document.createElement("div");
    panel.className = "station-recipe-browser requirement-recipe-browser";

    const grid = document.createElement("div");
    grid.className = "station-recipe-grid";
    const limited = list.slice(0, 160);

    for (const recipe of limited) {
      grid.appendChild(renderStationRecipeCard(recipe));
    }

    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note sell-empty";
      empty.textContent = "No recipes were found for this requirement in the local data.";
      grid.appendChild(empty);
    } else if (list.length > limited.length) {
      const more = document.createElement("div");
      more.className = "empty-note sell-empty";
      more.textContent = `Showing the first ${limited.length} of ${list.length}. Use search to narrow the list.`;
      grid.appendChild(more);
    }

    panel.appendChild(grid);
    els.formulaBoard.innerHTML = "";
    els.formulaBoard.appendChild(panel);
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

    if (entry.type === "creature") {
      article.appendChild(renderCreatureOverview(entry));
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

    if (entry.type === "farming") {
      const farmingBlock = renderFarmingOverview(entry);
      if (farmingBlock) article.appendChild(farmingBlock);
    }

    if (entry.type === "pet") {
      const petBlock = renderPetOverview(entry);
      if (petBlock) article.appendChild(petBlock);
    }

    if (entry.type === "area") {
      const mapRegions = renderMapRegions(entry);
      if (mapRegions) article.appendChild(mapRegions);
      const mapFish = renderMapFishGrid(entry.fish);
      if (mapFish) article.appendChild(mapFish);
      const mapMonsters = renderMapEntityGrid("Monsters", entry.monsters, "creature");
      if (mapMonsters) article.appendChild(mapMonsters);
      const mapSpecialMonsters = renderMapSpecialMonsters(entry.specialMonsters);
      if (mapSpecialMonsters) article.appendChild(mapSpecialMonsters);
      const mapNpcs = renderMapEntityGrid("NPCs", entry.npcs, "shop");
      if (mapNpcs) article.appendChild(mapNpcs);
    }

    if (entry.type === "creature") {
      const abilitiesBlock = renderMonsterAbilities(entry);
      if (abilitiesBlock) article.appendChild(abilitiesBlock);
      const dropsBlock = renderMonsterDrops(entry);
      if (dropsBlock) article.appendChild(dropsBlock);
    }

    if (entry.type === "fish") {
      const butcherBlock = renderFishButcheringYields(entry);
      if (butcherBlock) article.appendChild(butcherBlock);
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
      if (entry.type === "shop" && isShopItemsTable(table)) {
        article.appendChild(renderShopItemsTable(table));
      } else {
        article.appendChild(renderWikiTable(table));
      }
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
    } else if (entry.type === "pet") {
      renderPetInspector(entry, (entry.pets || [])[0], 1);
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

  function renderCreatureOverview(entry) {
    const block = sectionBlock("Monster overview");
    const wrap = document.createElement("div");
    wrap.className = "wiki-overview-card";
    const icon = renderWikiIcon(entry, "large");
    icon.classList.add("wiki-overview-icon");
    wrap.appendChild(icon);

    const details = document.createElement("div");
    details.className = "wiki-overview-body";
    const rows = [
      ["Level", entry.level || entry.stats?.level || ""],
      ["Found in", (entry.lists || []).find((list) => list.title === "Found in")?.items?.slice(0, 2).join(", ") || ""],
      ["Drops", entry.drops?.length ? `${entry.drops.length} known` : ""],
      ["Skills", entry.abilities?.length ? `${entry.abilities.length} listed` : ""],
    ].filter(([, value]) => value);
    details.innerHTML = rows.map(([label, value]) => `
      <span>
        <small>${escapeHtml(label)}</small>
        <strong>${escapeHtml(value)}</strong>
      </span>
    `).join("");
    wrap.appendChild(details);
    block.appendChild(wrap);
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
      const entry = item.id ? wikiEntriesById.get(item.id) : null;
      card.appendChild(entry ? renderWikiIcon(entry) : renderInlineImage(item.image, item.name, fallbackType === "shop" ? "NPC" : "MO"));
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

  function renderMapSpecialMonsters(entries) {
    const list = entries || [];
    if (!list.length) return null;

    const block = sectionBlock("Special monsters", list.length);
    const grid = document.createElement("div");
    grid.className = "special-monster-grid";

    for (const item of list.slice(0, 120)) {
      const card = document.createElement("div");
      card.className = "special-monster-card";

      const header = document.createElement(item.id && wikiEntriesById.has(item.id) ? "button" : "div");
      header.className = "map-entity-card special-monster-head";
      if (header.tagName === "BUTTON") {
        header.type = "button";
        header.addEventListener("click", () => navigate({ type: "wiki", id: item.id }));
      }

      const entry = item.id ? wikiEntriesById.get(item.id) : null;
      header.appendChild(entry ? renderWikiIcon(entry) : renderInlineImage(item.image, item.name, "SM"));

      const body = document.createElement("span");
      const sources = (item.sources || []).slice(0, 3).join(", ");
      const meta = [
        item.level ? `level ${item.level}` : "",
        sources,
      ].filter(Boolean).join(" · ");
      body.innerHTML = `
        <strong dir="auto">${escapeHtml(item.name)}</strong>
        <small>${escapeHtml(meta || cleanupPublicText(item.summary || "Special monster"))}</small>
      `;
      header.appendChild(body);
      card.appendChild(header);

      const drops = item.drops || [];
      const dropRow = document.createElement("div");
      dropRow.className = "special-monster-drops";
      if (drops.length) {
        for (const drop of drops.slice(0, 6)) {
          const dropChip = document.createElement(items[drop.itemId] ? "button" : "span");
          dropChip.className = "special-drop-chip";
          const label = [drop.name, drop.amount ? `x${drop.amount}` : "", drop.chance].filter(Boolean).join(" · ");
          dropChip.title = label;
          dropChip.setAttribute("aria-label", label);
          if (dropChip.tagName === "BUTTON") {
            dropChip.type = "button";
            dropChip.addEventListener("click", () => navigate({ type: "item", id: drop.itemId }));
          }
          dropChip.appendChild(items[drop.itemId] ? renderIcon(drop.itemId) : renderInlineImage(drop.icon, drop.name, initials(drop.name)));
          dropRow.appendChild(dropChip);
        }
        if (drops.length > 6) {
          const more = document.createElement("span");
          more.className = "special-drop-more";
          more.textContent = `+${drops.length - 6}`;
          dropRow.appendChild(more);
        }
      } else {
        const empty = document.createElement("span");
        empty.className = "special-drop-empty";
        empty.textContent = "No drops listed";
        dropRow.appendChild(empty);
      }
      card.appendChild(dropRow);
      grid.appendChild(card);
    }

    if (list.length > 120) {
      const more = document.createElement("div");
      more.className = "empty-note";
      more.textContent = `Showing the first 120 of ${list.length}. Use search to narrow the list.`;
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
    const mapEntry = (entry.type === "creature" || entry.type === "fish") && list.title === "Found in"
      ? mapEntryForLabel(item)
      : null;
    const linkedItemId = entry.type === "fish" && list.title === "Baits"
      ? itemIdForLabel(item)
      : null;

    if (linkedItemId) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "wiki-chip wiki-chip-button wiki-item-chip";
      chip.title = `Open ${itemName(linkedItemId)}`;
      chip.appendChild(renderIcon(linkedItemId));
      const label = document.createElement("span");
      label.textContent = item;
      chip.appendChild(label);
      chip.addEventListener("click", () => navigate({ type: "item", id: linkedItemId }));
      return chip;
    }

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

  function itemIdForLabel(label) {
    const key = normalize(label);
    if (itemsByLookup.has(key)) return itemsByLookup.get(key);
    const compact = key.replace(/\s+/g, "");
    if (itemsByLookup.has(compact)) return itemsByLookup.get(compact);
    return "";
  }

  function mapEntryForLabel(label) {
    const full = normalize(label);
    if (mapEntriesByLookup.has(full)) return mapEntriesByLookup.get(full);

    const primary = mapNameFromLocation(label);
    const primaryKey = normalize(primary);
    if (mapEntriesByLookup.has(primaryKey)) return mapEntriesByLookup.get(primaryKey);

    for (const entry of wikiEntries) {
      if (entry.type !== "area") continue;
      const key = normalize(entry.name);
      if (full.startsWith(`${key} `) || full.includes(` ${key} `)) return entry;
    }
    return null;
  }

  function mapNameFromLocation(label) {
    return String(label || "").split("·")[0].trim();
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

  function renderFishButcheringYields(entry) {
    const fishItemId = entry.itemId || String(entry.id || "").replace(/^fish:/, "");
    const yields = fishButcheringYieldsByFish.get(fishItemId) || [];
    if (!yields.length) return null;

    const block = sectionBlock("Butchering yields", yields.length);
    const grid = document.createElement("div");
    grid.className = "monster-drop-grid fish-yield-grid";
    for (const yieldItem of yields) {
      const card = document.createElement(items[yieldItem.itemId] ? "button" : "div");
      if (card.tagName === "BUTTON") {
        card.type = "button";
        card.addEventListener("click", () => navigate({ type: "item", id: yieldItem.itemId }));
      }
      card.className = "monster-drop-card fish-yield-card";
      card.appendChild(items[yieldItem.itemId] ? renderIcon(yieldItem.itemId) : renderInlineImage(yieldItem.icon, yieldItem.name, initials(yieldItem.name)));
      const meta = [
        yieldItem.kind || "Butchering",
        yieldItem.amount ? `x${yieldItem.amount}` : "",
        yieldItem.chance || "",
        yieldItem.level ? `level ${yieldItem.level}` : "",
      ].filter(Boolean).join(" · ");
      const body = document.createElement("span");
      body.innerHTML = `
        <strong>${escapeHtml(yieldItem.name)}</strong>
        <small>${escapeHtml(meta)}</small>
      `;
      card.appendChild(body);
      grid.appendChild(card);
    }
    block.appendChild(grid);
    return block;
  }

  function renderFarmingOverview(entry) {
    const fragment = document.createDocumentFragment();
    const crops = entry.crops || [];
    const fertilizers = entry.fertilizers || [];
    const tools = entry.tools || [];
    const cropCards = [];
    const updateCropCards = (fertilizer) => {
      for (const { card, crop } of cropCards) {
        updateCropCardFertilizer(card, crop, fertilizer);
      }
    };

    const planner = renderFertilizerPlanner(fertilizers, updateCropCards);
    if (planner) fragment.appendChild(planner);

    if (crops.length) {
      const block = sectionBlock("Plantable crops", crops.length);
      const grid = document.createElement("div");
      grid.className = "farming-grid";
      for (const crop of crops) {
        const card = renderCropCard(crop);
        cropCards.push({ card, crop });
        grid.appendChild(card);
      }
      block.appendChild(grid);
      fragment.appendChild(block);
    }

    if (fertilizers.length) {
      const block = sectionBlock("Fertilizers", fertilizers.length);
      const grid = document.createElement("div");
      grid.className = "farming-grid fertilizer-grid";
      for (const fertilizer of fertilizers) {
        grid.appendChild(renderFertilizerCard(fertilizer));
      }
      block.appendChild(grid);
      fragment.appendChild(block);
    }

    if (tools.length) {
      const block = sectionBlock("Farming tools", tools.length);
      const grid = document.createElement("div");
      grid.className = "farming-grid farming-tool-grid";
      for (const tool of tools) {
        grid.appendChild(renderFarmingToolCard(tool));
      }
      block.appendChild(grid);
      fragment.appendChild(block);
    }

    return fragment;
  }

  function renderFertilizerPlanner(fertilizers, onChange) {
    if (!fertilizers.length) return null;

    const block = sectionBlock("Fertilizer planner");
    const wrap = document.createElement("div");
    wrap.className = "planner-card fertilizer-planner";

    const controls = document.createElement("div");
    controls.className = "planner-controls";

    const fertilizerOptions = [noFertilizerOption(), ...fertilizers];
    const fertilizerDropdown = createPlannerDropdown(
      "Fertilizer",
      fertilizerOptions,
      (fertilizer) => fertilizer.id,
      (fertilizer) => fertilizer.name,
    );
    controls.append(fertilizerDropdown.root);
    wrap.appendChild(controls);

    const status = document.createElement("div");
    status.className = "planner-result fertilizer-planner-status";
    wrap.appendChild(status);

    const update = () => {
      const selected = fertilizerOptions.find((item) => item.id === fertilizerDropdown.value()) || fertilizerOptions[0];
      const activeFertilizer = selected.isNoFertilizer ? null : selected;
      status.innerHTML = fertilizerPlannerStatusHtml(activeFertilizer);
      onChange?.(activeFertilizer);
    };

    fertilizerDropdown.onChange(update);
    update();

    block.appendChild(wrap);
    return block;
  }

  function noFertilizerOption() {
    return {
      id: "__no_fertilizer__",
      name: "No fertilizer",
      isNoFertilizer: true,
      speed: 1,
      gather: 1,
      seeds: 1,
      seedLevel: 0,
      selectChance: 0,
    };
  }

  function createPlannerDropdown(label, entries, getValue, getLabel) {
    const root = document.createElement("div");
    root.className = "planner-dropdown";
    const labelEl = document.createElement("span");
    labelEl.className = "planner-dropdown-label";
    labelEl.textContent = label;
    root.appendChild(labelEl);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "planner-dropdown-button";
    button.setAttribute("aria-expanded", "false");
    const buttonText = document.createElement("span");
    const caret = document.createElement("span");
    caret.className = "planner-dropdown-caret";
    caret.textContent = "v";
    button.append(buttonText, caret);
    root.appendChild(button);

    const menu = document.createElement("div");
    menu.className = "planner-dropdown-menu";
    menu.setAttribute("role", "listbox");
    root.appendChild(menu);

    const handlers = [];
    const optionButtons = [];
    let selectedValue = entries.length ? getValue(entries[0]) : "";

    const close = () => {
      root.classList.remove("is-open");
      button.setAttribute("aria-expanded", "false");
    };
    const setValue = (value, silent = false) => {
      selectedValue = value;
      const current = entries.find((entry) => getValue(entry) === selectedValue) || entries[0];
      buttonText.textContent = current ? getLabel(current) : "Choose";
      for (const option of optionButtons) {
        const active = option.dataset.value === selectedValue;
        option.classList.toggle("is-active", active);
        option.setAttribute("aria-selected", active ? "true" : "false");
      }
      if (!silent) handlers.forEach((handler) => handler(selectedValue));
    };

    for (const entry of entries) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "planner-dropdown-option";
      option.dataset.value = getValue(entry);
      option.setAttribute("role", "option");
      option.textContent = getLabel(entry);
      option.addEventListener("click", () => {
        setValue(option.dataset.value);
        close();
      });
      optionButtons.push(option);
      menu.appendChild(option);
    }

    button.addEventListener("click", () => {
      const willOpen = !root.classList.contains("is-open");
      const panel = root.closest(".planner-card") || document;
      for (const dropdown of panel.querySelectorAll(".planner-dropdown.is-open")) {
        if (dropdown !== root) {
          dropdown.classList.remove("is-open");
          dropdown.querySelector(".planner-dropdown-button")?.setAttribute("aria-expanded", "false");
        }
      }
      root.classList.toggle("is-open", willOpen);
      button.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });

    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
        button.focus();
      }
    });
    root.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (!root.contains(document.activeElement)) close();
      }, 0);
    });

    setValue(selectedValue, true);
    return {
      root,
      value: () => selectedValue,
      onChange: (handler) => handlers.push(handler),
    };
  }

  function fertilizerPlannerStatusHtml(fertilizer) {
    if (!fertilizer) {
      return `
        <div class="planner-summary">
          ${renderInlineDataIcon("", "No fertilizer")}
          <span>
            <strong>No fertilizer</strong>
            <small>Plantable crops show their normal grow time, harvest, and seed return values.</small>
          </span>
        </div>
      `;
    }
    return `
      <div class="planner-summary">
        ${renderInlineDataIcon(fertilizer.icon, fertilizer.name)}
        <span>
          <strong>${escapeHtml(fertilizer.name)}</strong>
          <small>Adjusted grow time, harvest, and seed return are applied below.</small>
        </span>
      </div>
    `;
  }

  function renderCropCard(crop) {
    const card = document.createElement("div");
    card.className = "farming-card crop-card";

    const head = document.createElement("div");
    head.className = "farming-card-head";
    head.appendChild(renderInlineImage(crop.image, crop.name, "CR"));
    const title = document.createElement("span");
    title.innerHTML = `
      <strong>${escapeHtml(crop.name)}</strong>
      <small>${escapeHtml(crop.level ? `Agriculture level ${crop.level}` : "Agriculture crop")}</small>
    `;
    head.appendChild(title);
    card.appendChild(head);

    const summary = document.createElement("div");
    summary.className = "crop-summary-grid";
    summary.innerHTML = `
      <span><small>Agriculture lvl</small><strong>${escapeHtml(crop.level ? String(crop.level) : "Unknown")}</strong></span>
      <span><small>Grow time</small><strong class="crop-speed-value">Unknown</strong></span>
      <span><small>Harvest amount</small><strong class="crop-harvest-value">Unknown</strong></span>
      <span><small>Seed yield</small><strong class="crop-seed-value">Unknown</strong></span>
    `;
    card.appendChild(summary);

    const note = document.createElement("div");
    note.className = "crop-fertilizer-note";
    note.innerHTML = `
      <strong class="crop-fertilizer-name">No fertilizer</strong>
      <small class="crop-fertilizer-meta">Normal values from local files · ${(crop.sizes || []).map(plotSizeShortLabel).join(", ") || "local data"}</small>
    `;
    card.appendChild(note);

    card.appendChild(renderCropYieldSection("Plant with", crop.seeds || [], "No seed row found", "Seed or sprout"));
    card.appendChild(renderCropYieldSection("Harvest result", crop.harvest || [], "No harvest row found", "Harvest output", { role: "harvest" }));
    if ((crop.seedYields || []).length) {
      card.appendChild(renderCropYieldSection("Seed return", crop.seedYields || [], "No seed yield row found", "Seed yield", { role: "seed-yield" }));
    }
    updateCropCardFertilizer(card, crop, null);
    return card;
  }

  function updateCropCardFertilizer(card, crop, fertilizer) {
    const active = Boolean(fertilizer);
    card.classList.toggle("has-fertilizer", active);

    const name = card.querySelector(".crop-fertilizer-name");
    const meta = card.querySelector(".crop-fertilizer-meta");
    const speedValue = card.querySelector(".crop-speed-value");
    const harvestValue = card.querySelector(".crop-harvest-value");
    const seedValue = card.querySelector(".crop-seed-value");
    if (name) name.textContent = active ? fertilizer.name : "No fertilizer";
    if (meta) {
      const normalGrowTime = summarizeCropGrowthTime(crop, 1);
      const currentGrowTime = summarizeCropGrowthTime(crop, active ? fertilizer.speed : 1);
      const parts = active
        ? [
            `Normal grow time ${normalGrowTime}`,
            currentGrowTime !== normalGrowTime ? `Adjusted ${currentGrowTime}` : "",
            `Seed level ${signedNumberOrZero(fertilizer.seedLevel)}`,
            `Species chance ${signedNumberOrZero(fertilizer.selectChance)}`,
          ]
        : [
            `Grow time ${currentGrowTime}`,
            "Normal values from local files",
            (crop.sizes || []).map(plotSizeShortLabel).join(", ") || "local data",
          ];
      meta.textContent = parts.filter(Boolean).join(" · ");
    }
    if (speedValue) speedValue.textContent = summarizeCropGrowthTime(crop, active ? fertilizer.speed : 1);
    if (harvestValue) harvestValue.textContent = summarizeCropAmounts(crop.harvest || [], active ? fertilizer.gather : 1);
    if (seedValue) seedValue.textContent = summarizeCropAmounts(crop.seedYields || [], active ? fertilizer.seeds : 1);

    updateCropYieldSection(card, "harvest", crop.harvest || [], "No harvest row found", "Harvest output", active ? fertilizer.gather : 1);
    updateCropYieldSection(card, "seed-yield", crop.seedYields || [], "No seed yield row found", "Seed yield", active ? fertilizer.seeds : 1);
  }

  function renderFertilizerCard(fertilizer) {
    const card = document.createElement("div");
    card.className = "farming-card fertilizer-card";

    const head = document.createElement("button");
    head.type = "button";
    head.className = "farming-card-head farming-card-button";
    if (fertilizer.itemId && items[fertilizer.itemId]) {
      head.addEventListener("click", () => navigate({ type: "item", id: fertilizer.itemId }));
    }
    head.appendChild(fertilizer.itemId && items[fertilizer.itemId]
      ? renderIcon(fertilizer.itemId)
      : renderInlineImage(fertilizer.icon, fertilizer.name, "FT"));
    const title = document.createElement("span");
    title.innerHTML = `
      <strong>${escapeHtml(fertilizer.name)}</strong>
      <small class="fertilizer-description">${escapeHtml(cleanupPublicText(fertilizer.description || "Fertilizer"))}</small>
    `;
    head.appendChild(title);
    card.appendChild(head);

    const stats = document.createElement("div");
    stats.className = "fertilizer-effect-list";
    stats.innerHTML = renderFertilizerEffectsHtml(fertilizer, "");
    card.appendChild(stats);
    return card;
  }

  function renderFertilizerEffectsHtml(fertilizer, className) {
    const rows = [
      ["Growth speed", multiplierValueText(fertilizer.speed)],
      ["Harvest amount", multiplierValueText(fertilizer.gather)],
      ["Seed yield", multiplierValueText(fertilizer.seeds)],
      ["Seed level", `${signedNumberOrZero(fertilizer.seedLevel)} levels`],
      ["Species chance", signedNumberOrZero(fertilizer.selectChance)],
    ].map(([label, value]) => `
      <span class="fertilizer-effect-row">
        <small>${escapeHtml(label)}</small>
        <strong>${escapeHtml(value)}</strong>
      </span>
    `).join("");
    return className ? `<div class="${escapeHtml(className)} fertilizer-effect-list">${rows}</div>` : rows;
  }

  function renderCropYieldSection(label, rows, emptyText, fallbackMeta, options = {}) {
    const section = document.createElement("div");
    section.className = "crop-yield-section";
    if (options.role) section.dataset.cropYieldRole = options.role;
    const title = document.createElement("small");
    title.textContent = label;
    section.appendChild(title);

    const list = document.createElement("div");
    list.className = "crop-yield-list";
    populateCropYieldList(list, rows, emptyText, fallbackMeta);
    section.appendChild(list);
    return section;
  }

  function updateCropYieldSection(card, role, rows, emptyText, fallbackMeta, multiplier) {
    const section = card.querySelector(`[data-crop-yield-role="${role}"]`);
    if (!section) return;
    const list = section.querySelector(".crop-yield-list");
    if (!list) return;
    populateCropYieldList(list, adjustedCropRows(rows, multiplier), emptyText, fallbackMeta);
  }

  function populateCropYieldList(list, rows, emptyText, fallbackMeta) {
    list.innerHTML = "";
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "micro-copy";
      empty.textContent = emptyText;
      list.appendChild(empty);
    } else {
      for (const row of rows.slice(0, 12)) {
        list.appendChild(renderCropYieldRow(row, fallbackMeta));
      }
    }
  }

  function adjustedCropRows(rows, multiplier) {
    const value = Number(multiplier);
    if (!Number.isFinite(value) || Math.abs(value - 1) < 0.0001) return rows || [];
    return (rows || []).map((row) => ({
      ...row,
      amount: multiplyAmount(row.amount, value),
      baseAmount: row.amount,
    }));
  }

  function summarizeCropGrowthTime(crop, speed = 1) {
    const multiplier = Number(speed);
    const safeMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
    const seconds = (crop.growth || [])
      .map((row) => Number(row.seconds))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!seconds.length) return "Unknown";
    const labels = Array.from(new Set(seconds.map((value) => formatCropDuration(value / safeMultiplier)).filter(Boolean)));
    return labels.join(" / ") || "Unknown";
  }

  function formatCropDuration(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return "";
    const roundedSeconds = value >= 60
      ? Math.max(60, Math.round(value / 60) * 60)
      : Math.max(1, Math.round(value));
    return formatTime(roundedSeconds * 1000);
  }

  function summarizeCropAmounts(rows, multiplier = 1) {
    const values = adjustedCropRows(rows || [], multiplier)
      .map((row) => row.amount ? `x${row.amount}` : "")
      .filter(Boolean);
    const unique = Array.from(new Set(values));
    return unique.length ? unique.join(" / ") : "No return";
  }

  function renderCropYieldRow(item, fallbackMeta) {
    const hasItem = item.itemId && items[item.itemId];
    const row = document.createElement(hasItem ? "button" : "div");
    row.className = "crop-yield-row";
    if (hasItem) {
      row.type = "button";
      row.title = `Open ${itemName(item.itemId)}`;
      row.addEventListener("click", () => navigate({ type: "item", id: item.itemId }));
      row.appendChild(renderIcon(item.itemId));
    } else {
      row.appendChild(renderInlineImage(item.icon, item.name, initials(item.name)));
    }

    const body = document.createElement("span");
    const meta = [
      item.size ? plotSizeLabel(item.size) : "",
      item.chance ? `${formatCompactNumber(item.chance)}% chance` : "",
      item.baseAmount && item.baseAmount !== item.amount ? `normal x${item.baseAmount}` : "",
    ].filter(Boolean).join(" · ");
    body.innerHTML = `
      <strong>${escapeHtml(item.name || item.itemId || "Item")}</strong>
      <small>${escapeHtml(meta || fallbackMeta || "Farming item")}</small>
    `;
    row.appendChild(body);

    const amount = document.createElement("em");
    amount.className = "crop-yield-amount";
    amount.textContent = item.amount ? `x${item.amount}` : "";
    row.appendChild(amount);
    return row;
  }

  function renderFarmingToolCard(tool) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "farming-card farming-tool-card";
    card.addEventListener("click", () => navigate({ type: "item", id: tool.itemId }));
    card.appendChild(renderIcon(tool.itemId));
    const body = document.createElement("span");
    body.innerHTML = `
      <strong>${escapeHtml(tool.name)}</strong>
      <small>${escapeHtml(tool.role || "Farming tool")}</small>
      <em>${escapeHtml(tool.recipeUses ? `${tool.recipeUses} local recipe links` : "Useful farming item")}</em>
    `;
    card.appendChild(body);
    return card;
  }

  function renderPetOverview(entry) {
    const fragment = document.createDocumentFragment();
    const pets = entry.pets || [];
    const homeAnimals = entry.homeAnimals || [];
    const buildings = entry.animalBuildings || [];

    if (pets.length) {
      const block = sectionBlock("Pet level planner", pets.length);
      const wrap = document.createElement("div");
      wrap.className = "planner-card pet-planner";
      const maxLevel = Math.max(...pets.map((pet) => Number(pet.levels?.maxLevel || 1)));
      wrap.innerHTML = `
        <div class="pet-level-control">
          <label>
            <span>Pet level</span>
            <input class="pet-level-number" type="number" min="1" max="${maxLevel}" value="1">
          </label>
          <input class="pet-level-range" type="range" min="1" max="${maxLevel}" value="1">
          <p>Cards show each pet capped at its own max level.</p>
        </div>
      `;
      const grid = document.createElement("div");
      grid.className = "pet-grid";
      let selectedPet = pets[0];
      let selectedCard = null;
      let requestedLevel = 1;
      const renderSelectedPet = () => {
        renderPetInspector(entry, selectedPet, requestedLevel);
      };
      const selectPet = (pet, card) => {
        selectedPet = pet;
        if (selectedCard) selectedCard.classList.remove("is-selected");
        selectedCard = card;
        selectedCard.classList.add("is-selected");
        renderSelectedPet();
      };
      for (const pet of pets) {
        const card = renderPetCard(pet, selectPet);
        grid.appendChild(card);
        if (pet === selectedPet) selectedCard = card;
      }
      wrap.appendChild(grid);
      const numberInput = wrap.querySelector(".pet-level-number");
      const rangeInput = wrap.querySelector(".pet-level-range");
      const update = (value) => {
        const level = clamp(Number(value) || 1, 1, maxLevel);
        requestedLevel = level;
        numberInput.value = level;
        rangeInput.value = level;
        updatePetLevelStats(wrap, level);
        renderSelectedPet();
      };
      numberInput.addEventListener("input", () => update(numberInput.value));
      rangeInput.addEventListener("input", () => update(rangeInput.value));
      if (selectedCard) selectedCard.classList.add("is-selected");
      update(1);
      block.appendChild(wrap);
      fragment.appendChild(block);
    }

    if (homeAnimals.length) {
      const block = sectionBlock("Home animals", homeAnimals.length);
      const grid = document.createElement("div");
      grid.className = "pet-grid home-animal-grid";
      for (const animal of homeAnimals) {
        grid.appendChild(renderHomeAnimalCard(animal));
      }
      block.appendChild(grid);
      fragment.appendChild(block);
    }

    if (buildings.length) {
      const block = sectionBlock("Animal buildings", buildings.length);
      const grid = document.createElement("div");
      grid.className = "pet-grid animal-building-grid";
      for (const building of buildings) {
        grid.appendChild(renderAnimalBuildingCard(building));
      }
      block.appendChild(grid);
      fragment.appendChild(block);
    }

    return fragment;
  }

  function renderPetCard(pet, onSelect) {
    const card = document.createElement("div");
    card.className = "pet-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Show ${pet.name} details`);
    card.dataset.petMaxLevel = pet.levels?.maxLevel || 1;
    card.dataset.healthBase = pet.levels?.health?.base || 0;
    card.dataset.healthMax = pet.levels?.health?.max || 0;
    card.dataset.minDamageBase = pet.levels?.minDamage?.base || 0;
    card.dataset.minDamageMax = pet.levels?.minDamage?.max || 0;
    card.dataset.maxDamageBase = pet.levels?.maxDamage?.base || 0;
    card.dataset.maxDamageMax = pet.levels?.maxDamage?.max || 0;
    const choose = (event) => {
      if (event?.target instanceof Element && event.target.closest("button, a, input, select, textarea")) return;
      onSelect?.(pet, card, true);
    };
    card.addEventListener("click", choose);
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onSelect?.(pet, card, true);
    });

    const head = document.createElement("div");
    head.className = "pet-card-head";
    const icon = pet.itemId && items[pet.itemId] ? renderIcon(pet.itemId) : renderInlineImage(pet.icon, pet.name, "PT");
    head.appendChild(icon);
    const title = document.createElement("span");
    const meta = [
      pet.tameLevel ? `tame ${pet.tameLevel}` : "",
      pet.untamable ? "special obtain" : pet.obtain || "",
    ].filter(Boolean).join(" · ");
    title.innerHTML = `
      <strong>${escapeHtml(pet.name)}</strong>
      <small>${escapeHtml(meta || "Pet")}</small>
    `;
    head.appendChild(title);
    card.appendChild(head);

    const stats = document.createElement("div");
    stats.className = "pet-stat-list";
    stats.innerHTML = `
      <span><small class="pet-level-caption">level 1</small><strong class="pet-health-value">0</strong><em>health</em></span>
      <span><small>damage</small><strong class="pet-damage-value">0-0</strong><em>min-max</em></span>
      <span><small>max level</small><strong>${escapeHtml(pet.levels?.maxLevel || "")}</strong><em>${escapeHtml(pet.levels?.perkCount ? `${pet.levels.perkCount} perks` : "base")}</em></span>
    `;
    card.appendChild(stats);

    const feed = document.createElement("div");
    feed.className = "pet-feed-row";
    if (pet.feedItem && items[pet.feedItem]) {
      feed.appendChild(renderDataItemChip({ itemId: pet.feedItem, name: pet.feedName }, "pet-feed-chip"));
    } else {
      const chip = document.createElement("span");
      chip.className = "wiki-chip";
      chip.textContent = pet.untamable ? "No tame feed" : "No feed listed";
      feed.appendChild(chip);
    }
    card.appendChild(feed);
    return card;
  }

  function renderHomeAnimalCard(animal) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "pet-card home-animal-card";
    card.addEventListener("click", () => navigate({ type: "item", id: animal.itemId }));
    card.appendChild(renderIcon(animal.itemId));
    const body = document.createElement("span");
    body.innerHTML = `
      <strong>${escapeHtml(animal.name)}</strong>
      <small>${escapeHtml(cleanupPublicText(animal.description || "Home animal"))}</small>
    `;
    card.appendChild(body);
    return card;
  }

  function renderAnimalBuildingCard(building) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "pet-card animal-building-card";
    card.addEventListener("click", () => {
      if (building.recipeId && recipesById.has(building.recipeId)) {
        navigate({ type: "recipe", id: building.recipeId });
      } else {
        navigate({ type: "item", id: building.itemId });
      }
    });
    card.appendChild(renderIcon(building.itemId));
    const body = document.createElement("span");
    const meta = [building.skill, building.tool ? `Tool: ${itemName(building.tool)}` : ""].filter(Boolean).join(" · ");
    body.innerHTML = `
      <strong>${escapeHtml(building.name)}</strong>
      <small>${escapeHtml(meta || "Animal husbandry")}</small>
    `;
    card.appendChild(body);
    return card;
  }

  function renderItemChipRow(label, rows) {
    const wrap = document.createElement("div");
    wrap.className = "farming-chip-row";
    const title = document.createElement("small");
    title.textContent = label;
    wrap.appendChild(title);
    const chips = document.createElement("div");
    chips.className = "wiki-list compact-chip-list";
    for (const row of rows.slice(0, 8)) {
      chips.appendChild(renderDataItemChip(row));
    }
    if (!rows.length) {
      const empty = document.createElement("span");
      empty.className = "wiki-chip";
      empty.textContent = "No local row";
      chips.appendChild(empty);
    }
    wrap.appendChild(chips);
    return wrap;
  }

  function renderDataItemChip(item, className) {
    const hasItem = item.itemId && items[item.itemId];
    const chip = document.createElement(hasItem ? "button" : "span");
    chip.className = `wiki-chip wiki-item-chip ${className || ""}`.trim();
    if (hasItem) {
      chip.type = "button";
      chip.title = `Open ${itemName(item.itemId)}`;
      chip.addEventListener("click", () => navigate({ type: "item", id: item.itemId }));
      chip.appendChild(renderIcon(item.itemId));
    } else {
      chip.appendChild(renderInlineImage(item.icon, item.name, initials(item.name)));
    }
    const label = document.createElement("span");
    const amount = item.amount ? ` x${item.amount}` : "";
    label.textContent = `${item.name || item.itemId || "Item"}${amount}`;
    chip.appendChild(label);
    return chip;
  }

  function renderInlineDataIcon(src, alt) {
    if (!src) return `<span class="item-icon"><span class="fallback-icon">${escapeHtml(initials(alt))}</span></span>`;
    return `<span class="item-icon"><img alt="" loading="lazy" src="${escapeHtml(src)}"></span>`;
  }

  function plotSizeLabel(size) {
    if (size === "single") return "Single plot";
    if (size === "2x2") return "2x2 plot";
    if (size === "6x2") return "6x2 field";
    return size || "Local data";
  }

  function plotSizeShortLabel(size) {
    if (size === "single") return "Single";
    if (size === "2x2") return "2x2";
    if (size === "6x2") return "6x2";
    return size || "Local data";
  }

  function multiplierText(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || !number) return "no data";
    if (Math.abs(number - 1) < 0.0001) return "no change";
    const label = number > 1 ? "increase" : "decrease";
    return `x${formatCompactNumber(number)} ${label}`;
  }

  function multiplierValueText(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || !number) return "no data";
    return `x${formatCompactNumber(number)}`;
  }

  function signedNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || Math.abs(number) < 0.0001) return "";
    return `${number > 0 ? "+" : ""}${formatCompactNumber(number)}`;
  }

  function signedNumberOrZero(value) {
    return signedNumber(value) || "0";
  }

  function formatCompactNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    if (Math.abs(number - Math.round(number)) < 0.0001) return String(Math.round(number));
    return String(Number(number.toFixed(2)));
  }

  function estimateFertilizedRows(rows, multiplier) {
    const number = Number(multiplier);
    if (!rows.length || !Number.isFinite(number)) return "";
    return rows.slice(0, 4).map((row) => {
      const amount = multiplyAmount(row.amount, number);
      const size = row.size ? `${plotSizeLabel(row.size)}: ` : "";
      return `${size}${row.name}${amount ? ` x${amount}` : ""}`;
    }).join(", ");
  }

  function multiplyAmount(amount, multiplier) {
    const text = String(amount || "");
    const match = text.match(/^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/);
    if (!match) return text;
    const min = Math.max(0, Number(match[1]) * multiplier);
    const max = match[2] ? Math.max(0, Number(match[2]) * multiplier) : null;
    const first = formatCompactNumber(min);
    return max === null ? first : `${first}-${formatCompactNumber(max)}`;
  }

  function updatePetLevelStats(root, requestedLevel) {
    for (const card of root.querySelectorAll(".pet-card[data-pet-max-level]")) {
      const maxLevel = Number(card.dataset.petMaxLevel) || 1;
      const level = clamp(requestedLevel, 1, maxLevel);
      const health = statAtLevel(card.dataset.healthBase, card.dataset.healthMax, level, maxLevel);
      const minDamage = statAtLevel(card.dataset.minDamageBase, card.dataset.minDamageMax, level, maxLevel);
      const maxDamage = statAtLevel(card.dataset.maxDamageBase, card.dataset.maxDamageMax, level, maxLevel);
      const caption = card.querySelector(".pet-level-caption");
      const healthValue = card.querySelector(".pet-health-value");
      const damageValue = card.querySelector(".pet-damage-value");
      if (caption) caption.textContent = `level ${level}/${maxLevel}`;
      if (healthValue) healthValue.textContent = formatPetStat(health);
      if (damageValue) damageValue.textContent = `${formatPetStat(minDamage)}-${formatPetStat(maxDamage)}`;
    }
  }

  function statAtLevel(baseValue, maxValue, level, maxLevel) {
    const baseNumber = Number(baseValue) || 0;
    const maxNumber = Number(maxValue) || baseNumber;
    if (maxLevel <= 1) return baseNumber;
    const ratio = (level - 1) / (maxLevel - 1);
    return baseNumber + (maxNumber - baseNumber) * ratio;
  }

  function petTooltipHtml(pet, requestedLevel) {
    const levels = pet.levels || {};
    const maxLevel = Number(levels.maxLevel) || 1;
    const level = clamp(Number(requestedLevel) || 1, 1, maxLevel);
    const health = statAtLevel(levels.health?.base, levels.health?.max, level, maxLevel);
    const minDamage = statAtLevel(levels.minDamage?.base, levels.minDamage?.max, level, maxLevel);
    const maxDamage = statAtLevel(levels.maxDamage?.base, levels.maxDamage?.max, level, maxLevel);
    const facts = [
      ["Time to use", pet.useTime ? formatTime(Number(pet.useTime) * 1000) : ""],
      ["Drop on death", pet.dontDropOnDeath ? "No" : pet.removeOnDeath ? "Removed" : "Yes"],
      ["Slot", pet.slot || "Pet"],
      ["Level", `${formatCompactNumber(level)} / ${formatCompactNumber(maxLevel)}`],
      ["Obtain", pet.obtain || ""],
      ["Taming level", pet.tameLevel || ""],
      ["Feed", pet.feedName || ""],
      ["Fear on catch", pet.fearOnCatch || ""],
      ["Revive price", pet.revivePrice || ""],
      ["Health", formatPetStat(health)],
      ["Damage", `${formatPetStat(minDamage)}-${formatPetStat(maxDamage)}`],
    ].filter(([, value]) => value !== "" && value !== null && value !== undefined);
    const perks = (levels.perks || []).filter((perk) => (perk.details || []).length);

    return `
      <div class="pet-tooltip-card">
        <div class="pet-tooltip-head">
          ${renderInlineDataIcon(pet.icon, pet.name)}
          <span>
            <strong>${escapeHtml(pet.name)}</strong>
            <small>${escapeHtml(pet.itemId || pet.id || "Pet")}</small>
          </span>
        </div>
        ${facts.length ? `
          <dl class="pet-tooltip-facts">
            ${facts.map(([label, value]) => `
              <div>
                <dt>${escapeHtml(label)}</dt>
                <dd>${escapeHtml(value)}</dd>
              </div>
            `).join("")}
          </dl>
        ` : ""}
        ${perks.length ? `
          <div class="pet-tooltip-section">
            <h4>Abilities by levels</h4>
            <ul class="pet-tooltip-perks">
              ${perks.map((perk) => `
                <li>
                  <b>${escapeHtml(String(perk.level || "?"))}</b>
                  <span>
                    ${(perk.details || []).map((detail) => `<em>${escapeHtml(detail)}</em>`).join("")}
                  </span>
                </li>
              `).join("")}
            </ul>
          </div>
        ` : ""}
        ${pet.description ? `<p class="pet-tooltip-description">${escapeHtml(cleanupPublicText(pet.description))}</p>` : ""}
      </div>
    `;
  }

  function statRangeText(stat) {
    if (!stat) return "";
    const base = Number(stat.base) || 0;
    const max = Number(stat.max) || 0;
    if (!base && !max) return "";
    return base === max ? formatCompactNumber(base) : `${formatCompactNumber(base)}-${formatCompactNumber(max)}`;
  }

  function formatPetStat(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    return formatCompactNumber(Math.round(number));
  }

  function damageRangeText(levels) {
    const min = levels.minDamage || {};
    const max = levels.maxDamage || {};
    const baseMin = Number(min.base) || 0;
    const baseMax = Number(max.base) || 0;
    const capMin = Number(min.max) || 0;
    const capMax = Number(max.max) || 0;
    if (!baseMin && !baseMax && !capMin && !capMax) return "";
    return `${formatCompactNumber(baseMin)}-${formatCompactNumber(baseMax)} to ${formatCompactNumber(capMin)}-${formatCompactNumber(capMax)}`;
  }

  function petTooltipText(pet) {
    const levels = pet.levels || {};
    const lines = [
      pet.name,
      pet.description || "",
      pet.tameLevel ? `Taming level: ${pet.tameLevel}` : pet.untamable ? "Special obtain only" : "",
      pet.feedName ? `Feed: ${pet.feedName}` : "",
      levels.maxLevel ? `Max level: ${levels.maxLevel}` : "",
      levels.health ? `Health: ${levels.health.base}-${levels.health.max}` : "",
      levels.minDamage || levels.maxDamage ? `Damage: ${levels.minDamage?.base || 0}-${levels.maxDamage?.base || 0} to ${levels.minDamage?.max || 0}-${levels.maxDamage?.max || 0}` : "",
      levels.perkCount ? `Perks: ${levels.perkCount}` : "",
      levels.perkLevels?.length ? `Perk levels: ${levels.perkLevels.slice(0, 8).join(", ")}${levels.perkLevels.length > 8 ? ", ..." : ""}` : "",
    ].filter(Boolean);
    return lines.join("\n");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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

  function isShopItemsTable(table) {
    const columns = new Set(table.columns || []);
    return columns.has("itemId") || (columns.has("price") && columns.has("amount"));
  }

  function renderShopItemsTable(table) {
    const rows = table.rows || [];
    if (!rows.length) return document.createDocumentFragment();

    const block = sectionBlock(table.title || "Shop items", rows.length);
    const grid = document.createElement("div");
    grid.className = "shop-item-grid";

    for (const row of rows) {
      const item = row.itemId ? items[row.itemId] : null;
      const card = document.createElement(item ? "button" : "div");
      card.className = "shop-item-card";
      if (item) {
        card.type = "button";
        card.addEventListener("click", () => navigate({ type: "item", id: row.itemId }));
      }

      card.appendChild(item ? renderIcon(row.itemId) : renderInlineImage("", row.name, "IT"));

      const body = document.createElement("span");
      body.className = "shop-item-body";
      const name = shopItemDisplayName(row, item);
      const noteWasUsedInName = isSkillBookVariantName(row.name || item?.name || "", row.note);
      const meta = [
        row.amount ? `amount: ${row.amount}` : "",
        row.note && !noteWasUsedInName ? `note: ${row.note}` : "",
      ].filter(Boolean);
      body.innerHTML = `
        <strong dir="auto">${escapeHtml(name)}</strong>
        ${meta.length ? `<small>${escapeHtml(meta.join(" · "))}</small>` : ""}
      `;

      if (row.price) {
        const price = document.createElement("span");
        price.className = "shop-item-price";
        price.innerHTML = `<span>price:</span> ${formatPriceHtml(row.price, row.currencyItem)}`;
        body.appendChild(price);
      }

      card.appendChild(body);
      grid.appendChild(card);
    }

    block.appendChild(grid);
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
    els.inspectorContent.classList.remove("pet-inspector-content");
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

  function renderPetInspector(entry, pet, requestedLevel) {
    if (!pet) {
      renderWikiInspector(entry);
      return;
    }

    els.emptyInspector.classList.add("is-hidden");
    els.inspectorContent.classList.remove("is-hidden");
    els.inspectorContent.classList.add("pet-inspector-content");
    els.inspectorContent.innerHTML = "";

    const detail = document.createElement("div");
    detail.className = "pet-detail-card inspector-pet-detail";
    detail.innerHTML = petTooltipHtml(pet, requestedLevel);
    els.inspectorContent.appendChild(detail);
  }

  function renderItemInspector(itemId) {
    const item = itemRecord(itemId);
    const produced = recipesByResult.get(itemId) || [];
    const used = usageByItem.get(itemId) || [];
    const sources = mergedDropSources(itemId);
    const economy = itemEconomy[itemId] || null;
    const soldBy = shopsByItem[itemId] || [];

    els.emptyInspector.classList.add("is-hidden");
    els.inspectorContent.classList.remove("is-hidden");
    els.inspectorContent.classList.remove("pet-inspector-content");
    els.inspectorContent.innerHTML = "";

    const head = document.createElement("div");
    head.className = "item-head";
    head.appendChild(renderIcon(itemId, "large"));
    const title = document.createElement("div");
    const description = itemDescription(itemId);
    title.innerHTML = `
      <h2 dir="auto">${escapeHtml(itemName(itemId))}</h2>
      <p class="item-id">${escapeHtml(item.id)}</p>
      ${description ? `<p class="item-description">${escapeHtml(description)}</p>` : ""}
      ${itemStatSummaryHtml(itemId)}
    `;
    head.appendChild(title);
    els.inspectorContent.appendChild(head);

    const panels = document.createElement("div");
    panels.className = "inspector-panels";
    panels.appendChild(itemEconomyBlock("Item economy", economy, itemId));
    const organBlock = witchcraftOrganBlock(itemId);
    if (organBlock) panels.appendChild(organBlock);
    panels.appendChild(shopSaleListBlock("Sold by shops", soldBy));
    panels.appendChild(recipeListBlock("Recipes that create this item", produced, { showIcons: true }));
    panels.appendChild(stationListBlock("Crafting stations", craftingStationsForRecipes(produced)));
    panels.appendChild(toolListBlock("Crafting tools", craftingToolsForRecipes(produced)));
    panels.appendChild(requirementListBlock("Crafting requirements", craftingRequirementsForRecipes(produced)));
    panels.appendChild(recipeListBlock("Used in recipes", used, { showIcons: true }));
    panels.appendChild(sourceListBlock("Drops", sources));
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

  function witchcraftOrganBlock(itemId) {
    const organ = weaponPoisonOrganTraits[itemId];
    if (!organ) return null;

    const block = sectionBlock("Weapon poison traits", 1);
    const card = document.createElement("div");
    card.className = "organ-trait-card";
    const flags = [
      organ.hiddenInJournal ? "hidden journal" : "",
      organ.lootOnly ? "loot only" : "",
    ].filter(Boolean);
    card.innerHTML = `
      <div class="organ-trait-head">
        <strong>${escapeHtml(itemName(itemId))}</strong>
        <small>${escapeHtml(organ.source || "WTWitchcraftOrgan")}</small>
      </div>
      <dl>
        <div><dt>Required Witchcraft</dt><dd>${escapeHtml(organ.requiredWitchcraft)}</dd></div>
        ${organ.requiredItem ? `<div><dt>Transform reagent</dt><dd>${escapeHtml(itemName(organ.requiredItem))}</dd></div>` : ""}
        <div><dt>Affects on</dt><dd>${escapeHtml(organ.affects || "All")}</dd></div>
        <div><dt>Charges</dt><dd>${escapeHtml(organ.charges)}</dd></div>
        ${(organ.traits || []).map((trait) => `<div><dt>${escapeHtml(trait.label)}</dt><dd>${escapeHtml(trait.value)}</dd></div>`).join("")}
      </dl>
      ${flags.length ? `<p>${escapeHtml(flags.join(" · "))}</p>` : ""}
    `;
    block.appendChild(card);
    return block;
  }

  function itemEconomyBlock(title, economy, itemId) {
    const block = sectionBlock(title, itemId && isItemSellable(itemId) ? 1 : 0);
    if (itemId && isItemSellable(itemId)) {
      block.appendChild(renderItemBuyUpCalculator(itemId));
      return block;
    }

    if (!hasEconomyInfo(economy)) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "No public price fields found in the local item data.";
      block.appendChild(empty);
      return block;
    }

    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = economy.tradeRestricted
      ? "This item is trade restricted."
      : "No buy-up calculator is available for this item.";
    block.appendChild(empty);
    return block;
  }

  function renderItemBuyUpCalculator(itemId) {
    const calc = document.createElement("div");
    calc.className = "buyup-calculator";
    const best = bestBuyUpBuyerForItem(itemId);
    const quote = buyUpQuote(itemId, 1, "best");

    const buyerSummary = document.createElement("div");
    buyerSummary.className = "best-buyer-card";
    buyerSummary.innerHTML = `
      <span>Best buyer</span>
      <strong>${escapeHtml(best?.name || "Unknown buyer")}</strong>
      <small>${escapeHtml(formatPercent(quote.percent))}${quote.special ? " · special price" : " · usual price"} · base ${formatCurrencyHtml(quote.base)}</small>
    `;

    const controls = document.createElement("div");
    controls.className = "buyup-controls";
    const quantityField = document.createElement("label");
    quantityField.className = "calculator-field";
    quantityField.innerHTML = `<span>Quantity</span>`;
    const quantity = document.createElement("input");
    quantity.type = "number";
    quantity.min = "0";
    quantity.step = "1";
    quantity.value = "1";
    quantityField.appendChild(quantity);
    controls.append(quantityField);

    const result = document.createElement("div");
    result.className = "buyup-result";
    const detail = document.createElement("div");
    detail.className = "buyup-detail";

    const add = document.createElement("button");
    add.type = "button";
    add.className = "small-button buyup-add";
    add.textContent = "Add to Sell";
    add.addEventListener("click", () => {
      addSellItem(itemId, quantity.value);
      navigate({ type: "sell" });
    });

    function update() {
      const quote = buyUpQuote(itemId, quantity.value, "best");
      result.innerHTML = `
        <span>Estimated payout</span>
        <strong>${formatCurrencyHtml(quote.payout)}</strong>
      `;
      detail.textContent = `${quote.buyer?.name || "Best buyer"}: ${formatPriceNumber(quote.base)} × ${formatPercent(quote.percent)} × ${quote.quantity} = ${formatPriceNumber(quote.raw)} Coins, rounded down`;
    }

    quantity.addEventListener("input", update);
    update();
    calc.append(buyerSummary, controls, result, detail, add);
    return calc;
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
      row.innerHTML = `
        <div class="source-top">
          <span dir="auto">${escapeHtml(sale.shop || "NPC shop")}</span>
          <span>Shop</span>
        </div>
      `;
      if (sale.amount) {
        const amount = document.createElement("div");
        amount.className = "source-meta";
        amount.textContent = `amount: ${sale.amount}`;
        row.appendChild(amount);
      }
      if (sale.price) {
        const price = document.createElement("div");
        price.className = "source-meta source-price";
        price.innerHTML = `<span>price:</span> ${formatPriceHtml(sale.price, sale.currencyItem)}`;
        row.appendChild(price);
      }
      if (sale.note) {
        const note = document.createElement("div");
        note.className = "source-meta";
        const variantName = skillBookVariantName(sale.name || (sale.itemId ? itemName(sale.itemId) : ""), sale.note);
        note.textContent = variantName ? `item: ${variantName}` : `note: ${sale.note}`;
        row.appendChild(note);
      }
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
    const number = parsePriceValue(value);
    return Number.isFinite(number) && number > 0;
  }

  function accessibleBuyUpBuyerNames(entries) {
    const names = new Set();
    for (const entry of entries || []) {
      if (entry.type === "shop") {
        const normalized = normalize(entry.name);
        if (normalized) names.add(normalized);
      }
      if (entry.type !== "area") continue;
      for (const npc of entry.npcs || []) {
        const normalized = normalize(npc.name);
        if (normalized) names.add(normalized);
      }
    }
    return names;
  }

  function isItemSellable(itemId) {
    const economy = itemEconomy[itemId];
    return Boolean(economy && hasPrice(economy.buyUpPrice) && !economy.tradeRestricted);
  }

  function buyUpQuote(itemId, quantityValue, buyerId) {
    const economy = itemEconomy[itemId] || {};
    const base = parsePriceValue(economy.buyUpPrice);
    const quantity = normalizeSellQuantity(quantityValue);
    const resolved = resolveBuyUpBuyerForItem(itemId, buyerId);
    const percent = resolved.percent;
    const raw = Number.isFinite(base) ? base * percent * quantity : 0;
    return {
      itemId,
      base: Number.isFinite(base) ? base : 0,
      quantity,
      buyer: resolved.buyer,
      percent,
      special: resolved.special,
      raw,
      payout: Math.floor(raw + 0.000001),
    };
  }

  function resolveBuyUpBuyerForItem(itemId, buyerId) {
    const buyer = buyerId === "best"
      ? bestBuyUpBuyerForItem(itemId)
      : buyUpBuyersById.get(buyerId) || bestBuyUpBuyerForItem(itemId);
    const special = buyer ? isSpecialBuyUpItem(itemId, buyer) : false;
    const percentValue = parsePriceValue(special ? buyer?.specialPercent : buyer?.usualPercent);
    return {
      buyer,
      special,
      percent: Number.isFinite(percentValue) && percentValue > 0 ? percentValue : 1,
    };
  }

  function bestBuyUpBuyerForItem(itemId) {
    let best = null;
    let bestPercent = -Infinity;
    for (const buyer of buyUpBuyers) {
      const special = isSpecialBuyUpItem(itemId, buyer);
      const percent = parsePriceValue(special ? buyer.specialPercent : buyer.usualPercent);
      if (Number.isFinite(percent) && percent > bestPercent) {
        best = buyer;
        bestPercent = percent;
      }
    }
    return best;
  }

  function isSpecialBuyUpItem(itemId, buyer) {
    if (!buyer) return false;
    if (buyUpBuyerSpecialItems.get(buyer.id)?.has(itemId)) return true;
    const skill = buyer.craftSpecialSkills;
    if (!skill) return false;
    return (craftSkillsByItem.get(itemId) || []).some((itemSkill) => normalize(itemSkill) === normalize(skill));
  }

  function addSellItem(itemId, quantityValue = 1) {
    if (!isItemSellable(itemId)) return;
    const quantity = normalizeSellQuantity(quantityValue) || 1;
    const existing = state.sellItems.find((row) => row.itemId === itemId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      state.sellItems.push({ itemId, quantity });
    }
  }

  function updateSellItemQuantity(itemId, quantityValue) {
    const quantity = normalizeSellQuantity(quantityValue);
    const existing = state.sellItems.find((row) => row.itemId === itemId);
    if (existing) existing.quantity = quantity;
    state.sellItems = state.sellItems.filter((row) => row.quantity > 0);
  }

  function removeSellItem(itemId) {
    state.sellItems = state.sellItems.filter((row) => row.itemId !== itemId);
  }

  function normalizeSellQuantity(value) {
    const quantity = Math.floor(Number(value));
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  }

  function formatPercent(value) {
    const percent = Number(value) * 100;
    if (!Number.isFinite(percent)) return "100%";
    return `${formatPriceNumber(percent)}%`;
  }

  function formatPriceHtml(value, currencyItemId = "") {
    const specialCurrency = resolveSpecialCurrency(value, currencyItemId);
    if (specialCurrency) return formatSpecialCurrencyHtml(value, specialCurrency);
    return formatCurrencyHtml(value);
  }

  function formatSpecialCurrencyHtml(value, currency) {
    const amount = formatPriceNumber(parsePriceValue(value));
    if (!amount) return "";
    const label = `${amount} ${currency.name}`;
    const iconHtml = currency.icon
      ? `<span class="currency-item-icon"><img src="${escapeHtml(currency.icon)}" alt="" aria-hidden="true"></span>`
      : `<span class="currency-coin currency-special" data-symbol="${escapeHtml(currency.symbol)}" aria-hidden="true"></span>`;
    return `
      <span class="currency-price special-currency-price" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
        <span class="currency-part currency-special-part" title="${escapeHtml(currency.name)}">
          <span class="currency-value">${escapeHtml(amount)}</span>
          ${iconHtml}
          <span class="currency-item-name">${escapeHtml(currency.name)}</span>
        </span>
      </span>
    `;
  }

  function resolveSpecialCurrency(value, currencyItemId = "") {
    const explicit = currencyItemId && items[currencyItemId]
      ? items[currencyItemId]
      : null;
    if (explicit) {
      return {
        id: explicit.id,
        name: explicit.name || humanizeLabel(explicit.id),
        icon: explicit.icon || "",
        symbol: initials(explicit.name || explicit.id),
      };
    }

    const text = String(value || "").toLowerCase();
    const knownCurrencyIds = ["GuildCoin"];
    for (const id of knownCurrencyIds) {
      const item = items[id];
      const itemName = String(item?.name || id).toLowerCase();
      if (item && (text.includes(itemName) || text.includes(id.toLowerCase()))) {
        return {
          id: item.id,
          name: item.name || humanizeLabel(item.id),
          icon: item.icon || "",
          symbol: initials(item.name || item.id),
        };
      }
    }

    return null;
  }

  function formatCurrencyHtml(value) {
    const parts = splitCurrency(value);
    if (!parts) return "";
    const label = parts
      .map((part) => `${part.value} ${part.label}`)
      .join(", ");
    return `
      <span class="currency-price" title="${escapeHtml(`${formatPriceNumber(parts.raw)} Coins = ${label}`)}" aria-label="${escapeHtml(label)}">
        ${parts.map((part) => `
          <span class="currency-part" title="${escapeHtml(part.label)}">
            <span class="currency-value">${escapeHtml(part.value)}</span>
            <span class="currency-coin currency-${escapeHtml(part.type)}" data-symbol="${escapeHtml(part.symbol)}" aria-hidden="true"></span>
          </span>
        `).join("")}
      </span>
    `;
  }

  function splitCurrency(value) {
    const number = parsePriceValue(value);
    if (!Number.isFinite(number) || number < 0) return null;
    const gold = Math.floor(number / 10000);
    const silver = Math.floor((number - (gold * 10000)) / 100);
    const copperValue = number - (gold * 10000) - (silver * 100);
    const copper = formatPriceNumber(copperValue);
    const parts = [];

    if (gold > 0) parts.push(currencyPart("gold", gold));
    if (silver > 0 || gold > 0) parts.push(currencyPart("silver", silver));
    if (copperValue > 0 || parts.length === 0 || silver > 0 || gold > 0) {
      parts.push(currencyPart("copper", copper));
    }

    return Object.assign(parts, { raw: number });
  }

  function currencyPart(type, value) {
    const labels = {
      gold: ["Gold", "G"],
      silver: ["Silver", "S"],
      copper: ["Copper", "C"],
    };
    return {
      type,
      value: String(value),
      label: labels[type][0],
      symbol: labels[type][1],
    };
  }

  function parsePriceValue(value) {
    if (typeof value === "number") return value;
    const match = String(value ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : NaN;
  }

  function formatPriceNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    if (Math.abs(number - Math.round(number)) < 0.01) return String(Math.round(number));
    return number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
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

  function stationListBlock(title, stationIds) {
    const block = sectionBlock(title, stationIds.length);
    const wrap = document.createElement("div");
    wrap.className = "station-list";

    for (const stationId of stationIds) {
      wrap.appendChild(renderStationButton(stationId));
    }

    if (!stationIds.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "No station requirement found in the local recipes.";
      wrap.appendChild(empty);
    }

    block.appendChild(wrap);
    return block;
  }

  function toolListBlock(title, toolIds) {
    const block = sectionBlock(title, toolIds.length);
    const wrap = document.createElement("div");
    wrap.className = "tool-list";

    for (const toolId of toolIds) {
      wrap.appendChild(renderToolButton(toolId));
    }

    if (!toolIds.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "No tool requirement found in the local recipes.";
      wrap.appendChild(empty);
    }

    block.appendChild(wrap);
    return block;
  }

  function requirementListBlock(title, requirementIds) {
    const block = sectionBlock(title, requirementIds.length);
    const wrap = document.createElement("div");
    wrap.className = "requirement-list";

    for (const requirementId of requirementIds) {
      wrap.appendChild(renderRequirementButton(requirementId));
    }

    if (!requirementIds.length) {
      const empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "No extra station or building requirement found in the local recipes.";
      wrap.appendChild(empty);
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
      const row = document.createElement(source.mapId && wikiEntriesById.has(source.mapId) ? "button" : "div");
      row.className = "source-row";
      if (row.tagName === "BUTTON") {
        row.type = "button";
        row.title = `Open ${source.mapName || sourceTitle(source)}`;
        row.addEventListener("click", () => {
          activateWikiKind("area", { clearQuery: true });
          navigate({ type: "wiki", id: source.mapId });
        });
      }
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

  function mergedDropSources(itemId) {
    return [
      ...(sourcesByItem[itemId] || []),
      ...fishingMapSources(itemId),
    ];
  }

  function fishingMapSources(itemId) {
    const rows = [];
    const seen = new Set();
    const item = itemRecord(itemId);
    const itemNameKey = normalize(item.name);

    for (const entry of wikiEntries) {
      if (entry.type !== "fish") continue;
      const catchList = (entry.lists || []).find((list) => list.title === "Catch result");
      const matchesFishItem = entry.itemId === itemId ||
        (catchList?.items || []).some((value) => normalize(value) === itemNameKey || normalize(value) === normalize(itemId));
      if (!matchesFishItem) continue;

      const foundList = (entry.lists || []).find((list) => list.title === "Found in");
      for (const location of foundList?.items || []) {
        const mapEntry = mapEntryForLabel(location);
        const signature = `${entry.id}:${location}`;
        if (seen.has(signature)) continue;
        seen.add(signature);
        rows.push({
          kind: "Fishing",
          sourceDisplay: location,
          source: location,
          mapId: mapEntry?.id || "",
          mapName: mapEntry?.name || mapNameFromLocation(location),
          fishId: entry.id,
          amount: 1,
          chance: "catch",
        });
      }
    }

    return rows;
  }

  function buildFishButcheringYields() {
    const fishLookup = new Map();
    for (const entry of wikiEntries) {
      if (entry.type !== "fish") continue;
      const fishItemId = entry.itemId || String(entry.id || "").replace(/^fish:/, "");
      for (const key of [fishItemId, entry.id, String(entry.id || "").replace(/^fish:/, ""), entry.name]) {
        const normalized = normalize(key);
        if (normalized) fishLookup.set(normalized, fishItemId);
      }
    }

    const yieldsByFish = new Map();
    const seenByFish = new Map();
    for (const [outputItemId, sourceRows] of Object.entries(sourcesByItem)) {
      const item = items[outputItemId];
      if (!item || !Array.isArray(sourceRows)) continue;

      for (const source of sourceRows) {
        if (!isButcheringSource(source)) continue;
        const fishItemId = fishLookup.get(normalize(source.source)) || fishLookup.get(normalize(source.sourceDisplay));
        if (!fishItemId) continue;

        const signature = [
          outputItemId,
          source.amount || "",
          source.chance || "",
          source.level || "",
        ].join("|");
        if (!seenByFish.has(fishItemId)) seenByFish.set(fishItemId, new Set());
        if (seenByFish.get(fishItemId).has(signature)) continue;
        seenByFish.get(fishItemId).add(signature);

        addToMapList(yieldsByFish, fishItemId, {
          itemId: outputItemId,
          name: item.name || outputItemId,
          icon: item.icon || "",
          kind: source.kind || source.skillDisplay || "Butchering",
          amount: source.amount || "",
          chance: source.chance || "",
          level: source.level || "",
        });
      }
    }

    for (const [fishItemId, rows] of yieldsByFish.entries()) {
      rows.sort((a, b) => {
        const chanceDiff = percentValue(b.chance) - percentValue(a.chance);
        if (chanceDiff) return chanceDiff;
        return a.name.localeCompare(b.name);
      });
      yieldsByFish.set(fishItemId, rows);
    }
    return yieldsByFish;
  }

  function isButcheringSource(source) {
    return [source.kind, source.skill, source.skillDisplay]
      .some((value) => normalize(value) === "butchering");
  }

  function percentValue(value) {
    const match = String(value || "").match(/([\d.]+)\s*%/);
    return match ? Number(match[1]) : 0;
  }

  function buildItemLookup() {
    const lookup = new Map();
    for (const item of Object.values(items)) {
      for (const key of [item.id, item.name, String(item.id || "").replace(/([a-z])([A-Z])/g, "$1 $2")]) {
        const normalized = normalize(key);
        if (normalized && !lookup.has(normalized)) lookup.set(normalized, item.id);
        const compact = normalized.replace(/\s+/g, "");
        if (compact && !lookup.has(compact)) lookup.set(compact, item.id);
      }
    }
    return lookup;
  }

  function sourceTitle(source) {
    return source.sourceDisplay || source.worldTypesDisplay || source.source || "Unknown source";
  }

  function sourceMetaLines(source) {
    const lines = [];
    if (normalize(source.kind) === "fishing") {
      const area = fishingAreaFromLocation(source.sourceDisplay || source.source || "");
      if (source.mapName) lines.push(`map: ${source.mapName}`);
      if (area) lines.push(`area: ${area}`);
      lines.push("source: Fishing");
      return lines;
    }

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

  function fishingAreaFromLocation(label) {
    const parts = String(label || "").split("·");
    return parts.length > 1 ? parts.slice(1).join("·").trim() : "";
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
    if (kind === "fishing") return 0;
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
    attachItemTooltip(button, itemId);
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
    const wikiEntry = wikiEntryByItemId.get(itemId);
    const icon = document.createElement("span");
    icon.className = "item-icon";
    attachItemTooltip(icon, itemId);
    if (size === "large") {
      icon.style.width = "64px";
      icon.style.height = "64px";
    }

    const iconSrc = item.icon || wikiEntry?.image || "";
    if (iconSrc) {
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.src = iconSrc;
      icon.appendChild(img);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "fallback-icon";
      fallback.textContent = initials(item.name || item.id);
      icon.appendChild(fallback);
    }
    return icon;
  }

  function renderToolIcon(toolId) {
    return renderIcon(toolIconItemId(toolId));
  }

  function toolIconItemId(toolId) {
    if (itemRecord(toolId).icon) return toolId;
    if (toolIconCache.has(toolId)) return toolIconCache.get(toolId);

    const query = normalize(toolId);
    const preferredRanks = ["stone", "wooden", "copper", "bronze", "iron", "steel"];
    const matches = Object.values(items)
      .filter((item) => item.icon)
      .filter((item) => normalize(item.id).includes(query) || normalize(item.name).includes(query))
      .sort((a, b) => toolIconRank(a, query, preferredRanks) - toolIconRank(b, query, preferredRanks));
    const iconId = matches[0]?.id || toolId;
    toolIconCache.set(toolId, iconId);
    return iconId;
  }

  function toolIconRank(item, query, preferredRanks) {
    const id = normalize(item.id);
    const name = normalize(item.name);
    let rank = 50;
    if (id === query || name === query) rank -= 40;
    if (id.endsWith(query) || name.endsWith(query)) rank -= 15;
    const preferred = preferredRanks.findIndex((word) => id.includes(word) || name.includes(word));
    if (preferred >= 0) rank += preferred;
    if (id.includes("wonder") || name.includes("wonder")) rank += 20;
    if (id.includes("loot") || name.includes("mysterious")) rank += 10;
    return rank;
  }

  function renderWikiIcon(entry, size) {
    if (entry?.type === "creature") {
      return renderCreatureWikiIcon(entry, size);
    }

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

  function renderCreatureWikiIcon(entry, size) {
    const icon = document.createElement("span");
    icon.className = "item-icon";
    if (size === "large") {
      icon.style.width = "64px";
      icon.style.height = "64px";
    }

    const src = creatureDisplayImage(entry);
    if (src) {
      const img = document.createElement("img");
      img.alt = entry.name || "";
      img.loading = "lazy";
      img.src = src;
      img.addEventListener("error", () => {
        icon.innerHTML = "";
        const fallback = document.createElement("span");
        fallback.className = "fallback-icon";
        fallback.textContent = wikiInitials(entry);
        icon.appendChild(fallback);
      }, { once: true });
      icon.appendChild(img);
      return icon;
    }

    const fallback = document.createElement("span");
    fallback.className = "fallback-icon";
    fallback.textContent = wikiInitials(entry);
    icon.appendChild(fallback);
    return icon;
  }

  function creatureDisplayImage(entry) {
    if (!entry) return "";
    const image = entry.image || "";
    if (image && entry.imageSource === "pet-icon-match") return image;
    if (image && !isLikelyCreatureIconPlaceholder(entry, image)) return image;
    return `assets/creatures/${creatureAssetName(entry)}.png?v=20260708-1235`;
  }

  function isLikelyCreatureIconPlaceholder(entry, image) {
    if (!image) return false;
    if (!String(image).includes("/icons/")) return false;
    const firstAbilityIcon = entry.abilities?.[0]?.icon || "";
    return image === firstAbilityIcon || !String(image).includes("/creatures/");
  }

  function creatureAssetName(entry) {
    return String(entry.localId || entry.id || entry.name || "")
      .replace(/^creature:/, "")
      .replace(/[^A-Za-z0-9_-]/g, "");
  }

  function wikiInitials(entry) {
    const typeMap = {
      creature: "MO",
      area: "MP",
      fish: "FS",
      shop: "SH",
      quest: "QT",
      skill: "SK",
      farming: "FM",
      pet: "PT",
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
      normalize(itemName(item.id)).includes(query) ||
      normalize(item.name).includes(query) ||
      normalize(item.description || "").includes(query) ||
      normalize(itemStatSearchText(item.id)).includes(query);
  }

  function recipeFilterTypes() {
    return new Set(["craft", "build", "process", "cooking", "potion", "poison"]);
  }

  function recipeMatchesFilter(recipe, filter) {
    if (filter === "all" || filter === "items") return true;
    if (filter === "cooking") {
      return state.cookingTab === "fermented"
        ? isFermentationTabRecipe(recipe)
        : isCookingRecipe(recipe) && !isFermentationTabRecipe(recipe);
    }
    if (filter === "potion") return isPotionRecipe(recipe);
    if (filter === "poison") return isPoisonRecipe(recipe);
    return recipe.kind === filter;
  }

  function cookingRecipes() {
    return recipes.filter(isCookingRecipe);
  }

  function potionRecipes() {
    return recipes.filter(isPotionRecipe);
  }

  function poisonRecipes() {
    return recipes.filter(isPoisonRecipe);
  }

  function isCookingRecipe(recipe) {
    if (!recipe) return false;
    if (recipe.skill === "Cookery" || displaySkill(recipe.skill) === "Cookery") return true;
    return isCookingProcessRecipe(recipe) || isFermentedDrinkRecipe(recipe);
  }

  function isCookingProcessRecipe(recipe) {
    if (!recipe || recipe.kind !== "process") return false;
    const stationSet = new Set(uniqueStationIds(recipe));
    if ([
      "WitchcraftPot",
      "DwarvenMachineLiquor",
      "GrimWoodTanningVat",
      "TanningVatBasic",
      "TanningVatLarge",
    ].some((station) => stationSet.has(station))) {
      return false;
    }
    if (["Campfire", "CampfireWithPot", "BrickOven", "StoneOven", "DwarvenMachineCookery", "ShipBoilingPot"].some((station) => stationSet.has(station))) {
      return true;
    }
    const text = recipeCookingText(recipe);
    return /\b(bake|baked|boil|boiled|cauldron|cookery|roast|roasted|fried|soup|stew|porridge|bannock|bread|dessert|tartare|ribs|fillet|mushroom|wort|juice)\b/i.test(text);
  }

  function isFermentedDrinkRecipe(recipe) {
    if (!recipe) return false;
    const stationSet = new Set(uniqueStationIds(recipe));
    return stationSet.has("FermentationBarrel") || /Fermentation/i.test(recipe.processName || "");
  }

  function isFermentationJuiceRecipe(recipe) {
    if (!recipe) return false;
    if (recipe.skill !== "Cookery" && displaySkill(recipe.skill) !== "Cookery") return false;
    const text = `${recipe.result} ${itemName(recipe.result)} ${recipe.folder || ""}`;
    return /\bjuice\b/i.test(text) && !/\bsolution\b/i.test(text);
  }

  function usesFermentationJuice(recipe) {
    if (!recipe) return false;
    if (recipe.skill !== "Cookery" && displaySkill(recipe.skill) !== "Cookery") return false;
    return (recipe.materials || []).some((material) => {
      const text = `${material.item} ${itemName(material.item)}`;
      return /\bjuice\b/i.test(text) && !/\bsolution\b/i.test(text);
    });
  }

  function isFermentationTabRecipe(recipe) {
    return isFermentedDrinkRecipe(recipe) || isFermentationJuiceRecipe(recipe) || usesFermentationJuice(recipe);
  }

  function recipeCookingText(recipe) {
    return [
      recipe.processName,
      recipe.folder,
      recipe.result,
      itemName(recipe.result),
      itemDescription(recipe.result),
      ...(recipe.materials || []).map((material) => `${material.item} ${itemName(material.item)}`),
    ].join(" ");
  }

  function cookingRecipeKindLabel(recipe) {
    if (isFermentedDrinkRecipe(recipe)) return "Fermented drink";
    if (isFermentationJuiceRecipe(recipe)) return "Juice";
    if (usesFermentationJuice(recipe)) return "Drink";
    if (recipe.kind === "process") return "Cooking process";
    if (recipe.kind === "build") return "Cooking build";
    return "Cooking";
  }

  function sortCookingRecipes(a, b) {
    const fermentedDelta = Number(isFermentationTabRecipe(b)) - Number(isFermentationTabRecipe(a));
    if (state.cookingTab === "all" && fermentedDelta) return fermentedDelta;
    const folderDelta = recipeContext(a).localeCompare(recipeContext(b));
    if (folderDelta) return folderDelta;
    return sortRecipes(a, b);
  }

  function isPotionRecipe(recipe) {
    if (!recipe || recipe.kind === "build") return false;
    const name = itemName(recipe.result);
    const description = itemDescription(recipe.result);
    const folder = recipe.folder || "";
    const text = `${recipe.result} ${name} ${description} ${folder} ${recipe.processName || ""}`;

    if (/\bHealing\/Medicines\b/i.test(folder)) return true;
    if (/\bWitchcraft\/Battle potions\b/i.test(folder)) return true;
    if (/\bWitchcraft\/Potions\b/i.test(folder)) return true;
    if (/\bWitchcraft\/Material\b/i.test(folder) && /\bpotion\b/i.test(`${recipe.result} ${name}`) && !/^Reactive potion$/i.test(name)) return true;
    if (/\b(potion|antidote|medicine|ointment|bandage|tincture|elixir|balm|salve)\b/i.test(`${recipe.result} ${name}`)) {
      return !/\b(bomb|powder|tool|scroll|mount|broomstick|candle|necklace|amulet|essence)\b/i.test(text) && !/^Reactive potion$/i.test(name);
    }
    return /\b(restores? health|recovery health|resist poisoning|resist burning|combat potion|useful potion)\b/i.test(description);
  }

  function potionRecipeKindLabel(recipe) {
    const folder = recipe.folder || "";
    const name = itemName(recipe.result);
    if (/\bHealing\/Medicines\b/i.test(folder)) return "Healing";
    if (/\bBattle potions\b/i.test(folder)) return "Battle potion";
    if (/\bWitchcraft\/Potions\b/i.test(folder)) return "Search potion";
    if (/\btincture\b/i.test(name)) return "Tincture";
    if (/\bpotion\b/i.test(name)) return "Potion";
    if (/\b(ointment|bandage|antidote|medicine)\b/i.test(name)) return "Medicine";
    return "Useful consumable";
  }

  function sortPotionRecipes(a, b) {
    const labelDelta = potionRecipeKindLabel(a).localeCompare(potionRecipeKindLabel(b));
    if (labelDelta) return labelDelta;
    const folderDelta = recipeContext(a).localeCompare(recipeContext(b));
    if (folderDelta) return folderDelta;
    return sortRecipes(a, b);
  }

  function isPoisonRecipe(recipe) {
    if (!recipe || recipe.kind === "build") return false;
    const result = recipe.result || "";
    const name = itemName(result);
    const description = itemDescription(result);
    const folder = recipe.folder || "";
    const resultText = [
      result,
      name,
      description,
      folder,
      recipe.processName || "",
    ].join(" ");
    const materialText = [
      ...(recipe.materials || []).map((material) => `${material.item} ${itemName(material.item)}`),
    ].join(" ");

    if (/\bWitchcraft\/Organs\b/i.test(folder)) return false;
    if (["CornPie", "EmptyFlask", "WideBandages", "PotionFindMushroomAmanitas"].includes(result)) return false;
    if (poisonWitchcraftMaterialIds.has(result)) return true;
    if (/\bWitchcraft\/Battle potions\b/i.test(folder)) return true;
    if (result === "PoisonBomb" || result === "StickyBolt" || result === "WeakAntidote") return true;
    if (weaponPoisonItemIds.includes(result)) return true;
    if (/\b(poison|toxic|toxin|antidote)\b/i.test(resultText)) {
      return !/\b(venom belt|poison strike|necklace|amulet|mount|skin|altar|empty flask|searching for poison mushrooms)\b/i.test(`${resultText} ${materialText}`);
    }
    return false;
  }

  function weaponPoisonRelatedRecipes() {
    const directRelated = new Set([
      "WitchcraftPot",
      "CornPie",
      "RawCornPie",
      "EmptyFlask",
      "PoisonArrow",
      "StickyBolt",
    ]);
    return recipes.filter((recipe) => {
      if (!recipe) return false;
      if (weaponPoisonItemIds.includes(recipe.result)) return true;
      if (directRelated.has(recipe.result)) return true;
      return (recipe.materials || []).some((material) => weaponPoisonItemIds.includes(material.item));
    });
  }

  function poisonRecipeKindLabel(recipe) {
    const result = recipe?.result || "";
    const folder = recipe?.folder || "";
    const name = itemName(result);

    if (weaponPoisonItemIds.includes(result)) return "Weapon poison";
    if (result === "ReagentPotion") return "Witchcraft reagent base";
    if (result === "PoisonBomb") return "Poison explosive";
    if (result === "StickyBolt") return "Poison ammunition";
    if (result === "WeakAntidote") return "Antidote";
    if (/\bWitchcraft\/Battle potions\b/i.test(folder)) return "Witchcraft battle potion";
    if (poisonWitchcraftMaterialIds.has(result)) return "Witchcraft ability reagent";
    if (/\btoxic|toxin\b/i.test(`${result} ${name}`)) return "Toxic material";
    if (/\bpoison\b/i.test(`${result} ${name}`)) return "Poison";
    return "Poison-related recipe";
  }

  function sortPoisonRecipes(a, b) {
    const labelDelta = poisonRecipeKindLabel(a).localeCompare(poisonRecipeKindLabel(b));
    if (labelDelta) return labelDelta;
    const folderDelta = recipeContext(a).localeCompare(recipeContext(b));
    if (folderDelta) return folderDelta;
    return sortRecipes(a, b);
  }

  function poisonRecipeDescription(recipe) {
    const result = recipe?.result || "";
    const description = itemDescription(result);
    if (description) return description;
    const stats = compactItemDetailText(result, 3);
    if (stats) return `No written item description was found in the local files. Fixed stats: ${stats}.`;
    if (recipe?.materials?.length) return "No written item description was found in the local files; the recipe ingredients are shown below.";
    return "No written item description was found in the local files.";
  }

  function weaponPoisonComponentItemIds() {
    const organIds = Object.keys(weaponPoisonOrganTraits);
    const descriptionIds = Object.entries(items)
      .filter(([, item]) => /crafting weapon poisons? in a witchcrafter/i.test(item.description || ""))
      .map(([itemId]) => itemId);
    return [...new Set([...organIds, ...descriptionIds])]
      .sort((a, b) => {
        const levelDelta = Number(weaponPoisonOrganTraits[a]?.requiredWitchcraft || 999) - Number(weaponPoisonOrganTraits[b]?.requiredWitchcraft || 999);
        if (levelDelta) return levelDelta;
        const rarityDelta = Number(items[b]?.baseRarity || 0) - Number(items[a]?.baseRarity || 0);
        if (rarityDelta) return rarityDelta;
        return itemName(a).localeCompare(itemName(b));
      });
  }

  function compactWitchcraftOrganText(itemId) {
    const organ = weaponPoisonOrganTraits[itemId];
    if (!organ) return "";
    const parts = [
      `Witchcraft ${organ.requiredWitchcraft}`,
      `${organ.charges} charges`,
      organ.affects ? `affects ${organ.affects}` : "",
      ...(organ.traits || []).slice(0, 4).map((trait) => `${trait.label}: ${trait.value}`),
    ].filter(Boolean);
    return parts.join(" · ");
  }

  function poisonItemRole(itemId) {
    if (weaponPoisonOrganTraits[itemId]) return "Original WTWitchcraftOrgan weapon-poison traits";
    if (cthulhuPoisonComponentIds.has(itemId)) return "Cthulhu organ component · known charge group: 220";
    if (/crafting weapon poisons? in a witchcrafter/i.test(itemDescription(itemId))) {
      return "Organ/component for cauldron weapon poison";
    }
    const roles = {
      WeaponPoison: "Applies poison charges to the weapon in hand",
      WeaponPoisonBurningSkeleton: "Special weapon poison variant",
      WitchcraftCauldron: "Workbench item used for potions and weapon poison",
      WitchcraftPot: "Placed station built from the cauldron",
      EmptyFlask: "Container needed for weapon poison and potions",
      PoisonArrow: "Poison ammunition found in drops and used by recipes",
      CornPie: "Food that increases weapon poison charges",
    };
    return roles[itemId] || "Poison-related item";
  }

  function wikiFilterTypes() {
    return new Set(["creature", "area", "fish", "shop", "skill", "farming", "pet"]);
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
    if (type === "farming") return 5;
    if (type === "pet") return 6;
    return 9;
  }

  function itemSearchScore(item, query) {
    const displayName = normalize(itemName(item.id));
    const name = normalize(item.name);
    const id = normalize(item.id);
    if (displayName === query || name === query || id === query) return 0;
    if (displayName.startsWith(query) || name.startsWith(query) || id.startsWith(query)) return 1;
    if (displayName.includes(query) || name.includes(query)) return 2;
    if (id.includes(query)) return 3;
    if (normalize(item.description).includes(query)) return 4;
    if (normalize(itemStatSearchText(item.id)).includes(query)) return 5;
    return 6;
  }

  function itemRecord(itemId) {
    return items[itemId] || { id: itemId, name: itemId, description: "", icon: "" };
  }

  function itemDescription(itemId) {
    return cleanupPublicText(itemRecord(itemId).description || "").trim();
  }

  function itemDescriptionWithFallback(itemId) {
    const description = itemDescription(itemId);
    if (description) return description;
    return "No written item description was found in the local files. Use the item details, sources, and recipe links below for the confirmed local data.";
  }

  function itemStatDetails(itemId) {
    const details = itemRecord(itemId).statDetails;
    if (!details || !Array.isArray(details.rows) || !details.rows.length) return null;
    return details;
  }

  function itemDetailGroups(itemId) {
    const item = itemRecord(itemId);
    const groups = [];
    if (item.statDetails && Array.isArray(item.statDetails.rows)) {
      groups.push(item.statDetails);
    }
    for (const group of item.detailGroups || []) {
      if (group && Array.isArray(group.rows)) groups.push(group);
    }
    return groups
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => row?.label && row?.value),
      }))
      .filter((group) => group.rows.length);
  }

  function itemStatSearchText(itemId) {
    return itemDetailGroups(itemId)
      .flatMap((group) => [
        group.basis || "",
        group.category || "",
        ...group.rows.flatMap((row) => [row.label, row.value]),
      ])
      .join(" ");
  }

  function compactItemDetailText(itemId, limit = 4) {
    const rows = itemDetailGroups(itemId)
      .flatMap((group) => group.rows || [])
      .filter((row) => row?.label && row?.value)
      .filter((row) => !/^type$/i.test(row.label) && !/^slot$/i.test(row.label));
    return rows
      .slice(0, limit)
      .map((row) => `${row.label}: ${row.value}`)
      .join(" · ");
  }

  function itemStatSummaryHtml(itemId) {
    const groups = itemDetailGroups(itemId);
    if (!groups.length) return "";
    return `
      <div class="item-stat-summary">
        ${groups.map((group) => `
          <div class="item-stat-group">
            <span class="item-stat-basis">${escapeHtml(group.basis || "Item details")}</span>
            <dl>
              ${group.rows.map((row) => `
                <div>
                  <dt>${escapeHtml(row.label)}</dt>
                  <dd>${escapeHtml(row.value)}</dd>
                </div>
              `).join("")}
            </dl>
          </div>
        `).join("")}
      </div>
    `;
  }

  function itemStatTooltipLines(itemId) {
    const groups = itemDetailGroups(itemId);
    if (!groups.length) return [];
    const lines = [];
    for (const group of groups) {
      lines.push(group.basis || "Item details");
      for (const row of group.rows) {
        lines.push(`${row.label}: ${row.value}`);
      }
    }
    return lines;
  }

  function itemTooltipText(itemId) {
    const description = itemDescription(itemId);
    const statLines = itemStatTooltipLines(itemId);
    const lines = [itemName(itemId)];
    if (description) lines.push(description);
    lines.push(...statLines);
    return lines.length > 1 ? lines.join("\n") : "";
  }

  function weaponPoisonOrganTooltipHtml(itemId) {
    const organ = weaponPoisonOrganTraits[itemId];
    if (!organ) return "";
    const rows = [
      ["Required Witchcraft", organ.requiredWitchcraft],
      ["Charges", organ.charges],
      ["Affects on", organ.affects || "All"],
      ...(organ.traits || []).map((trait) => [trait.label, trait.value]),
    ];
    return `
      <div class="organ-tooltip-card">
        <div class="organ-tooltip-head">
          ${itemIconHtml(itemId)}
          <span>
            <strong>${escapeHtml(itemName(itemId))}</strong>
            <small>WTWitchcraftOrgan</small>
          </span>
        </div>
        <dl>
          ${rows.map(([label, value]) => `
            <div>
              <dt>${escapeHtml(label)}</dt>
              <dd>${escapeHtml(value)}</dd>
            </div>
          `).join("")}
        </dl>
      </div>
    `;
  }

  function itemIconHtml(itemId) {
    const item = itemRecord(itemId);
    const wikiEntry = wikiEntryByItemId.get(itemId);
    const iconSrc = item.icon || wikiEntry?.image || "";
    if (iconSrc) return `<span class="item-icon"><img src="${escapeHtml(iconSrc)}" alt="" aria-hidden="true"></span>`;
    return `<span class="item-icon"><span class="fallback-icon">${escapeHtml(initials(item.name || item.id))}</span></span>`;
  }

  function attachWeaponPoisonOrganTooltip(element, itemId) {
    const html = weaponPoisonOrganTooltipHtml(itemId);
    if (!html) return attachItemTooltip(element, itemId);
    element.dataset.richTooltipHtml = html;
    element.removeAttribute("title");
    element.setAttribute("aria-label", `${itemName(itemId)} weapon poison traits`);
    return element;
  }

  function renderUntooltippedIcon(itemId, size) {
    const icon = renderIcon(itemId, size);
    icon.removeAttribute("data-item-id");
    icon.removeAttribute("aria-label");
    return icon;
  }

  function attachItemTooltip(element, itemId) {
    element.dataset.itemId = itemId;
    const tooltip = itemTooltipText(itemId);
    element.removeAttribute("title");
    element.setAttribute("aria-label", tooltip ? `${itemName(itemId)} details` : `${itemName(itemId)} (${itemId})`);
    return element;
  }

  function itemName(itemId) {
    const item = itemRecord(itemId);
    return skillBookDefaultName(item.id, item.name) || item.name || itemId;
  }

  function shopItemDisplayName(row, item) {
    return skillBookVariantName(row.name || item?.name || "", row.note) ||
      (row.itemId && skillBookPrefix(row.name || item?.name || "") ? itemName(row.itemId) : "") ||
      row.name ||
      item?.name ||
      row.itemId ||
      "Shop item";
  }

  function isSkillBookVariantName(name, note) {
    return Boolean(skillBookVariantName(name, note));
  }

  function skillBookVariantName(name, note) {
    const prefix = skillBookPrefix(name);
    const suffix = String(note || "").trim();
    if (!prefix || !suffix) return "";
    return `${prefix}: ${suffix}`;
  }

  function skillBookDefaultName(itemId, name) {
    const prefix = skillBookPrefix(name);
    if (!prefix) return "";
    if (/^SkillBookLevel(10|20|30)$/i.test(itemId || "")) return `${prefix}: Skill book`;
    return "";
  }

  function skillBookPrefix(name) {
    const match = String(name || "").trim().match(/^(Notes|Diary|Journal):/i);
    return match ? match[1] : "";
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
    if (type === "farming") return "Farming";
    if (type === "pet") return "Pets";
    return "Wiki";
  }

  function preferredWikiEntry() {
    return wikiEntriesById.get("skill:Fishery") ||
      wikiEntriesById.get("skill:Agriculture") ||
      wikiEntries.find((entry) => entry.type === "creature") ||
      wikiEntries[0];
  }

  function recipeContext(recipe) {
    return recipe.folder || "General";
  }

  function stationNames(recipe) {
    return uniqueStationIds(recipe).map(itemName);
  }

  function uniqueStationIds(recipe) {
    const seen = new Set();
    const ids = [];
    for (const station of recipe?.stations || []) {
      const stationId = station?.name;
      if (!stationId || seen.has(stationId)) continue;
      seen.add(stationId);
      ids.push(stationId);
    }
    return ids;
  }

  function craftingStationsForRecipes(recipeList) {
    const seen = new Set();
    const ids = [];
    for (const recipe of recipeList || []) {
      for (const stationId of uniqueStationIds(recipe)) {
        if (seen.has(stationId)) continue;
        seen.add(stationId);
        ids.push(stationId);
      }
    }
    return ids.sort((a, b) => itemName(a).localeCompare(itemName(b)));
  }

  function craftingToolsForRecipes(recipeList) {
    const seen = new Set();
    const ids = [];
    for (const recipe of recipeList || []) {
      const toolId = recipe?.toolRequired;
      if (!toolId || seen.has(toolId)) continue;
      seen.add(toolId);
      ids.push(toolId);
    }
    return ids.sort((a, b) => itemName(a).localeCompare(itemName(b)));
  }

  function craftingRequirementsForRecipes(recipeList) {
    const seen = new Set();
    const ids = [];
    for (const recipe of recipeList || []) {
      for (const requirementId of recipe?.bonusesRequired || []) {
        if (!requirementId || seen.has(requirementId)) continue;
        seen.add(requirementId);
        ids.push(requirementId);
      }
    }
    return ids.sort((a, b) => itemName(a).localeCompare(itemName(b)));
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
    if (seconds < 60) return `${seconds} ${seconds === 1 ? "sec" : "sec"}`;

    const minutes = Math.floor(seconds / 60);
    const secondRest = seconds % 60;
    if (minutes < 60) {
      const minuteText = `${minutes} ${minutes === 1 ? "min" : "min"}`;
      return secondRest ? `${minuteText} ${secondRest} sec` : minuteText;
    }

    const hours = Math.floor(minutes / 60);
    const minuteRest = minutes % 60;
    if (hours < 24) {
      const hourText = `${hours} ${hours === 1 ? "hr" : "hr"}`;
      return minuteRest ? `${hourText} ${minuteRest} min` : hourText;
    }

    const days = Math.floor(hours / 24);
    const hourRest = hours % 24;
    const dayText = `${days} ${days === 1 ? "day" : "days"}`;
    return hourRest ? `${dayText} ${hourRest} hr` : dayText;
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
