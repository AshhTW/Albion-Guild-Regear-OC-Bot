const BATTLE_ID_PATTERNS = [
  /east\.albionbb\.com\/battles\/(\d+)/i,
  /gameinfo-[a-z]+\.albiononline\.com\/api\/gameinfo\/battles\/(\d+)/i
];

export function extractBattleId(input) {
  if (!input) {
    return null;
  }

  for (const pattern of BATTLE_ID_PATTERNS) {
    const match = input.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  if (/^\d+$/.test(input.trim())) {
    return input.trim();
  }

  return null;
}

export function extractUrlAndLocation(content) {
  const tokens = content.trim().split(/\s+/);
  const urlToken = tokens.find((token) => token.includes("albionbb.com/battles/") || token.includes("albiononline.com/api/gameinfo/battles/"));
  const serverToken = tokens.find((token) => /^server=/i.test(token));
  const serverOverride = serverToken ? serverToken.split("=")[1]?.trim().toLowerCase() : null;

  return {
    source: urlToken ?? content,
    serverOverride: serverOverride || null
  };
}
