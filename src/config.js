export const config = {
  discordToken: process.env.DISCORD_TOKEN ?? "",
  defaultServer: (process.env.PRICE_SERVER ?? "east").trim().toLowerCase(),
  targetGuilds: (process.env.TARGET_GUILDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean),
  targetAlliances: (process.env.TARGET_ALLIANCES ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
};

export function validateConfig() {
  if (!config.discordToken) {
    throw new Error("Missing DISCORD_TOKEN in environment variables.");
  }
}
