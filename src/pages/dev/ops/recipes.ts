import type { OpsProfile, ShellProfile } from '../../../api/ops'

/**
 * The command wizard's catalogue. Every recipe turns the operations profile plus the values the
 * owner types into copy-and-paste shell: a `remote` script (runs on the VPS over ssh/mosh) and/or
 * a `local` script (runs on the owner's own machine: gh, ssh-keygen, scp…). Secrets are read
 * interactively with `read -s` unless the owner chooses to embed them.
 */

export type Risk = 'safe' | 'careful' | 'danger'

export interface RecipeInput {
  key: string
  label: string
  type: 'text' | 'password' | 'textarea' | 'select' | 'number'
  placeholder?: string
  required?: boolean
  options?: string[]
  hint?: string
  default?: string
}

export interface Generated {
  remote?: string
  local?: string
  notes?: string[]
}

export interface Recipe {
  id: string
  group: string
  title: string
  description: string
  risk: Risk
  inputs: RecipeInput[]
  generate: (ctx: OpsProfile, v: Record<string, string>, embed: boolean) => Generated
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** A secret: either prompted at run time or embedded verbatim (owner's choice). */
function secret(name: string, label: string, value: string, embed: boolean): string {
  return embed && value ? `${name}=${q(value)}` : `read -r -s -p ${q(`${label}: `)} ${name}; echo`
}

export function sshBase(ctx: Pick<OpsProfile, 'host' | 'user' | 'port' | 'keyPath'>): string {
  return `ssh -p ${ctx.port}${ctx.keyPath ? ` -i ${ctx.keyPath}` : ''} ${ctx.user}@${ctx.host}`
}

export function moshCommand(p: ShellProfile, opts: { tmux?: boolean; verbose?: boolean } = {}): string {
  const sshOpts = [`ssh -p ${p.port}`, p.keyPath ? `-i ${p.keyPath}` : '', p.sshOptions].filter(Boolean).join(' ')
  const parts = ['mosh', `--ssh=${q(sshOpts)}`, `--predict=${p.predict}`, `-p ${p.udpFrom}:${p.udpTo}`]
  if (p.moshServer && p.moshServer !== '/usr/bin/mosh-server') parts.push(`--server=${q(p.moshServer)}`)
  if (opts.verbose) parts.push('--experimental-remote-ip=proxy')
  parts.push(`${p.user}@${p.host}`)
  if (opts.tmux && p.tmux) parts.push('--', 'tmux', 'new', '-A', '-s', p.tmux)
  return parts.join(' ')
}

/** Wrap a remote script so it runs over one ssh connection: `ssh host 'bash -s' <<'EOF' … EOF`. */
export function overSsh(ctx: OpsProfile, script: string): string {
  return `${sshBase(ctx)} 'bash -s' <<'XGALLERY_EOF'\nset -euo pipefail\n${script.trim()}\nXGALLERY_EOF`
}

export const GROUPS = ['Access & secrets', 'Deploy & app', 'Data & backups', 'Server & system', 'Remote shell (mosh)', 'Checks'] as const

export const RECIPES: Recipe[] = [
  /* ---------- access & secrets ---------- */
  {
    id: 'rotate-root-password',
    group: 'Access & secrets',
    title: 'Rotate the VPS root password and update the GitHub secret',
    description: 'Changes the root password on the VPS, then stores the same value as the VPS_PASSWORD repository secret so deploys keep working.',
    risk: 'careful',
    inputs: [{ key: 'password', label: 'New root password', type: 'password', required: true, hint: 'Typed here only; generated scripts prompt for it unless you embed it.' }],
    generate: (ctx, v, embed) => ({
      remote: `${secret('NEWPW', 'New root password', v.password, embed)}\necho "root:$NEWPW" | chpasswd\necho "root password changed on $(hostname)"`,
      local: `# needs the GitHub CLI signed in: gh auth status\n${secret('NEWPW', 'New root password', v.password, embed)}\nprintf '%s' "$NEWPW" | gh secret set VPS_PASSWORD --repo ${ctx.repo}\ngh secret list --repo ${ctx.repo}`,
      notes: ['Run the remote part first, then the local part. If the deploy workflow uses VPS_SSH_KEY instead of a password, only the remote part matters.', 'Keep the password out of shell history: the scripts prompt with read -s. If you embed it, prefix the command with a space (HISTCONTROL=ignorespace) or clear history after.'],
    }),
  },
  {
    id: 'deploy-key',
    group: 'Access & secrets',
    title: 'Switch deploys to an SSH key (and drop the password secret)',
    description: 'Creates an ed25519 key pair on your machine, installs the public key on the VPS, stores the private key as VPS_SSH_KEY, and optionally removes VPS_PASSWORD.',
    risk: 'careful',
    inputs: [
      { key: 'keyfile', label: 'Key file on your machine', type: 'text', default: '~/.ssh/xgallery_deploy' },
      { key: 'dropPassword', label: 'Remove VPS_PASSWORD afterwards', type: 'select', options: ['no', 'yes'], default: 'no' },
    ],
    generate: (ctx, v) => {
      const kf = v.keyfile || '~/.ssh/xgallery_deploy'
      return {
        local: `[ -f ${kf} ] || ssh-keygen -t ed25519 -N "" -C "xgallery-deploy" -f ${kf}\nssh-copy-id -i ${kf}.pub -p ${ctx.port} ${ctx.user}@${ctx.host}\nssh -i ${kf} -p ${ctx.port} ${ctx.user}@${ctx.host} 'echo key login works on $(hostname)'\ngh secret set VPS_SSH_KEY --repo ${ctx.repo} < ${kf}\n${v.dropPassword === 'yes' ? `gh secret delete VPS_PASSWORD --repo ${ctx.repo}` : '# gh secret delete VPS_PASSWORD --repo ' + ctx.repo + '   # once key deploys work'}\ngh secret list --repo ${ctx.repo}`,
        notes: ['Test a deploy (gh workflow run deploy.yml) before deleting VPS_PASSWORD.', 'The private key never leaves your machine except into the GitHub secret store.'],
      }
    },
  },
  {
    id: 'github-secret',
    group: 'Access & secrets',
    title: 'Set or update any GitHub Actions secret',
    description: 'Stores a repository secret with the GitHub CLI (prompted, so it stays out of history).',
    risk: 'safe',
    inputs: [
      { key: 'name', label: 'Secret name', type: 'text', placeholder: 'VPS_USER', required: true },
      { key: 'value', label: 'Value', type: 'password', hint: 'Optional here; the script prompts if empty.' },
    ],
    generate: (ctx, v, embed) => ({
      local: `${secret('VAL', `Value for ${v.name || 'SECRET'}`, v.value, embed)}\nprintf '%s' "$VAL" | gh secret set ${(v.name || 'SECRET').toUpperCase().replace(/[^A-Z0-9_]/g, '_')} --repo ${ctx.repo}\ngh secret list --repo ${ctx.repo}`,
    }),
  },
  {
    id: 'harden-ssh',
    group: 'Access & secrets',
    title: 'Harden sshd: keys only, no root password logins',
    description: 'After key login works: disables password authentication and limits root to key-based login.',
    risk: 'danger',
    inputs: [],
    generate: () => ({
      remote: `cp -n /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$(date +%F)\nsed -i 's/^#\\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\\?PermitRootLogin .*/PermitRootLogin prohibit-password/; s/^#\\?PubkeyAuthentication .*/PubkeyAuthentication yes/' /etc/ssh/sshd_config\nsshd -t && (systemctl reload ssh 2>/dev/null || systemctl reload sshd)\necho "sshd hardened; keep this session open and test a new key login before closing it"`,
      notes: ['Only run this once an SSH key login has been verified, or you lock yourself out (hPanel console can rescue you).', 'GitHub deploys must then use VPS_SSH_KEY, not VPS_PASSWORD.'],
    }),
  },
  {
    id: 'admin-user',
    group: 'Access & secrets',
    title: 'Create a sudo user with your key (stop using root day to day)',
    description: 'Adds a user, gives it passwordless sudo and docker access, and copies root’s authorized keys.',
    risk: 'careful',
    inputs: [{ key: 'username', label: 'Username', type: 'text', placeholder: 'brett', required: true }],
    generate: (_ctx, v) => {
      const u = (v.username || 'admin').replace(/[^a-z0-9_-]/gi, '')
      return {
        remote: `id ${u} >/dev/null 2>&1 || adduser --disabled-password --gecos "" ${u}\nusermod -aG sudo,docker ${u} 2>/dev/null || usermod -aG sudo ${u}\necho "${u} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${u} && chmod 440 /etc/sudoers.d/${u}\nmkdir -p /home/${u}/.ssh && cp /root/.ssh/authorized_keys /home/${u}/.ssh/ 2>/dev/null || true\nchown -R ${u}:${u} /home/${u}/.ssh && chmod 700 /home/${u}/.ssh && chmod 600 /home/${u}/.ssh/authorized_keys 2>/dev/null || true\necho "user ${u} ready: ssh ${u}@$(hostname -I | awk '{print $1}')"`,
      }
    },
  },
  {
    id: 'fail2ban',
    group: 'Access & secrets',
    title: 'Install fail2ban (bans brute-force SSH attempts)',
    description: 'Installs and enables fail2ban with a sensible sshd jail.',
    risk: 'safe',
    inputs: [],
    generate: () => ({
      remote: `apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fail2ban\ncat > /etc/fail2ban/jail.d/sshd.local <<'EOF'\n[sshd]\nenabled = true\nmaxretry = 5\nfindtime = 10m\nbantime = 1h\nEOF\nsystemctl enable --now fail2ban && systemctl restart fail2ban\nfail2ban-client status sshd`,
    }),
  },
  {
    id: 'firewall',
    group: 'Access & secrets',
    title: 'Firewall baseline (ufw): SSH, web, mosh UDP',
    description: 'Allows SSH, HTTP/HTTPS and the mosh UDP range; denies everything else inbound.',
    risk: 'careful',
    inputs: [
      { key: 'sshPort', label: 'SSH port', type: 'number', default: '22' },
      { key: 'udp', label: 'Mosh UDP range', type: 'text', default: '60000:61000' },
    ],
    generate: (_ctx, v) => ({
      remote: `apt-get install -y -qq ufw >/dev/null\nufw default deny incoming\nufw default allow outgoing\nufw allow ${v.sshPort || 22}/tcp comment ssh\nufw allow 80/tcp comment http\nufw allow 443/tcp comment https\nufw allow 443/udp comment http3\nufw allow ${v.udp || '60000:61000'}/udp comment mosh\nufw --force enable\nufw status numbered`,
      notes: ['Hostinger also has its own firewall in hPanel → VPS → Firewall; both must allow the ports.', 'Docker publishes ports past ufw; Traefik/Coolify own 80 and 443 anyway.'],
    }),
  },

  /* ---------- deploy & app ---------- */
  {
    id: 'redeploy',
    group: 'Deploy & app',
    title: 'Rebuild and restart the app from the source already on the VPS',
    description: 'Runs the same compose command the deploy workflow uses, in the deploy directory.',
    risk: 'careful',
    inputs: [],
    generate: (ctx) => ({
      remote: `cd ${ctx.deployDir}\nexport SITE_DOMAIN=${ctx.domain}\nexport SOURCE_VERSION=$(git rev-parse --short HEAD 2>/dev/null || date +%F)\ndocker compose -p ${ctx.project} -f ${ctx.composeFile} up -d --build --remove-orphans\ndocker image prune -f >/dev/null\ndocker compose -p ${ctx.project} ps\ncurl -s -o /dev/null -w "healthz -> %{http_code}\\n" http://127.0.0.1:3000/healthz || docker exec ${ctx.container} wget -qO- http://127.0.0.1:3000/healthz`,
    }),
  },
  {
    id: 'trigger-deploy',
    group: 'Deploy & app',
    title: 'Trigger the GitHub deploy workflow and watch it',
    description: 'Starts the deploy from your machine and streams its progress.',
    risk: 'safe',
    inputs: [],
    generate: (ctx) => ({ local: `gh workflow run deploy.yml --repo ${ctx.repo} --ref main\nsleep 5\ngh run list --repo ${ctx.repo} --workflow deploy.yml --limit 1\ngh run watch --repo ${ctx.repo} --exit-status $(gh run list --repo ${ctx.repo} --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')` }),
  },
  {
    id: 'restart-app',
    group: 'Deploy & app',
    title: 'Restart the app container',
    description: 'A plain restart; data in the volume is untouched.',
    risk: 'safe',
    inputs: [],
    generate: (ctx) => ({ remote: `docker restart ${ctx.container}\nsleep 3\ndocker ps --filter name=${ctx.container} --format '{{.Names}} {{.Status}}'\ndocker logs --tail 20 ${ctx.container}` }),
  },
  {
    id: 'logs',
    group: 'Deploy & app',
    title: 'Follow the app logs',
    description: 'Tails the container log (Ctrl-C to stop).',
    risk: 'safe',
    inputs: [{ key: 'lines', label: 'Lines of history', type: 'number', default: '200' }],
    generate: (ctx, v) => ({ remote: `docker logs --tail ${v.lines || 200} -f ${ctx.container}` }),
  },
  {
    id: 'app-env',
    group: 'Deploy & app',
    title: 'Set app environment (admin password, Claude token, API key)',
    description: 'Writes a .env next to the compose file and restarts the stack so the container picks the values up. The assistant settings page is the simpler path for the Claude credentials.',
    risk: 'careful',
    inputs: [
      { key: 'adminPassword', label: 'ADMIN_PASSWORD (initial owner password; only used on first start)', type: 'password' },
      { key: 'claudeToken', label: 'CLAUDE_CODE_OAUTH_TOKEN (from claude setup-token)', type: 'password' },
      { key: 'apiKey', label: 'ANTHROPIC_API_KEY', type: 'password' },
    ],
    generate: (ctx, v, embed) => {
      const lines: string[] = [`cd ${ctx.deployDir}`, 'touch .env && chmod 600 .env']
      const setvar = (name: string, label: string, val: string) => {
        if (!val && !embed) return
        lines.push(secret(name, label, val, embed), `grep -q "^${name}=" .env && sed -i "s|^${name}=.*|${name}=$${name}|" .env || echo "${name}=$${name}" >> .env`)
      }
      setvar('ADMIN_PASSWORD', 'ADMIN_PASSWORD', v.adminPassword)
      setvar('CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', v.claudeToken)
      setvar('ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY', v.apiKey)
      lines.push(`export SITE_DOMAIN=${ctx.domain}`, `docker compose -p ${ctx.project} -f ${ctx.composeFile} up -d`, `docker compose -p ${ctx.project} ps`)
      return { remote: lines.join('\n'), notes: ['Values in .env override nothing saved in Admin → Assistant; saved settings take precedence over environment variables.', 'The compose file must pass these variables through to the container (ADMIN_PASSWORD already is; add the Claude ones under environment: if you use this path).'] }
    },
  },
  {
    id: 'claude-token',
    group: 'Deploy & app',
    title: 'Create a Claude subscription token for the assistant',
    description: 'Run on your own machine; paste the printed token into Owner console → Assistant.',
    risk: 'safe',
    inputs: [],
    generate: () => ({ local: `# Requires Claude Code: npm i -g @anthropic-ai/claude-code\nclaude setup-token\n# → copy the token it prints into Admin → Assistant → Claude subscription token, then Verify` }),
  },
  {
    id: 'pull-image',
    group: 'Deploy & app',
    title: 'Pull the latest published image instead of building on the VPS',
    description: 'Uses the GHCR image the workflow publishes; useful when the VPS is short on memory.',
    risk: 'careful',
    inputs: [],
    generate: (ctx) => ({ remote: `docker pull ${ctx.image}:latest\ncd ${ctx.deployDir}\nexport SITE_DOMAIN=${ctx.domain}\ndocker compose -p ${ctx.project} -f ${ctx.composeFile} up -d --no-build --remove-orphans || echo "compose file builds locally; edit it to use image: ${ctx.image}:latest"`, notes: ['The package must be public on GHCR, or run docker login ghcr.io on the VPS first.'] }),
  },

  /* ---------- data & backups ---------- */
  {
    id: 'backup',
    group: 'Data & backups',
    title: 'Back up the data volume and download it',
    description: 'Archives the SQLite database, uploads and activity logs into a dated tar.gz, then copies it to your machine.',
    risk: 'safe',
    inputs: [],
    generate: (ctx) => ({
      remote: `mkdir -p ${ctx.backupDir}\nF=${ctx.backupDir}/xgallery-$(date +%F-%H%M).tgz\ndocker run --rm -v ${ctx.volume}:/data:ro -v ${ctx.backupDir}:/backup alpine tar czf /backup/$(basename $F) -C /data .\nls -lh $F`,
      local: `mkdir -p ./xgallery-backups\nscp -P ${ctx.port}${ctx.keyPath ? ` -i ${ctx.keyPath}` : ''} ${ctx.user}@${ctx.host}:${ctx.backupDir}/'xgallery-*.tgz' ./xgallery-backups/\nls -lh ./xgallery-backups`,
    }),
  },
  {
    id: 'backup-cron',
    group: 'Data & backups',
    title: 'Nightly backups with 14-day retention',
    description: 'Installs a cron job that archives the volume every night at 03:15 and prunes old archives.',
    risk: 'safe',
    inputs: [{ key: 'keepDays', label: 'Keep days', type: 'number', default: '14' }],
    generate: (ctx, v) => ({
      remote: `mkdir -p ${ctx.backupDir}\ncat > /usr/local/bin/xgallery-backup <<'EOF'\n#!/bin/sh\nset -e\nmkdir -p ${ctx.backupDir}\ndocker run --rm -v ${ctx.volume}:/data:ro -v ${ctx.backupDir}:/backup alpine tar czf /backup/xgallery-$(date +%F-%H%M).tgz -C /data .\nfind ${ctx.backupDir} -name 'xgallery-*.tgz' -mtime +${v.keepDays || 14} -delete\nEOF\nchmod +x /usr/local/bin/xgallery-backup\n( crontab -l 2>/dev/null | grep -v xgallery-backup; echo "15 3 * * * /usr/local/bin/xgallery-backup >> /var/log/xgallery-backup.log 2>&1" ) | crontab -\ncrontab -l | grep xgallery`,
    }),
  },
  {
    id: 'restore',
    group: 'Data & backups',
    title: 'Restore the data volume from an archive',
    description: 'Stops the app, replaces the volume contents with the archive, starts the app again.',
    risk: 'danger',
    inputs: [{ key: 'archive', label: 'Archive path on the VPS', type: 'text', placeholder: '/root/backups/xgallery-2026-10-15-0315.tgz', required: true }],
    generate: (ctx, v) => ({
      remote: `test -f ${q(v.archive || '/root/backups/ARCHIVE.tgz')}\ndocker stop ${ctx.container}\ndocker run --rm -v ${ctx.volume}:/data -v $(dirname ${q(v.archive || '/root/backups/x')}):/backup:ro alpine sh -c 'rm -rf /data/* && tar xzf /backup/$(basename ${q(v.archive || 'ARCHIVE.tgz')}) -C /data'\ndocker start ${ctx.container}\nsleep 3 && docker logs --tail 10 ${ctx.container}`,
      notes: ['Everything currently in the volume is replaced. Take a fresh backup first.'],
    }),
  },
  {
    id: 'disk',
    group: 'Data & backups',
    title: 'Disk usage: system, docker, data volume',
    description: 'Shows what is using space.',
    risk: 'safe',
    inputs: [],
    generate: (ctx) => ({ remote: `df -h / /var/lib/docker 2>/dev/null\ndocker system df\ndu -sh /var/lib/docker/volumes/${ctx.volume}/_data 2>/dev/null || docker run --rm -v ${ctx.volume}:/data alpine du -sh /data\nls -lh ${ctx.backupDir} 2>/dev/null | tail -5` }),
  },
  {
    id: 'docker-prune',
    group: 'Data & backups',
    title: 'Reclaim space: prune unused images and build cache',
    description: 'Removes dangling images, stopped containers and build cache. Volumes are kept.',
    risk: 'careful',
    inputs: [],
    generate: () => ({ remote: `docker image prune -af\ndocker builder prune -af\ndocker container prune -f\ndocker system df` }),
  },
  {
    id: 'db-check',
    group: 'Data & backups',
    title: 'Check the SQLite database integrity',
    description: 'Runs PRAGMA integrity_check inside the container with Node’s built-in SQLite.',
    risk: 'safe',
    inputs: [],
    generate: (ctx) => ({ remote: `docker exec ${ctx.container} node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/data/xgallery.db',{readOnly:true});console.log(db.prepare('PRAGMA integrity_check').all());console.log('users',db.prepare('SELECT COUNT(*) c FROM users').get(),'albums',db.prepare('SELECT COUNT(*) c FROM albums').get(),'media',db.prepare('SELECT COUNT(*) c FROM media').get())"\ndocker exec ${ctx.container} ls -la /data /data/activity 2>/dev/null | head -40` }),
  },

  /* ---------- server & system ---------- */
  {
    id: 'system-update',
    group: 'Server & system',
    title: 'Update system packages',
    description: 'apt update/upgrade; tells you if a reboot is needed.',
    risk: 'careful',
    inputs: [],
    generate: () => ({ remote: `apt-get update -qq\nDEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq\napt-get autoremove -y -qq\n[ -f /var/run/reboot-required ] && echo "REBOOT REQUIRED: run the Reboot recipe when convenient" || echo "no reboot needed"` }),
  },
  {
    id: 'unattended',
    group: 'Server & system',
    title: 'Automatic security updates',
    description: 'Enables unattended-upgrades for security patches.',
    risk: 'safe',
    inputs: [],
    generate: () => ({ remote: `DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unattended-upgrades\ndpkg-reconfigure -f noninteractive unattended-upgrades\nsystemctl enable --now unattended-upgrades\ngrep -h Unattended-Upgrade /etc/apt/apt.conf.d/20auto-upgrades` }),
  },
  {
    id: 'swap',
    group: 'Server & system',
    title: 'Add swap (helps builds on small VPS plans)',
    description: 'Creates a swap file if none exists.',
    risk: 'safe',
    inputs: [{ key: 'size', label: 'Size (e.g. 2G)', type: 'text', default: '2G' }],
    generate: (_ctx, v) => ({ remote: `if ! swapon --show | grep -q .; then\n  fallocate -l ${v.size || '2G'} /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile\n  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab\nfi\nfree -h` }),
  },
  {
    id: 'timezone',
    group: 'Server & system',
    title: 'Time zone and NTP',
    description: 'Sets the server time zone and makes sure the clock syncs.',
    risk: 'safe',
    inputs: [{ key: 'tz', label: 'Time zone', type: 'text', default: 'UTC', placeholder: 'America/Chicago' }],
    generate: (_ctx, v) => ({ remote: `timedatectl set-timezone ${q(v.tz || 'UTC')}\ntimedatectl set-ntp true\ntimedatectl` }),
  },
  {
    id: 'coolify',
    group: 'Server & system',
    title: 'Coolify / Traefik proxy status',
    description: 'Shows the proxy container, its routes for the gallery, and certificate state.',
    risk: 'safe',
    inputs: [],
    generate: (ctx) => ({ remote: `docker ps --filter name=coolify --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'\ndocker network inspect coolify -f '{{range .Containers}}{{.Name}} {{end}}'\ndocker inspect ${ctx.container} -f '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{"\\n"}}{{end}}' | grep traefik\ncurl -sI https://${ctx.domain}/healthz | head -5` }),
  },
  {
    id: 'reboot',
    group: 'Server & system',
    title: 'Reboot the VPS',
    description: 'Containers restart automatically (restart: unless-stopped).',
    risk: 'danger',
    inputs: [],
    generate: () => ({ remote: `shutdown -r +1 "rebooting in 1 minute (xGallery ops wizard)"`, notes: ['Cancel with: shutdown -c'] }),
  },

  /* ---------- remote shell (mosh) ---------- */
  {
    id: 'mosh-server',
    group: 'Remote shell (mosh)',
    title: 'Install mosh on the VPS and open its UDP range',
    description: 'Installs mosh-server, sets the locale it needs, opens UDP 60000-61000 in ufw (and reminds you about hPanel).',
    risk: 'safe',
    inputs: [{ key: 'udp', label: 'UDP range', type: 'text', default: '60000:61000' }],
    generate: (_ctx, v) => ({ remote: `DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mosh locales tmux\nlocale-gen en_US.UTF-8 >/dev/null 2>&1 || true\nupdate-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 2>/dev/null || true\ncommand -v ufw >/dev/null && ufw allow ${v.udp || '60000:61000'}/udp comment mosh && ufw status | grep -i mosh || echo "ufw not installed; open UDP ${v.udp || '60000:61000'} in hPanel → VPS → Firewall"\nwhich mosh-server && mosh-server --version 2>&1 | head -1`, notes: ['Hostinger’s firewall (hPanel) must also allow the UDP range or mosh will hang after “Nothing received from server”.'] }),
  },
  {
    id: 'mosh-client',
    group: 'Remote shell (mosh)',
    title: 'Install the mosh client on your machine',
    description: 'macOS, Debian/Ubuntu, Fedora, Windows (WSL) and Android (Termux).',
    risk: 'safe',
    inputs: [],
    generate: () => ({ local: `# macOS\nbrew install mosh\n# Debian / Ubuntu / WSL\nsudo apt-get install -y mosh\n# Fedora\nsudo dnf install -y mosh\n# Android: install Termux from F-Droid, then in Termux:\npkg update && pkg install -y mosh openssh\n# Windows without WSL: use the Termius or Blink apps (both speak mosh)` }),
  },
  {
    id: 'tmux-config',
    group: 'Remote shell (mosh)',
    title: 'tmux config for a pleasant mosh session',
    description: 'Mouse support, large scrollback, sane prefix; attach with the “connect with tmux” command.',
    risk: 'safe',
    inputs: [],
    generate: () => ({ remote: `cat > ~/.tmux.conf <<'EOF'\nset -g mouse on\nset -g history-limit 50000\nset -g default-terminal "tmux-256color"\nset -g base-index 1\nset -g renumber-windows on\nset -g status-style bg=colour236,fg=colour250\nset -g status-right "#H  %H:%M"\nbind r source-file ~/.tmux.conf \\; display "reloaded"\nEOF\ntmux -V` }),
  },

  /* ---------- checks ---------- */
  {
    id: 'health',
    group: 'Checks',
    title: 'Health check: DNS, TLS, app, container',
    description: 'From your machine and from the VPS.',
    risk: 'safe',
    inputs: [],
    generate: (ctx) => ({
      local: `dig +short ${ctx.domain}\ncurl -sS -o /dev/null -w 'https %{http_code} in %{time_total}s\\n' https://${ctx.domain}/healthz\necho | openssl s_client -servername ${ctx.domain} -connect ${ctx.domain}:443 2>/dev/null | openssl x509 -noout -dates -issuer`,
      remote: `docker ps --filter name=${ctx.container} --format '{{.Names}} {{.Status}}'\ndocker inspect ${ctx.container} -f 'health={{.State.Health.Status}} restarts={{.RestartCount}}'\nuptime\nfree -h | head -2\ndf -h / | tail -1`,
    }),
  },
  {
    id: 'ports',
    group: 'Checks',
    title: 'What is listening, and is UDP reachable for mosh?',
    description: 'Lists listening sockets on the VPS and probes the mosh UDP range from your machine.',
    risk: 'safe',
    inputs: [],
    generate: (ctx) => ({ remote: `ss -tulpn | grep -E ':(22|80|443|3000|60[0-9]{3}) ' || ss -tulpn | head -20`, local: `# a reply on the UDP probe is not expected; a blocked port shows as "Connection refused"/timeouts on ICMP only\nnc -vzu ${ctx.host} 60001 || true\nssh -p ${ctx.port} ${ctx.user}@${ctx.host} 'mosh-server new -v' | head -3` }),
  },
]

export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id)
}
