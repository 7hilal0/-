import os
import asyncio
import logging
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands
from aiohttp import web
from dotenv import load_dotenv


load_dotenv()

logger = logging.getLogger("discord_bot")
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s - %(name)s - %(message)s")


def create_bot() -> commands.Bot:
    intents = discord.Intents.default()
    intents.message_content = True

    bot = commands.Bot(command_prefix="!", intents=intents)

    @bot.event
    async def on_ready():
        try:
            guild_id_str = os.getenv("GUILD_ID")
            if guild_id_str:
                guild = discord.Object(id=int(guild_id_str))
                await bot.tree.sync(guild=guild)
                logger.info("Synced application commands to guild %s", guild_id_str)
            else:
                await bot.tree.sync()
                logger.info("Synced global application commands")
        except Exception:
            logger.exception("Failed to sync application commands")

        logger.info("Logged in as %s (ID: %s)", bot.user, bot.user.id if bot.user else "?")

    # /ping command
    @bot.tree.command(name="ping", description="Check bot latency")
    async def ping_command(interaction: discord.Interaction):
        await interaction.response.send_message(f"Pong! Latency: {round(bot.latency * 1000)} ms", ephemeral=True)

    # /echo command
    @bot.tree.command(name="echo", description="Echo back what you say")
    @app_commands.describe(text="The text to echo back")
    async def echo_command(interaction: discord.Interaction, text: str):
        await interaction.response.send_message(text)

    return bot


async def start_health_server_if_enabled() -> Optional[web.AppRunner]:
    enable_health = os.getenv("ENABLE_HEALTH_SERVER", "false").lower() in {"1", "true", "yes"}
    if not enable_health:
        return None

    port = int(os.getenv("PORT", "8080"))

    async def health_handler(_: web.Request) -> web.Response:
        return web.Response(text="ok")

    app = web.Application()
    app.router.add_get("/healthz", health_handler)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="0.0.0.0", port=port)
    await site.start()
    logger.info("Health server started on 0.0.0.0:%d", port)
    return runner


async def run() -> None:
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        raise SystemExit("DISCORD_TOKEN is not set. Create a .env file or export the variable.")

    bot = create_bot()

    health_runner = await start_health_server_if_enabled()

    try:
        await bot.start(token)
    finally:
        if health_runner is not None:
            await health_runner.cleanup()


if __name__ == "__main__":
    asyncio.run(run())