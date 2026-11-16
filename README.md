# Mailroom

A self-hosted Discord bot that lets users build up a queue of content — text, images, and files — and drip-posts it to a channel on a schedule.

Each user has their own mailbox per channel. When the schedule fires, the bot picks the next item from the user's queue and posts it. Items are served in order or at random, and you can pin items to a specific calendar date so they post on that day instead of a regular queue pick.

## Commands

| Command | Who can use it | What it does |
| --- | --- | --- |
| `/establish-mailbox` | Everyone | Create or update a mailbox for a channel: pick the `channel`, the `time` (HH:mm UTC) for posts, and how often to post (`frequency`, e.g. `3d`, `2w`). |
| `/mail` | Everyone | Add an item to your mailbox: `channel`, then at least one of `content` (text) or `attachment` (image or file). Optional `date` (MM/dd) pins the item to a specific calendar date. |
| `/inspect` | Everyone | View your queue for a channel. Items are shown 10 per page; use the ◀/▶ buttons to navigate. Each item gets a 🗑 delete button (with a confirmation step). A **Randomize** toggle switches between in-order and random pick. The embed shows the current schedule (frequency, post time, next post) and an **✏️ Edit frequency** button to update it. |

All command replies are only visible to the person who ran them.

### Mailboxes

Every user has their own mailbox per channel. You can only see and manage your own. Running `/establish-mailbox` again on the same channel updates its time and frequency without touching items already in the queue.

If the queue is empty when a post is due, nothing is posted and the mailbox waits until its next scheduled time.

Every post includes a small attribution line — *sent by @username* — in italics below the content.

### Date-pinned items

When you add an item with a `date`, it's held back until that calendar date (UTC). On that date, the bot fires all pinned items at the first scheduled tick after midnight UTC — independent of how often the mailbox normally posts. The regular queue is skipped for that day. Pinned items are removed after they post.

Dates like `02/30` or `04/31` are rejected at entry because they can never match a real calendar date.

### Channel permissions

By default (`ENFORCE_CHANNEL_PERMISSIONS=false`), any user can create a mailbox for any text or announcement channel. This lets moderators drip-post to locked channels like `#announcements` through the bot.

When set to `true`, users can only create mailboxes in channels where they have **Send Messages** permission. See [Configuration](#configuration).

### Frequency format

| Example | Meaning |
| --- | --- |
| `4h` | Every 4 hours |
| `1d`, `3d` | Every day or every 3 days, at the same UTC time |
| `2w` | Every 2 weeks, at the same UTC time |
| `1y` | Every year, at the same UTC time |

The first post is at today's `time` if that time hasn't passed yet, or the next interval's occurrence if it has. All times are UTC. Hours (`h`) count elapsed time; days, weeks, and years pin to the same HH:mm UTC across repetitions.

## Setup

You need [Docker](https://docs.docker.com/get-docker/) with Docker Compose.

### 1. Create a Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. On **General Information**, copy the **Application ID**. This is `CLIENT_ID`.
3. On **Bot**, click **Reset Token** and copy the token. This is `DISCORD_TOKEN`. Keep it secret.

The bot doesn't need any privileged gateway intents.

### 2. Invite the bot to your server

Open this link, replacing `YOUR_CLIENT_ID` with your Application ID:

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=35840
```

This requests **View Channel**, **Send Messages**, and **Attach Files** — the three permissions the bot needs to post text and files. You need the Manage Server permission to add it.

### 3. Configure

Clone or download this repository, then create your settings file:

```bash
cp .env.example .env
```

Fill in `DISCORD_TOKEN` and `CLIENT_ID`. The other settings are optional.

### 4. Run

```bash
mkdir -p data
docker compose up -d --build
docker compose logs -f
```

You should see `Logged in as …` and `Deployed commands …`. Run `/establish-mailbox` in your server to create your first mailbox.

## Configuration

All settings go in `.env`.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | Yes | | Bot token. |
| `CLIENT_ID` | Yes | | Application ID. |
| `GUILD_ID` | No | | Register commands to one server only, so they appear instantly. Without it, commands work in every server the bot is in but can take up to an hour to show up. To get a server's ID, turn on **Developer Mode** (User Settings → Advanced), then right-click the server icon and choose **Copy Server ID**. |
| `ENFORCE_CHANNEL_PERMISSIONS` | No | `false` | Only let users create mailboxes in channels where they have Send Messages permission. See [Channel permissions](#channel-permissions). |
| `MAX_UPLOAD_MB` | No | `100` | Maximum file size in megabytes for attachments added with `/mail`. |
| `PUID` / `PGID` | No | `99` / `100` | User and group ID the container runs as. They must be able to write to the data folder. |
| `DATA_DIR` | No | `./data` | Folder on the host where the database and uploads are stored. |
| `DB_PATH` | No | `/data/bot.db` | Database file path inside the container. Only change this if running without Docker; Compose sets it for you. |
| `UPLOADS_DIR` | No | `/data/uploads` | Folder inside the container where uploaded attachments are stored. Only change this if running without Docker. |

## Unraid

1. Copy this folder to your server, e.g. `/mnt/user/appdata/mailroom`, and create `.env` as described above.
2. In `.env`, set `PUID=99` and `PGID=100` so the bot can write to the appdata share.
3. Install **Compose Manager Plus** from the **Apps** tab. It adds the `docker compose` command.
4. Open the Unraid terminal and run:

   ```bash
   cd /mnt/user/appdata/mailroom
   mkdir -p data && chown -R 99:100 data
   docker compose up -d --build
   ```

**Without a plugin:** Unraid's built-in Docker can run the same setup with these commands:

```bash
cd /mnt/user/appdata/mailroom
mkdir -p data && chown -R 99:100 data
docker build -t mailroom .
docker run -d --name mailroom --user 99:100 \
  --env-file .env \
  -e DB_PATH=/data/bot.db \
  -e UPLOADS_DIR=/data/uploads \
  -v /mnt/user/appdata/mailroom/data:/data \
  --restart unless-stopped mailroom
```

The Docker tab may show the container's update status as "not available". That's expected for a locally built image.

## Updating

Get the new code, then rebuild:

```bash
docker compose up -d --build
```

Existing mailboxes and queued items are kept, because they live in the data folder.

## Backups

Everything is in two places inside your data folder: `bot.db` (the SQLite database) and `uploads/` (attachments waiting to be posted).

Stop the container before copying either (`docker compose stop`), because copying an open SQLite file can produce a corrupt backup. On Unraid, the Appdata Backup plugin stops containers before copying by default.

Note that attachments are deleted from local storage after they're sent to Discord, so the `uploads/` folder only holds items that haven't posted yet.

## Running without Docker

Requires Node.js 22.5 or newer (uses the built-in `node:sqlite` module introduced in that version).

```bash
npm ci
npm run build
npm start
```

Set `DB_PATH` and `UPLOADS_DIR` in your `.env` to writable local paths, or accept the defaults (`./data/bot.db` and `./data/uploads`).

## Troubleshooting

**Commands don't appear.** Without `GUILD_ID`, commands can take up to an hour to show up. Set `GUILD_ID` and restart for instant registration. Also check that the invite link included the `applications.commands` scope.

**Every command appears twice.** The bot clears old registrations automatically when you add or remove `GUILD_ID`. Restart it and press Ctrl+R (Cmd+R on Mac) to reload Discord.

**The container keeps restarting.** The most common cause is the container user not being able to write to the data folder. Run `chown -R 99:100 data` (or whichever `PUID:PGID` you're using).

**A scheduled post didn't fire.** Run `docker compose logs` to see the error. Usually the bot has lost access to the channel or the channel was deleted. If a post fails, the item stays in the queue and the mailbox tries again at its next scheduled time.

**A mailbox seems stuck.** If a text item is longer than Discord's 2,000-character message limit, every attempt to post it will fail. Use `/inspect` to delete the item, then re-add a shorter version.

## Limits

- `/inspect` shows 10 items per page. Use the ◀/▶ navigation buttons to browse queues longer than 10 items.
- Text content is subject to Discord's 2,000-character message limit. Items that exceed it will fail to post on every attempt until they're deleted from the queue.
- Attachments are capped at `MAX_UPLOAD_MB` (default 100 MB) on the way in. Discord itself caps file uploads at 25 MB on most servers, so files between those limits will be accepted by `/mail` but fail when the post fires.
- Frequency units are `h` (hours), `d` (days), `w` (weeks), and `y` (years) only. Months are not supported.

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE). You can use, modify, and share it. If you distribute a modified version, you must release its source code under the same license.
