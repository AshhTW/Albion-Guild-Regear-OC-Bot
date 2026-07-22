import "dotenv/config";
import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits
} from "discord.js";
import { config, validateConfig } from "./config.js";
import { extractBattleId, extractUrlAndLocation } from "./utils/battle.js";
import { formatSilver } from "./utils/format.js";
import { calculateBattleRegear } from "./services/albionApi.js";
import { addOcBalance, applyOcDeltas, listOcBalances, setOcBalance, wipeOcBalance } from "./services/ocStore.js";

validateConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});
const EMBED_FOOTER_TEXT = "Made with love by AshhTW ❤️";
const DISCORD_EMBED_MAX_FIELDS = 25;
const DISCORD_EMBED_MAX_LENGTH = 6000;
const DISCORD_EMBED_MAX_FIELD_VALUE = 1024;

function hasManagePermission(memberPermissions) {
  return Boolean(
    memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
      memberPermissions?.has(PermissionFlagsBits.Administrator)
  );
}

function isPrivilegedInteraction(interaction) {
  if (interaction.guild && interaction.user.id === interaction.guild.ownerId) {
    return true;
  }
  return hasManagePermission(interaction.memberPermissions);
}

async function isPrivilegedMessage(message) {
  if (!message.guild) {
    return false;
  }
  if (message.author.id === message.guild.ownerId) {
    return true;
  }
  if (hasManagePermission(message.memberPermissions)) {
    return true;
  }
  if (hasManagePermission(message.member?.permissions)) {
    return true;
  }

  const fetchedMember = await message.guild.members.fetch(message.author.id).catch(() => null);
  return hasManagePermission(fetchedMember?.permissions);
}

function buildRegearEmbeds(result) {
  const normalizedGuildFilters = (config.targetGuilds ?? [])
    .map((g) => String(g).trim().toLowerCase())
    .filter(Boolean);
  const normalizedAllianceFilters = (config.targetAlliances ?? [])
    .map((a) => String(a).trim().toLowerCase())
    .filter(Boolean);

  const classifyPlayer = (player) => {
    const playerGuild = String(player.guildName ?? "").trim().toLowerCase();
    const playerAlliance = String(player.allianceName ?? "").trim().toLowerCase();
    const guildMatched =
      normalizedGuildFilters.length > 0 && normalizedGuildFilters.includes(playerGuild);
    const allianceMatched =
      normalizedAllianceFilters.length > 0 && normalizedAllianceFilters.includes(playerAlliance);
    return { guildMatched, allianceMatched };
  };

  const qualityDisplay = {
    Normal: "沒邊",
    Good: "鐵邊",
    Outstanding: "銅邊",
    Excellent: "銀邊",
    Masterpiece: "金邊"
  };

  const displayPlayers = [...result.players].sort((a, b) => {
    const aClass = classifyPlayer(a);
    const bClass = classifyPlayer(b);
    const aPriority = aClass.guildMatched ? 0 : aClass.allianceMatched ? 1 : 2;
    const bPriority = bClass.guildMatched ? 0 : bClass.allianceMatched ? 1 : 2;

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    if (aPriority === 1 && bPriority === 1) {
      const aGuild = String(a.guildName ?? "").trim().toLowerCase();
      const bGuild = String(b.guildName ?? "").trim().toLowerCase();
      const guildCmp = aGuild.localeCompare(bGuild);
      if (guildCmp !== 0) {
        return guildCmp;
      }
    }
    return b.totalCost - a.totalCost;
  });

  const maxPlayers = displayPlayers.length;
  const title = `Re裝費用統計 ID#${result.battleId}`;
  const description = [
    `死亡玩家數: **${result.playerCount}**`,
    `總Re裝費用: **${formatSilver(result.grandTotal)}**`
  ].join("\n");
  const baseLength = title.length + description.length + EMBED_FOOTER_TEXT.length;
  const pageFields = [];
  let currentPageFields = [];
  let currentPageLength = baseLength;

  for (let i = 0; i < maxPlayers; i += 1) {
    const player = displayPlayers[i];
    const { guildMatched, allianceMatched } = classifyPlayer(player);
    const allianceOnlyTag =
      !guildMatched && allianceMatched ? ` (聯盟: ${player.guildName ?? "未知公會"})` : "";
    const allItems = [...player.items]
      .sort((a, b) => b.price - a.price)
      .map((item) => {
        const effectiveQuality = item.effectiveQualityLabel ?? item.qualityLabel ?? null;
        const quality = qualityDisplay[effectiveQuality] ?? effectiveQuality ?? "未知邊";
        let note = "";
        if (
          item.fallbackFromQualityLabel &&
          item.effectiveQualityLabel &&
          item.fallbackFromQualityLabel !== item.effectiveQualityLabel
        ) {
          const fromQuality =
            qualityDisplay[item.fallbackFromQualityLabel] ?? item.fallbackFromQualityLabel ?? "原邊";
          const toQuality = qualityDisplay[item.effectiveQualityLabel] ?? item.effectiveQualityLabel;
          note = ` [無${fromQuality}改抓${toQuality}]`;
        } else if ((item.price ?? 0) === 0) {
          note = " [無數據]";
        }
        return `${item.tierEnchant} ${item.name} (${quality}): ${formatSilver(item.price)}${note}`;
      })
      .join("\n");
    const field = {
      name: `${i + 1}. ${player.playerName}${allianceOnlyTag}`,
      value: [`總計: **${formatSilver(player.totalCost)}**`, allItems || "無"].join("\n")
    };

    if (field.value.length > DISCORD_EMBED_MAX_FIELD_VALUE) {
      // Preserve full player data by moving overflow lines into continuation fields.
      const lines = field.value.split("\n");
      const chunks = [];
      let chunk = "";
      for (const line of lines) {
        const candidate = chunk ? `${chunk}\n${line}` : line;
        if (candidate.length <= DISCORD_EMBED_MAX_FIELD_VALUE) {
          chunk = candidate;
          continue;
        }
        if (chunk) {
          chunks.push(chunk);
        }
        chunk = line.slice(0, DISCORD_EMBED_MAX_FIELD_VALUE);
      }
      if (chunk) {
        chunks.push(chunk);
      }

      for (let c = 0; c < chunks.length; c += 1) {
        const chunkField = {
          name: c === 0 ? field.name : `${i + 1}. ${player.playerName}${allianceOnlyTag} (續)`,
          value: chunks[c]
        };
        const chunkLength = chunkField.name.length + chunkField.value.length;
        if (
          currentPageFields.length >= DISCORD_EMBED_MAX_FIELDS ||
          currentPageLength + chunkLength > DISCORD_EMBED_MAX_LENGTH
        ) {
          if (currentPageFields.length > 0) {
            pageFields.push(currentPageFields);
          }
          currentPageFields = [];
          currentPageLength = baseLength;
        }
        currentPageFields.push(chunkField);
        currentPageLength += chunkLength;
      }
      continue;
    }

    const fieldLength = field.name.length + field.value.length;
    if (
      currentPageFields.length >= DISCORD_EMBED_MAX_FIELDS ||
      currentPageLength + fieldLength > DISCORD_EMBED_MAX_LENGTH
    ) {
      if (currentPageFields.length > 0) {
        pageFields.push(currentPageFields);
      }
      currentPageFields = [];
      currentPageLength = baseLength;
    }

    currentPageFields.push(field);
    currentPageLength += fieldLength;
  }

  if (currentPageFields.length > 0) {
    pageFields.push(currentPageFields);
  }

  if (pageFields.length === 0) {
    return [
      new EmbedBuilder()
        .setColor(0xe6b800)
        .setTitle(`${title} (1/1)`)
        .setDescription(description)
        .setFooter({ text: EMBED_FOOTER_TEXT })
        .setTimestamp(new Date())
    ];
  }

  const totalPages = Math.max(pageFields.length, 1);
  return pageFields.map((fields, idx) =>
    new EmbedBuilder()
      .setColor(0xe6b800)
      .setTitle(`${title} (${idx + 1}/${totalPages})`)
      .setDescription(description)
      .addFields(fields)
      .setFooter({ text: EMBED_FOOTER_TEXT })
      .setTimestamp(new Date())
  );
}

function chunkLines(lines, maxChars = 3300, maxLines = 35) {
  const pages = [];
  let current = [];
  let length = 0;

  for (const line of lines) {
    const projected = length + line.length + 1;
    if (current.length >= maxLines || projected > maxChars) {
      pages.push(current);
      current = [];
      length = 0;
    }
    current.push(line);
    length += line.length + 1;
  }
  if (current.length > 0) {
    pages.push(current);
  }
  return pages;
}

function buildOcListEmbeds(rows, title) {
  if (!rows.length) {
    return [
      new EmbedBuilder()
        .setColor(0x00a86b)
        .setTitle(title)
        .setDescription("目前沒有OC紀錄.")
        .setFooter({ text: EMBED_FOOTER_TEXT })
        .setTimestamp(new Date())
    ];
  }

  const lines = rows.map((row, idx) => `${idx + 1}. ${row.name}: **${formatSilver(row.balance)}**`);
  const pages = chunkLines(lines);
  return pages.map((pageLines, idx) =>
    new EmbedBuilder()
      .setColor(0x00a86b)
      .setTitle(`${title} (${idx + 1}/${pages.length})`)
      .setDescription(pageLines.join("\n"))
      .setFooter({ text: EMBED_FOOTER_TEXT })
      .setTimestamp(new Date())
  );
}

function buildDebtEmbed(rows) {
  const debts = rows.filter((row) => row.balance < 0);
  if (!debts.length) {
    return new EmbedBuilder()
      .setColor(0x3ba55d)
      .setTitle("OC 負債清單")
      .setDescription("目前無負債玩家.")
      .setFooter({ text: EMBED_FOOTER_TEXT })
      .setTimestamp(new Date());
  }

  const debtLines = debts.map(
    (row, idx) => `${idx + 1}. ${row.name}: - **${formatSilver(Math.abs(row.balance))}** OC`
  );
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("OC 負債清單")
    .setDescription(debtLines.join("\n").slice(0, 3900))
    .setFooter({ text: EMBED_FOOTER_TEXT })
    .setTimestamp(new Date());
}

async function sendEmbedsFromMessage(baseMessage, embeds) {
  if (!embeds.length) {
    return;
  }
  await baseMessage.edit({ content: null, embeds: [embeds[0]] });
  for (let i = 1; i < embeds.length; i += 1) {
    await baseMessage.channel.send({ embeds: [embeds[i]] });
  }
}

async function sendEmbedsFromInteraction(interaction, embeds) {
  if (!embeds.length) {
    await interaction.editReply("沒有可顯示資料.");
    return;
  }
  await interaction.editReply({ content: null, embeds: [embeds[0]] });
  for (let i = 1; i < embeds.length; i += 1) {
    await interaction.followUp({ embeds: [embeds[i]] });
  }
}

function parseOcFields(line) {
  const quotedFields = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1].trim());
  if (quotedFields.length >= 4) {
    return quotedFields.slice(0, 4);
  }

  const tabFields = line
    .split(/\t+/)
    .map((field) => field.trim())
    .filter(Boolean);
  if (tabFields.length >= 4) {
    return tabFields.slice(0, 4);
  }

  const spacedFields = line
    .split(/\s{2,}/)
    .map((field) => field.trim())
    .filter(Boolean);
  if (spacedFields.length >= 4) {
    return spacedFields.slice(0, 4);
  }

  return null;
}

function parseOcLogFromText(text) {
  const balances = {};
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("```")) {
      continue;
    }

    const fields = parseOcFields(line);
    if (!fields) {
      continue;
    }

    const dateToken = String(fields[0] ?? "").trim().toLowerCase();
    const playerToken = String(fields[1] ?? "").trim().toLowerCase();
    const reasonToken = String(fields[2] ?? "").trim().toLowerCase();
    const amountToken = String(fields[3] ?? "").trim().toLowerCase();
    if (
      dateToken === "日期" ||
      dateToken === "date" ||
      playerToken === "玩家" ||
      playerToken === "player" ||
      reasonToken === "原因" ||
      reasonToken === "reason" ||
      reasonToken === "action" ||
      amountToken === "数量" ||
      amountToken === "數量" ||
      amountToken === "amount"
    ) {
      continue;
    }

    const player = String(fields[1] ?? "").trim();
    let amount = Number(String(fields[3] ?? "").replace(/,/g, ""));
    if (!player || !Number.isFinite(amount)) {
      continue;
    }

    amount = Math.trunc(amount);
    const reason = String(fields[2] ?? "").trim();
    if (reason === "取出" && amount > 0) {
      amount = -amount;
    } else if (reason === "存入" && amount < 0) {
      amount = Math.abs(amount);
    }

    balances[player] = (balances[player] ?? 0) + amount;
  }
  return balances;
}

async function extractOcLogTextFromMessage(message) {
  const inline = String(message?.content ?? "").trim();
  if (inline) {
    return inline;
  }

  const attachments = [...(message?.attachments?.values?.() ?? [])];
  if (attachments.length === 0) {
    return "";
  }

  const textAttachment = attachments.find((file) => {
    const name = String(file?.name ?? "").toLowerCase();
    const contentType = String(file?.contentType ?? "").toLowerCase();
    return (
      name.endsWith(".txt") ||
      name.endsWith(".csv") ||
      contentType.includes("text/plain") ||
      contentType.includes("text/csv")
    );
  });

  if (!textAttachment?.url) {
    return "";
  }

  const response = await fetch(textAttachment.url);
  if (!response.ok) {
    throw new Error(`讀取附件失敗 (${response.status})`);
  }
  return response.text();
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[Ready] Logged in as ${readyClient.user.tag}`);
  console.log("[Commands] Use `npm run register` to register slash commands.");
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (!isPrivilegedInteraction(interaction)) {
    await interaction.reply({ content: "你沒有使用此指令的權限.", ephemeral: true });
    return;
  }

  if (interaction.commandName === "regear") {
    const battleUrl = interaction.options.getString("battle_url", true);
    const { source, serverOverride } = extractUrlAndLocation(battleUrl);
    const battleId = extractBattleId(source);
    if (!battleId) {
      await interaction.reply({
        content: "無法解析戰報ID,請提供正確戰報網址.",
        ephemeral: true
      });
      return;
    }

    const server = interaction.options.getString("server") ?? serverOverride ?? config.defaultServer;
    await interaction.reply(`開始計算戰報:${battleId}... 請稍後`);
    try {
      const result = await calculateBattleRegear({
        battleId,
        server,
        targetGuilds: config.targetGuilds,
        targetAlliances: config.targetAlliances
      });
      const embeds = buildRegearEmbeds(result);
      await sendEmbedsFromInteraction(interaction, embeds);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "未知錯誤";
      await interaction.editReply(`計算戰報 ${battleId} 失敗: ${reason}`);
    }
    return;
  }

  if (interaction.commandName === "oc") {
    const action = interaction.options.getString("action", true);
    const player = interaction.options.getString("player");
    const amount = interaction.options.getInteger("amount");
    const normalizedPlayer = String(player ?? "").trim().toLowerCase();
    const allRows = await listOcBalances();
    const matchedPlayer = allRows.find((row) => String(row.name).trim().toLowerCase() === normalizedPlayer);

    if (action === "add") {
      if (!player || amount === null || amount <= 0) {
        await interaction.reply({ content: "add 需要 player 與正整數 amount.", ephemeral: true });
        return;
      }
      if (!matchedPlayer) {
        await interaction.reply({ content: `找不到玩家: ${player}(僅可操作已存在OC資料的人)`, ephemeral: true });
        return;
      }
      const row = await addOcBalance(matchedPlayer.name, amount);
      await interaction.reply(
        `已增加 ${row.name} 的 OC: +${formatSilver(amount)},目前 **${formatSilver(row.balance)}**`
      );
      return;
    }

    if (action === "remove") {
      if (!player || amount === null || amount <= 0) {
        await interaction.reply({ content: "remove 需要 player 與正整數 amount.", ephemeral: true });
        return;
      }
      if (!matchedPlayer) {
        await interaction.reply({ content: `找不到玩家: ${player}(僅可操作已存在OC資料的人)`, ephemeral: true });
        return;
      }
      const row = await addOcBalance(matchedPlayer.name, -amount);
      await interaction.reply(
        `已減少 ${row.name} 的 OC: -${formatSilver(amount)}，目前 **${formatSilver(row.balance)}**`
      );
      return;
    }

    if (action === "set") {
      if (!player || amount === null) {
        await interaction.reply({ content: "set 需要 player 與 amount.", ephemeral: true });
        return;
      }
      const row = await setOcBalance(player, amount);
      await interaction.reply(`已設定 ${row.name} 的OC為 **${formatSilver(row.balance)}**`);
      return;
    }

    if (action === "wipe") {
      if (!player) {
        await interaction.reply({ content: "wipe 需要 player.", ephemeral: true });
        return;
      }
      if (!matchedPlayer) {
        await interaction.reply({ content: `找不到玩家: ${player}(僅可移除已存在OC資料的人)`, ephemeral: true });
        return;
      }
      await wipeOcBalance(matchedPlayer.name);
      await interaction.reply(`已清除 ${matchedPlayer.name} 的 OC 資料.`);
      return;
    }

    if (action === "list") {
      await interaction.deferReply();
      const rows = await listOcBalances();
      const embeds = [...buildOcListEmbeds(rows, "OC 總表"), buildDebtEmbed(rows)];
      await sendEmbedsFromInteraction(interaction, embeds);
      return;
    }

    await interaction.reply({ content: "未知 action,請使用 add/remove/set/wipe/list.", ephemeral: true });
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !client.user) {
    return;
  }
  if (!message.mentions.has(client.user)) {
    return;
  }
  if (!/\boclog\b/i.test(message.content)) {
    return;
  }

  if (!(await isPrivilegedMessage(message))) {
    const perms = message.memberPermissions?.toArray?.().join(",") ?? "none";
    console.log(`[Auth] oclog denied | guild=${message.guildId} user=${message.author.id} perms=${perms}`);
    await message.reply("你沒有使用此功能的權限.");
    return;
  }
  if (!message.reference?.messageId) {
    await message.reply("請用回覆紀錄訊息的方式輸入 `@bot oclog`.");
    return;
  }

  const progress = await message.reply("開始計算OC紀錄... 請稍後");
  try {
    const sourceMessage = await message.channel.messages.fetch(message.reference.messageId);
    const sourceText = await extractOcLogTextFromMessage(sourceMessage);
    const balances = parseOcLogFromText(sourceText);
    if (Object.keys(balances).length === 0) {
      throw new Error("找不到可解析紀錄，請確認回覆訊息內容或 .txt/.csv 附件為四欄格式（支援雙引號 CSV、Tab、多空白分隔）。");
    }

    await applyOcDeltas(balances);
    const rows = await listOcBalances();
    const embeds = [...buildOcListEmbeds(rows, "OC 總表"), buildDebtEmbed(rows)];
    await sendEmbedsFromMessage(progress, embeds);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知錯誤";
    await progress.edit(`OC 紀錄計算失敗: ${reason}`);
  }
});

client.login(config.discordToken);
