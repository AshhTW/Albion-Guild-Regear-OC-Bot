import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GAMEINFO_BASE = "https://gameinfo-sgp.albiononline.com/api/gameinfo";
const DATA_BASE = "https://www.albion-online-data.com";
const ALBIONBB_ASIA_API_BASE = "https://api.albionbb.com/asia";
const ALBION_TOOLS_BASE = "https://albiononlinetools.com/economy/item.php";
const LOCAL_ITEMS_JSON_PATH = join(__dirname, "..", "..", "items.json");

const equipmentSlots = ["MainHand", "OffHand", "Head", "Armor", "Shoes", "Cape"];

const itemNameCache = new Map();
const priceCache = new Map();
let localItemNameMapPromise = null;

const ALLOWED_SERVERS = new Set(["east", "west", "europe"]);
const ALL_SERVERS = ["east", "west", "europe"];
const QUALITY_BY_LEVEL = {
  1: "Normal",
  2: "Good",
  3: "Outstanding",
  4: "Excellent",
  5: "Masterpiece"
};
const QUALITY_FALLBACK_ORDER = {
  Masterpiece: ["Excellent", "Outstanding", "Good", "Normal"],
  Excellent: ["Outstanding", "Good", "Normal"],
  Outstanding: ["Good", "Normal", "Excellent"],
  Good: ["Normal", "Outstanding", "Excellent"],
  Normal: ["Outstanding", "Good", "Excellent"]
};

const TIER_PREFIX_WORDS = [
  "novice",
  "journeyman",
  "adept",
  "expert",
  "master",
  "grandmaster",
  "elder",
  "新手",
  "學徒",
  "学徒",
  "老手",
  "專家",
  "专家",
  "大師",
  "大师",
  "宗師",
  "宗师",
  "元老",
  "遠古",
  "远古"
];
const TIER_PREFIX_REGEX = new RegExp(
  `^(?:${TIER_PREFIX_WORDS.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:級|级)?(?:\\s*'s|\\s*的)?\\s*`,
  "i"
);

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.text();
}

function normalizeItemId(itemId) {
  if (!itemId || typeof itemId !== "string") {
    return null;
  }
  return itemId.trim();
}

function toBaseItemId(itemId) {
  const normalized = normalizeItemId(itemId);
  if (!normalized) {
    return null;
  }
  return normalized.split("@")[0];
}

function parseSilver(raw) {
  const normalized = String(raw ?? "").replace(/[^\d]/g, "");
  return normalized ? Number(normalized) : 0;
}

function getSlotType(equipment, slot) {
  const slotData = equipment?.[slot];
  if (!slotData) {
    return null;
  }
  if (typeof slotData === "string") {
    return slotData;
  }
  if (typeof slotData === "object") {
    return slotData.Type ?? slotData.type ?? null;
  }
  return null;
}

function getSlotQuality(equipment, slot) {
  const slotData = equipment?.[slot];
  if (!slotData || typeof slotData !== "object") {
    return null;
  }
  const level = Number(slotData.Quality ?? slotData.quality ?? 0);
  return QUALITY_BY_LEVEL[level] ?? null;
}

function getPlayerName(player) {
  return player?.Name ?? player?.name ?? player?.PlayerName ?? "Unknown Player";
}

function getDeathsCount(player) {
  return Number(player?.Deaths ?? player?.deaths ?? player?.DeathsCount ?? 0);
}

function findPlayersArray(battleJson) {
  if (Array.isArray(battleJson?.players)) {
    return battleJson.players;
  }
  if (Array.isArray(battleJson?.Players)) {
    return battleJson.Players;
  }
  if (Array.isArray(battleJson?.involvedPlayers)) {
    return battleJson.involvedPlayers;
  }
  return [];
}

function stripTierPrefix(name) {
  let output = String(name ?? "").trim();
  while (TIER_PREFIX_REGEX.test(output)) {
    output = output.replace(TIER_PREFIX_REGEX, "").trim();
  }
  return output;
}

async function fetchItemName(baseItemId) {
  if (itemNameCache.has(baseItemId)) {
    return itemNameCache.get(baseItemId);
  }

  const prettify = (id) =>
    id
      .replace(/^T\d+_/, "")
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());

  if (!localItemNameMapPromise) {
    localItemNameMapPromise = (async () => {
      try {
        const text = await readFile(LOCAL_ITEMS_JSON_PATH, "utf8");
        const json = JSON.parse(text);
        const map = new Map();

        if (Array.isArray(json)) {
          for (const row of json) {
            const id = row?.UniqueName;
            const name =
              row?.LocalizedNames?.["ZH-TW"] ??
              row?.LocalizedNames?.["ZH-CN"] ??
              row?.LocalizedNames?.["EN-US"];
            if (id && name) {
              map.set(id, stripTierPrefix(name));
            }
          }
        } else if (json && typeof json === "object") {
          for (const [id, row] of Object.entries(json)) {
            const name =
              row?.LocalizedNames?.["ZH-TW"] ??
              row?.LocalizedNames?.["ZH-CN"] ??
              row?.LocalizedNames?.["EN-US"] ??
              row?.name ??
              row?.Name;
            if (id && name) {
              map.set(id, stripTierPrefix(name));
            }
          }
        }

        return map;
      } catch {
        return new Map();
      }
    })();
  }

  const localNameMap = await localItemNameMapPromise;
  const localName = localNameMap.get(baseItemId);
  if (localName) {
    itemNameCache.set(baseItemId, localName);
    return localName;
  }

  const dataProjectUrl = `${DATA_BASE}/items/${encodeURIComponent(baseItemId)}`;
  const gameInfoUrl = `${GAMEINFO_BASE}/items/${encodeURIComponent(baseItemId)}/data`;

  try {
    const itemData = await fetchJson(dataProjectUrl);
    const rawName =
      itemData?.LocalizedNames?.["ZH-TW"] ??
      itemData?.localizedNames?.["ZH-TW"] ??
      itemData?.LocalizedNames?.["ZH-CN"] ??
      itemData?.localizedNames?.["ZH-CN"] ??
      itemData?.LocalizedNames?.["EN-US"] ??
      itemData?.localizedNames?.["EN-US"];
    const name = stripTierPrefix(rawName) || itemData?.UniqueName || itemData?.uniqueName || baseItemId;
    itemNameCache.set(baseItemId, name);
    return name;
  } catch {
    try {
      const gameInfoData = await fetchJson(gameInfoUrl);
      const gameInfoName =
        gameInfoData?.localizedNames?.["ZH-TW"] ??
        gameInfoData?.localizedNames?.["ZH-CN"] ??
        gameInfoData?.localizedNames?.["EN-US"] ??
        gameInfoData?.uniqueName;
      const name = stripTierPrefix(gameInfoName) || prettify(baseItemId);
      itemNameCache.set(baseItemId, name);
      return name;
    } catch {
      const fallbackName = prettify(baseItemId);
      itemNameCache.set(baseItemId, fallbackName);
      return fallbackName;
    }
  }
}

function parseSellOrdersFromToolsHtml(html) {
  const sellSection = html.match(/<div id="sellOrders"[\s\S]*?<div id="buyOrders"/i)?.[0] ?? "";
  if (!sellSection) {
    return [];
  }

  const rowRegex =
    /<td[^>]*>\s*([A-Za-z][^<]*?)\s*<\/td>\s*<td[^>]*>[\s\S]*?<i class="fas fa-coins[^>]*><\/i>\s*([\d,]+)/gi;
  const orders = [];
  let row;
  while ((row = rowRegex.exec(sellSection)) !== null) {
    const marketLabel = row[1].trim();
    const price = parseSilver(row[2]);
    if (price > 0) {
      const qualityMatch = marketLabel.match(/\(([^)]+)\)\s*$/);
      const qualityLabel = qualityMatch?.[1]?.trim() ?? null;
      orders.push({ marketLabel, qualityLabel, price });
    }
  }

  orders.sort((a, b) => a.price - b.price);
  return orders;
}

async function fetchToolsOrders(itemId, server, qualityLabel) {
  const cacheKey = `${server}::${itemId}::${qualityLabel ?? "ANY"}::orders`;
  if (priceCache.has(cacheKey)) {
    return priceCache.get(cacheKey);
  }

  const url = `${ALBION_TOOLS_BASE}?itemPrice=${encodeURIComponent(itemId)}&server=${encodeURIComponent(server)}#price_search`;
  try {
    const html = await fetchText(url);
    const parsed = parseSellOrdersFromToolsHtml(html);
    const filtered = qualityLabel
      ? parsed.filter((o) => String(o.qualityLabel ?? "").toLowerCase() === qualityLabel.toLowerCase())
      : parsed;
    priceCache.set(cacheKey, filtered);
    return filtered;
  } catch {
    const fallback = [];
    priceCache.set(cacheKey, fallback);
    return fallback;
  }
}

function averageFirstN(values, count) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const slice = values.slice(0, count);
  if (slice.length === 0) {
    return 0;
  }
  const sum = slice.reduce((acc, value) => acc + value, 0);
  return Math.round(sum / slice.length);
}

function pickSecondAmong(values) {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (sorted.length >= 2) {
    return sorted[1];
  }
  return sorted[0] ?? 0;
}

function getFallbackQualityCandidates(originalQualityLabel) {
  const quality = String(originalQualityLabel ?? "").trim();
  const order = QUALITY_FALLBACK_ORDER[quality];
  if (!order) {
    return QUALITY_FALLBACK_ORDER.Normal;
  }
  return order;
}

async function fetchCheapestAcrossRegions(itemId, qualityLabel) {
  let bestPrice = 0;
  let bestLocation = null;
  for (const region of ALL_SERVERS) {
    const regionOrders = await fetchToolsOrders(itemId, region, qualityLabel);
    const cheapest = regionOrders[0]?.price ?? 0;
    if (cheapest > 0 && (bestPrice === 0 || cheapest < bestPrice)) {
      bestPrice = cheapest;
      bestLocation = regionOrders[0]?.marketLabel ?? `${region.toUpperCase()} cheapest`;
    }
  }
  return { price: bestPrice, marketLabel: bestLocation };
}

async function fetchSmartPrice(itemId, server, qualityLabel) {
  const selectedOrders = await fetchToolsOrders(itemId, server, qualityLabel);
  const selectedPrices = selectedOrders.map((o) => o.price);
  const cheapest = selectedPrices[0] ?? 0;

  if (selectedOrders.length > 5 && cheapest > 1_000_000) {
    return {
      price: averageFirstN(selectedPrices, 5),
      marketLabel: `${server.toUpperCase()} avg of first 5`,
      method: "avg_first_5",
      effectiveQualityLabel: qualityLabel ?? null,
      fallbackFromQualityLabel: null
    };
  }

  if (selectedOrders.length < 5) {
    const perRegionRepresentativePrices = [];
    for (const region of ALL_SERVERS) {
      const regionOrders = await fetchToolsOrders(itemId, region, qualityLabel);
      const regionPrice =
        regionOrders.length >= 5
          ? averageFirstN(regionOrders.map((o) => o.price), 5)
          : (regionOrders[0]?.price ?? 0);
      if (regionPrice > 0) {
        perRegionRepresentativePrices.push(regionPrice);
      }
    }

    const secondCheapestAcrossRegions = pickSecondAmong(perRegionRepresentativePrices);
    if (secondCheapestAcrossRegions > 0) {
      return {
        price: secondCheapestAcrossRegions,
        marketLabel: "2nd among 3-region representative prices",
        method: "second_of_regions",
        effectiveQualityLabel: qualityLabel ?? null,
        fallbackFromQualityLabel: null
      };
    }
  }

  if (cheapest > 0) {
    return {
      price: cheapest,
      marketLabel: selectedOrders[0]?.marketLabel ?? null,
      method: "cheapest",
      effectiveQualityLabel: qualityLabel ?? null,
      fallbackFromQualityLabel: null
    };
  }

  const fallbackCandidates = getFallbackQualityCandidates(qualityLabel);
  for (const fallbackQualityLabel of fallbackCandidates) {
    if (!fallbackQualityLabel || fallbackQualityLabel === qualityLabel) {
      continue;
    }
    const fallback = await fetchCheapestAcrossRegions(itemId, fallbackQualityLabel);
    if (fallback.price > 0) {
      return {
        price: fallback.price,
        marketLabel: fallback.marketLabel,
        method: "fallback_quality_region_cheapest",
        effectiveQualityLabel: fallbackQualityLabel,
        fallbackFromQualityLabel: qualityLabel ?? null
      };
    }
  }

  return {
    price: 0,
    marketLabel: null,
    method: "no_data",
    effectiveQualityLabel: qualityLabel ?? null,
    fallbackFromQualityLabel: null
  };
}

async function fetchCheapestPrices(itemIds, server) {
  const entries = await Promise.all(
    itemIds.map(async (itemId) => {
      const [rawItemId, rawQuality] = String(itemId).split("::");
      return [itemId, await fetchSmartPrice(rawItemId, server, rawQuality || null)];
    })
  );
  return Object.fromEntries(entries);
}

function getTierEnchantLabel(itemId) {
  const tierMatch = String(itemId).match(/^T(\d+)_/i);
  const enchantMatch = String(itemId).match(/@(\d+)/);
  const tier = tierMatch?.[1] ?? "?";
  const enchant = enchantMatch?.[1] ?? "0";
  return `${tier}.${enchant}`;
}

function mapEquipmentToItems(equipment) {
  const items = [];
  for (const slot of equipmentSlots) {
    const fullItemId = normalizeItemId(getSlotType(equipment, slot));
    if (!fullItemId) {
      continue;
    }
    const baseItemId = toBaseItemId(fullItemId);
    if (!baseItemId) {
      continue;
    }
    const qualityLabel = getSlotQuality(equipment, slot);
    items.push({ slot, itemId: fullItemId, baseItemId, qualityLabel });
  }
  return items;
}

function collectDeathsFromPlayers(players) {
  const deaths = [];
  for (const player of players) {
    const deathsCount = getDeathsCount(player);
    const equipment = player?.Equipment ?? player?.equipment;
    if (deathsCount <= 0 || !equipment) {
      continue;
    }
    const items = mapEquipmentToItems(equipment);
    if (items.length === 0) {
      continue;
    }
    deaths.push({
      playerName: getPlayerName(player),
      guildName: player?.GuildName ?? player?.guildName ?? player?.Guild ?? player?.guild ?? null,
      allianceName:
        player?.AllianceName ?? player?.allianceName ?? player?.Alliance ?? player?.alliance ?? null,
      deathsCount,
      items
    });
  }
  return deaths;
}

async function fetchBattleEventsFallback(battleId) {
  const killsUrl = `${ALBIONBB_ASIA_API_BASE}/battles/kills?ids=${encodeURIComponent(battleId)}`;
  let kills = [];
  try {
    kills = await fetchJson(killsUrl);
  } catch {
    return [];
  }

  if (!Array.isArray(kills) || kills.length === 0) {
    return [];
  }

  const eventIds = [...new Set(kills.map((k) => k?.EventId).filter(Boolean))];
  if (eventIds.length === 0) {
    return [];
  }

  const allRows = [];
  for (const eventId of eventIds) {
    try {
      const row = await fetchJson(`${GAMEINFO_BASE}/events/${encodeURIComponent(eventId)}`);
      if (row) {
        allRows.push(row);
      }
    } catch {
      continue;
    }
  }

  if (allRows.length === 0) {
    return [];
  }

  const deadPlayers = [];
  for (const row of allRows) {
    const victim = row?.Victim ?? row?.victim;
    const equipment = victim?.Equipment ?? victim?.equipment;
    if (!victim || !equipment) {
      continue;
    }
    const items = mapEquipmentToItems(equipment);
    if (items.length === 0) {
      continue;
    }
    deadPlayers.push({
      playerName: victim?.Name ?? victim?.name ?? "Unknown Player",
      guildName: victim?.GuildName ?? victim?.guildName ?? victim?.Guild ?? victim?.guild ?? null,
      allianceName:
        victim?.AllianceName ?? victim?.allianceName ?? victim?.Alliance ?? victim?.alliance ?? null,
      deathsCount: 1,
      items
    });
  }

  return deadPlayers;
}

async function fetchAlbionBbKillsFallback(battleId) {
  const url = `${ALBIONBB_ASIA_API_BASE}/battles/kills?ids=${encodeURIComponent(battleId)}`;
  let rows = [];
  try {
    rows = await fetchJson(url);
  } catch {
    return [];
  }

  if (!Array.isArray(rows)) {
    return [];
  }

  const deadPlayers = [];
  for (const row of rows) {
    const victim = row?.Victim ?? row?.victim;
    const equipment = victim?.Equipment ?? victim?.equipment;
    if (!victim || !equipment) {
      continue;
    }
    const items = mapEquipmentToItems(equipment);
    if (items.length === 0) {
      continue;
    }
    deadPlayers.push({
      playerName: victim?.Name ?? victim?.name ?? "Unknown Player",
      guildName: victim?.GuildName ?? victim?.guildName ?? victim?.Guild ?? victim?.guild ?? null,
      allianceName:
        victim?.AllianceName ?? victim?.allianceName ?? victim?.Alliance ?? victim?.alliance ?? null,
      deathsCount: 1,
      items
    });
  }

  return deadPlayers;
}

export async function calculateBattleRegear({
  battleId,
  server,
  targetGuilds = [],
  targetAlliances = []
}) {
  const normalizedServer = ALLOWED_SERVERS.has(String(server).toLowerCase())
    ? String(server).toLowerCase()
    : "east";

  const battleUrl = `${GAMEINFO_BASE}/battles/${battleId}`;
  const battleJson = await fetchJson(battleUrl);

  const players = findPlayersArray(battleJson);
  let deaths = collectDeathsFromPlayers(players);

  if (deaths.length === 0) {
    deaths = await fetchBattleEventsFallback(battleId);
  }
  if (deaths.length === 0) {
    deaths = await fetchAlbionBbKillsFallback(battleId);
  }
  if (deaths.length === 0) {
    throw new Error("No dead players with equipment found. API structure may have changed.");
  }

  const normalizedGuilds = targetGuilds.map((g) => String(g).trim().toLowerCase()).filter(Boolean);
  const normalizedAlliances = targetAlliances
    .map((a) => String(a).trim().toLowerCase())
    .filter(Boolean);

  if (normalizedGuilds.length > 0 || normalizedAlliances.length > 0) {
    deaths = deaths.filter((d) => {
      const guildMatched =
        normalizedGuilds.length > 0 &&
        normalizedGuilds.includes(String(d.guildName ?? "").trim().toLowerCase());
      const allianceMatched =
        normalizedAlliances.length > 0 &&
        normalizedAlliances.includes(String(d.allianceName ?? "").trim().toLowerCase());
      return guildMatched || allianceMatched;
    });

    if (deaths.length === 0) {
      const parts = [];
      if (targetGuilds.length > 0) {
        parts.push(`guild: ${targetGuilds.join(", ")}`);
      }
      if (targetAlliances.length > 0) {
        parts.push(`alliance: ${targetAlliances.join(", ")}`);
      }
      throw new Error(`No dead players found for configured filter (${parts.join(" | ")})`);
    }
  }

  const uniquePriceItems = [
    ...new Set(deaths.flatMap((d) => d.items.map((i) => `${i.itemId}::${i.qualityLabel ?? ""}`)))
  ];
  const uniqueBaseItems = [...new Set(deaths.flatMap((d) => d.items.map((i) => i.baseItemId)))];

  const [priceByItem, nameEntries] = await Promise.all([
    fetchCheapestPrices(uniquePriceItems, normalizedServer),
    Promise.all(uniqueBaseItems.map(async (baseItemId) => [baseItemId, await fetchItemName(baseItemId)]))
  ]);

  const nameByBaseItem = Object.fromEntries(nameEntries);

  const playersWithCost = deaths.map((dead) => {
    const detailedItems = dead.items.map((item) => ({
      ...item,
      name: nameByBaseItem[item.baseItemId] ?? item.baseItemId,
      tierEnchant: getTierEnchantLabel(item.itemId),
      qualityLabel: item.qualityLabel ?? null,
      price: priceByItem[`${item.itemId}::${item.qualityLabel ?? ""}`]?.price ?? 0,
      bestLocation: priceByItem[`${item.itemId}::${item.qualityLabel ?? ""}`]?.marketLabel ?? null,
      pricingMethod: priceByItem[`${item.itemId}::${item.qualityLabel ?? ""}`]?.method ?? "cheapest",
      effectiveQualityLabel:
        priceByItem[`${item.itemId}::${item.qualityLabel ?? ""}`]?.effectiveQualityLabel ??
        item.qualityLabel ??
        null,
      fallbackFromQualityLabel:
        priceByItem[`${item.itemId}::${item.qualityLabel ?? ""}`]?.fallbackFromQualityLabel ?? null
    }));

    const costPerDeath = detailedItems.reduce((sum, item) => sum + item.price, 0);
    return {
      playerName: dead.playerName,
      guildName: dead.guildName ?? "Unknown Guild",
      allianceName: dead.allianceName ?? "Unknown Alliance",
      deathsCount: dead.deathsCount,
      items: detailedItems,
      costPerDeath,
      totalCost: costPerDeath * dead.deathsCount
    };
  });

  playersWithCost.sort((a, b) => b.totalCost - a.totalCost);
  const grandTotal = playersWithCost.reduce((sum, player) => sum + player.totalCost, 0);

  return {
    battleId,
    server: normalizedServer,
    guildFilter: targetGuilds,
    allianceFilter: targetAlliances,
    playerCount: playersWithCost.length,
    grandTotal,
    players: playersWithCost
  };
}
