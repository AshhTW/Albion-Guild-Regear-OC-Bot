import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

const ADMIN_PERMISSION = PermissionFlagsBits.ManageGuild;

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("regear")
    .setDescription("計算 Albion 戰報的 Regear 費用")
    .setDefaultMemberPermissions(ADMIN_PERMISSION)
    .addStringOption((option) =>
      option.setName("battle_url").setDescription("AlbionBB 戰報網址或戰報 ID").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("server")
        .setDescription("價格資料伺服器")
        .setRequired(false)
        .addChoices(
          { name: "east", value: "east" },
          { name: "west", value: "west" },
          { name: "europe", value: "europe" }
        )
    ),
  new SlashCommandBuilder()
    .setName("oc")
    .setDescription("管理與查看玩家 OC")
    .setDefaultMemberPermissions(ADMIN_PERMISSION)
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("要執行的操作")
        .setRequired(true)
        .addChoices(
          { name: "add", value: "add" },
          { name: "remove", value: "remove" },
          { name: "set", value: "set" },
          { name: "wipe", value: "wipe" },
          { name: "list", value: "list" }
        )
    )
    .addStringOption((option) =>
      option.setName("player").setDescription("玩家名稱, list 不需要填寫").setRequired(false)
    )
    .addIntegerOption((option) =>
      option.setName("amount").setDescription("OC 數量, list 和 wipe 不需要填寫").setRequired(false)
    )
];
