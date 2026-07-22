import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STORE_PATH = join(__dirname, "..", "..", "data", "oc-store.json");

function normalizePlayerName(name) {
  return String(name ?? "").trim().toLowerCase();
}

function sanitizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return 0;
  }
  return Math.trunc(amount);
}

async function ensureStoreFile() {
  await mkdir(dirname(STORE_PATH), { recursive: true });
}

async function loadStore() {
  await ensureStoreFile();
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { players: {}, updatedAt: new Date().toISOString() };
    }
    return {
      players: parsed.players && typeof parsed.players === "object" ? parsed.players : {},
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString()
    };
  } catch {
    return { players: {}, updatedAt: new Date().toISOString() };
  }
}

async function saveStore(store) {
  await ensureStoreFile();
  const payload = JSON.stringify(
    {
      players: store.players ?? {},
      updatedAt: new Date().toISOString()
    },
    null,
    2
  );
  await writeFile(STORE_PATH, payload, "utf8");
}

function setEntry(players, playerName, balance) {
  const normalized = normalizePlayerName(playerName);
  if (!normalized) {
    return;
  }
  players[normalized] = {
    name: String(playerName).trim(),
    balance: sanitizeAmount(balance)
  };
}

export async function setAllOcBalances(entries) {
  const players = {};
  for (const [playerName, balance] of Object.entries(entries ?? {})) {
    setEntry(players, playerName, balance);
  }
  const store = { players, updatedAt: new Date().toISOString() };
  await saveStore(store);
  return store;
}

export async function applyOcDeltas(entries) {
  const store = await loadStore();

  for (const [playerName, deltaRaw] of Object.entries(entries ?? {})) {
    const normalized = normalizePlayerName(playerName);
    if (!normalized) {
      continue;
    }

    const delta = sanitizeAmount(deltaRaw);
    if (!Number.isFinite(delta) || delta === 0) {
      continue;
    }

    const current = store.players[normalized] ?? {
      name: String(playerName).trim(),
      balance: 0
    };

    current.name = current.name || String(playerName).trim();
    current.balance = sanitizeAmount(current.balance + delta);
    store.players[normalized] = current;
  }

  await saveStore(store);
  return store;
}

export async function addOcBalance(playerName, amountDelta) {
  const normalized = normalizePlayerName(playerName);
  if (!normalized) {
    throw new Error("玩家名稱不可為空。");
  }

  const delta = sanitizeAmount(amountDelta);
  const store = await loadStore();
  const current = store.players[normalized] ?? {
    name: String(playerName).trim(),
    balance: 0
  };
  current.name = String(playerName).trim() || current.name;
  current.balance = sanitizeAmount(current.balance + delta);
  store.players[normalized] = current;
  await saveStore(store);
  return current;
}

export async function setOcBalance(playerName, amount) {
  const normalized = normalizePlayerName(playerName);
  if (!normalized) {
    throw new Error("玩家名稱不可為空。");
  }

  const store = await loadStore();
  store.players[normalized] = {
    name: String(playerName).trim(),
    balance: sanitizeAmount(amount)
  };
  await saveStore(store);
  return store.players[normalized];
}

export async function wipeOcBalance(playerName) {
  const normalized = normalizePlayerName(playerName);
  if (!normalized) {
    throw new Error("玩家名稱不可為空。");
  }

  const store = await loadStore();
  const removed = store.players[normalized] ?? null;
  delete store.players[normalized];
  await saveStore(store);
  return removed;
}

export async function listOcBalances() {
  const store = await loadStore();
  const rows = Object.values(store.players)
    .map((entry) => ({
      name: String(entry?.name ?? "").trim(),
      balance: sanitizeAmount(entry?.balance ?? 0)
    }))
    .filter((entry) => entry.name.length > 0);

  rows.sort((a, b) => {
    const aDebt = a.balance < 0 ? 1 : 0;
    const bDebt = b.balance < 0 ? 1 : 0;
    if (aDebt !== bDebt) {
      return aDebt - bDebt;
    }
    if (b.balance !== a.balance) {
      return b.balance - a.balance;
    }
    return a.name.localeCompare(b.name, "zh-Hant");
  });

  return rows;
}
