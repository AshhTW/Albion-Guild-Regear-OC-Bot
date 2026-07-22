import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commandDefinitions } from "./commandDefinitions.js";

const token = process.env.DISCORD_TOKEN ?? "";
const clientId = process.env.DISCORD_CLIENT_ID ?? "";
const guildId = (process.env.DISCORD_GUILD_ID ?? "").trim();

if (!token || !clientId || !guildId) {
  console.error("Missing DISCORD_TOKEN, DISCORD_CLIENT_ID, or DISCORD_GUILD_ID in environment variables.");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);
const body = commandDefinitions.map((cmd) => cmd.toJSON());

async function main() {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  // Clear old global commands so users only see guild commands.
  await rest.put(Routes.applicationCommands(clientId), { body: [] });
  console.log(`Slash commands registered to guild ${guildId}.`);
}

main().catch((error) => {
  console.error("Failed to register slash commands:", error);
  process.exit(1);
});
