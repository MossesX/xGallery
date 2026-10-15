/**
 * The commander's command library. Every entry is a snippet with point-and-click options; `build`
 * turns the chosen options into the exact shell line. Entries carry a category and subcategory
 * (for the tree and grid views), tags (for instant filters) and a risk level.
 */

export type OptType = 'path' | 'dir' | 'text' | 'number' | 'select' | 'toggle'
export interface CmdOption {
  key: string
  label: string
  type: OptType
  default?: string | number | boolean
  options?: (string | { v: string; l: string })[]
  hint?: string
  placeholder?: string
}
export type Risk = 'safe' | 'careful' | 'danger'
export type Vals = Record<string, string | number | boolean | undefined>
export interface Command {
  id: string
  name: string
  cat: string
  sub: string
  summary: string
  tags: string[]
  risk: Risk
  root?: boolean
  opts: CmdOption[]
  build: (v: Vals) => string
  examples?: { label: string; v: Vals }[]
  /** File operations the FTP tab performs through the API instead of a shell. */
  ftp?: 'list' | 'upload' | 'download' | 'mkdir' | 'rename' | 'chmod' | 'delete' | 'edit' | 'newfile' | 'cd'
  custom?: boolean
}

export const q = (s: unknown) => `'${String(s ?? '').replace(/'/g, `'\\''`)}'`
/** Quote a path only when it needs it, so simple commands stay readable. */
export const p = (s: unknown) => {
  const v = String(s ?? '').trim()
  return v === '' ? '.' : /^[\w./~:@+=,-]+$/.test(v) ? v : q(v)
}
const on = (v: unknown) => v === true || v === 'true' || v === 'on'
const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) && String(v) !== '' ? Number(v) : d)
const s = (v: unknown, d = '') => (v == null || v === '' ? d : String(v))

/* option builders */
const P = (key = 'path', label = 'Path', d = '.', hint?: string): CmdOption => ({ key, label, type: 'path', default: d, hint })
const D = (key = 'dir', label = 'Directory', d = '.', hint?: string): CmdOption => ({ key, label, type: 'dir', default: d, hint })
const T = (key: string, label: string, d = '', placeholder?: string, hint?: string): CmdOption => ({ key, label, type: 'text', default: d, placeholder, hint })
const N = (key: string, label: string, d: number, hint?: string): CmdOption => ({ key, label, type: 'number', default: d, hint })
const S = (key: string, label: string, options: (string | { v: string; l: string })[], d?: string, hint?: string): CmdOption => ({ key, label, type: 'select', options, default: d ?? (typeof options[0] === 'string' ? options[0] : options[0].v), hint })
const B = (key: string, label: string, d = false, hint?: string): CmdOption => ({ key, label, type: 'toggle', default: d, hint })
const SUDO = B('sudo', 'Run with sudo', false, 'needed when not root')
const sudo = (v: Vals, cmd: string) => (on(v.sudo) ? `sudo ${cmd}` : cmd)

let seq = 0
const list: Command[] = []
function c(cat: string, sub: string, name: string, summary: string, tags: string[], risk: Risk, opts: CmdOption[], build: (v: Vals) => string, extra: Partial<Command> = {}): Command {
  const id = extra.id ?? `${cat}.${sub}.${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + (seq++ ? '' : '')
  const cmd: Command = { id, name, cat, sub, summary, tags, risk, opts, build, ...extra }
  list.push(cmd)
  return cmd
}

/* ======================= Files ======================= */
c('Files', 'Browse', 'List directory', 'Contents of a folder, with sizes, dates and hidden files on demand', ['ls', 'list'], 'safe', [D(), B('all', 'Show hidden files', true), B('long', 'Long format (permissions, size, date)', true), B('human', 'Human-readable sizes', true), S('sort', 'Sort by', [{ v: '', l: 'name' }, { v: 't', l: 'newest first' }, { v: 'S', l: 'largest first' }, { v: 'X', l: 'extension' }], ''), B('reverse', 'Reverse order')], (v) => `ls -${on(v.long) ? 'l' : ''}${on(v.all) ? 'a' : ''}${on(v.human) ? 'h' : ''}${s(v.sort)}${on(v.reverse) ? 'r' : ''} --color=never --group-directories-first ${p(v.dir)}`.replace('ls - ', 'ls '), { examples: [{ label: 'Newest first in /var/log', v: { dir: '/var/log', sort: 't' } }] })
c('Files', 'Browse', 'Tree view', 'Nested view of a folder a few levels deep', ['tree', 'list'], 'safe', [D(), N('depth', 'Depth', 2), B('dirs', 'Directories only'), B('size', 'Show sizes')], (v) => `tree -a${on(v.dirs) ? 'd' : ''}${on(v.size) ? 'h' : ''} -L ${n(v.depth, 2)} ${p(v.dir)} 2>/dev/null || find ${p(v.dir)} -maxdepth ${n(v.depth, 2)} ${on(v.dirs) ? '-type d ' : ''}| sort`)
c('Files', 'Browse', 'Folder size', 'How much space a folder takes, with the biggest children', ['du', 'size', 'disk'], 'safe', [D(), N('top', 'Show top N', 15), N('depth', 'Depth', 1)], (v) => `du -h --max-depth=${n(v.depth, 1)} ${p(v.dir)} 2>/dev/null | sort -rh | head -${n(v.top, 15)}`)
c('Files', 'Browse', 'File details', 'Type, size, permissions, owner, times', ['stat', 'file', 'info'], 'safe', [P()], (v) => `stat ${p(v.path)}; file ${p(v.path)}`)
c('Files', 'Browse', 'Count files', 'How many files and folders are under a path', ['count', 'find'], 'safe', [D()], (v) => `echo "files: $(find ${p(v.dir)} -type f | wc -l)  dirs: $(find ${p(v.dir)} -type d | wc -l)"`)
c('Files', 'Browse', 'Recently changed', 'Files modified in the last N minutes or days', ['find', 'mtime', 'recent'], 'safe', [D(), N('amount', 'Within the last', 60), S('unit', 'Unit', [{ v: 'mmin', l: 'minutes' }, { v: 'mtime', l: 'days' }]), N('top', 'Show at most', 50)], (v) => `find ${p(v.dir)} -type f -${s(v.unit, 'mmin')} -${n(v.amount, 60)} -printf '%TY-%Tm-%Td %TH:%TM  %p\\n' 2>/dev/null | sort -r | head -${n(v.top, 50)}`)
c('Files', 'Browse', 'Where am I', 'Current folder and who you are', ['pwd', 'whoami'], 'safe', [], () => 'pwd; whoami; hostname')
c('Files', 'Browse', 'Change directory', 'Go to a folder in the terminal', ['cd'], 'safe', [D('dir', 'Directory', '/opt/xgallery')], (v) => `cd ${p(v.dir)} && ls`, { ftp: 'cd' })

c('Files', 'Create', 'Make folder', 'Create a folder (and parents)', ['mkdir'], 'safe', [D('dir', 'New folder', '/opt/new-folder'), SUDO], (v) => sudo(v, `mkdir -p ${p(v.dir)}`), { ftp: 'mkdir' })
c('Files', 'Create', 'Create empty file', 'touch a new file or update its timestamp', ['touch', 'new'], 'safe', [P('path', 'File', '/opt/new-file.txt')], (v) => `touch ${p(v.path)}`, { ftp: 'newfile' })
c('Files', 'Create', 'Write text to file', 'Create a file with the given content (overwrites)', ['echo', 'write', 'heredoc'], 'careful', [P('path', 'File', '/opt/file.txt'), T('text', 'Content', '', 'hello world')], (v) => `cat > ${p(v.path)} <<'EOF'\n${s(v.text)}\nEOF`)
c('Files', 'Create', 'Append line to file', 'Add a line at the end of a file', ['echo', 'append'], 'careful', [P('path', 'File', '/etc/hosts'), T('text', 'Line', '', '127.0.0.1 example.local'), SUDO], (v) => (on(v.sudo) ? `echo ${q(v.text)} | sudo tee -a ${p(v.path)} >/dev/null` : `echo ${q(v.text)} >> ${p(v.path)}`))
c('Files', 'Create', 'Symbolic link', 'Point a name at another file or folder', ['ln', 'link'], 'careful', [P('target', 'Target (existing)', '/opt/xgallery'), P('link', 'Link name', '/srv/app'), SUDO], (v) => sudo(v, `ln -sfn ${p(v.target)} ${p(v.link)}`))

c('Files', 'Copy & move', 'Copy', 'Copy a file or folder (recursive, keeps attributes)', ['cp', 'copy'], 'careful', [P('src', 'Source', '/opt/xgallery/.env'), P('dst', 'Destination', '/root/backup/.env'), B('keep', 'Keep permissions and times', true), B('noclobber', 'Never overwrite'), SUDO], (v) => sudo(v, `cp -r${on(v.keep) ? 'p' : ''}${on(v.noclobber) ? 'n' : ''} ${p(v.src)} ${p(v.dst)}`))
c('Files', 'Copy & move', 'Move / rename', 'Move or rename a file or folder', ['mv', 'rename', 'move'], 'careful', [P('src', 'From', '/opt/old'), P('dst', 'To', '/opt/new'), B('noclobber', 'Never overwrite', true), SUDO], (v) => sudo(v, `mv ${on(v.noclobber) ? '-n ' : ''}${p(v.src)} ${p(v.dst)}`), { ftp: 'rename' })
c('Files', 'Copy & move', 'Mirror folder (rsync)', 'Sync one folder into another, only transferring changes', ['rsync', 'sync', 'mirror'], 'careful', [D('src', 'Source', '/opt/xgallery/'), D('dst', 'Destination', '/root/backup/xgallery/'), B('delete', 'Delete files missing in source'), B('dry', 'Dry run (show only)', true), T('exclude', 'Exclude pattern', 'node_modules', 'node_modules')], (v) => `rsync -avh --progress${on(v.delete) ? ' --delete' : ''}${on(v.dry) ? ' --dry-run' : ''}${s(v.exclude) ? ` --exclude=${q(v.exclude)}` : ''} ${p(v.src)} ${p(v.dst)}`)
c('Files', 'Copy & move', 'Copy with timestamp backup', 'Copy a file next to itself with a date suffix', ['cp', 'backup'], 'safe', [P('path', 'File', '/opt/xgallery/.env')], (v) => `cp -p ${p(v.path)} ${p(v.path)}.$(date +%Y%m%d-%H%M%S).bak && ls -la ${p(v.path)}*`)

c('Files', 'Delete', 'Delete file', 'Remove a single file', ['rm', 'delete'], 'danger', [P('path', 'File', '/tmp/file'), B('force', 'Force (no prompt)', true), SUDO], (v) => sudo(v, `rm ${on(v.force) ? '-f ' : '-i '}${p(v.path)}`), { ftp: 'delete' })
c('Files', 'Delete', 'Delete folder', 'Remove a folder and everything inside', ['rm', 'rmdir', 'delete', 'recursive'], 'danger', [D('dir', 'Folder', '/tmp/old-folder'), B('confirm', 'I checked the path', false, 'the command is only produced when ticked'), SUDO], (v) => (on(v.confirm) ? sudo(v, `rm -rf ${p(v.dir)}`) : `echo "tick 'I checked the path' to produce: rm -rf ${p(v.dir)}"`))
c('Files', 'Delete', 'Empty folder (keep it)', 'Delete the contents but not the folder itself', ['rm', 'empty'], 'danger', [D('dir', 'Folder', '/tmp/cache'), B('confirm', 'I checked the path')], (v) => (on(v.confirm) ? `find ${p(v.dir)} -mindepth 1 -delete` : `echo "tick 'I checked the path' first"`))
c('Files', 'Delete', 'Delete files older than', 'Remove files older than N days under a folder', ['find', 'delete', 'cleanup', 'old'], 'danger', [D('dir', 'Folder', '/var/log'), N('days', 'Older than (days)', 30), T('pattern', 'Name pattern', '*.log', '*.gz'), B('dry', 'Dry run (list only)', true)], (v) => `find ${p(v.dir)} -type f -name ${q(s(v.pattern, '*'))} -mtime +${n(v.days, 30)}${on(v.dry) ? ' -print' : ' -print -delete'}`)
c('Files', 'Delete', 'Remove empty folders', 'Delete every empty subfolder', ['find', 'empty', 'cleanup'], 'careful', [D(), B('dry', 'Dry run', true)], (v) => `find ${p(v.dir)} -mindepth 1 -type d -empty${on(v.dry) ? ' -print' : ' -print -delete'}`)

c('Files', 'Compare', 'Diff two files', 'Line-by-line differences', ['diff', 'compare'], 'safe', [P('a', 'File A', '/opt/a.txt'), P('b', 'File B', '/opt/b.txt'), B('unified', 'Unified format', true), B('ignoreSpace', 'Ignore whitespace')], (v) => `diff ${on(v.unified) ? '-u ' : ''}${on(v.ignoreSpace) ? '-w ' : ''}${p(v.a)} ${p(v.b)}`)
c('Files', 'Compare', 'Diff two folders', 'Which files differ between two folders', ['diff', 'compare', 'folders'], 'safe', [D('a', 'Folder A', '/opt/a'), D('b', 'Folder B', '/opt/b')], (v) => `diff -rq ${p(v.a)} ${p(v.b)}`)
c('Files', 'Compare', 'Checksum', 'Hash a file to compare or verify it', ['sha256', 'md5', 'checksum', 'hash'], 'safe', [P(), S('algo', 'Algorithm', ['sha256sum', 'md5sum', 'sha1sum'])], (v) => `${s(v.algo, 'sha256sum')} ${p(v.path)}`)
c('Files', 'Compare', 'Verify checksums file', 'Check files against a SHA256SUMS list', ['sha256', 'verify'], 'safe', [P('path', 'Checksum file', 'SHA256SUMS')], (v) => `sha256sum -c ${p(v.path)}`)

/* ======================= Search ======================= */
c('Search', 'Find files', 'Find by name', 'Files whose name matches a pattern', ['find', 'name', 'search'], 'safe', [D('dir', 'Search in', '/opt'), T('pattern', 'Name pattern', '*.log', '*.conf'), B('icase', 'Ignore case', true), S('type', 'Type', [{ v: '', l: 'anything' }, { v: 'f', l: 'files' }, { v: 'd', l: 'folders' }], ''), N('depth', 'Max depth (0 = unlimited)', 0)], (v) => `find ${p(v.dir)}${n(v.depth, 0) ? ` -maxdepth ${n(v.depth, 0)}` : ''}${s(v.type) ? ` -type ${s(v.type)}` : ''} -${on(v.icase) ? 'i' : ''}name ${q(v.pattern)} 2>/dev/null`)
c('Search', 'Find files', 'Find large files', 'Files bigger than a size, largest first', ['find', 'size', 'large', 'disk'], 'safe', [D('dir', 'Search in', '/'), N('mb', 'Bigger than (MB)', 100), N('top', 'Show top', 30)], (v) => `find ${p(v.dir)} -xdev -type f -size +${n(v.mb, 100)}M -printf '%s %p\\n' 2>/dev/null | sort -rn | head -${n(v.top, 30)} | awk '{printf "%.1f MB  %s\\n", $1/1048576, $2}'`)
c('Search', 'Find files', 'Find by extension', 'All files with a given extension', ['find', 'extension'], 'safe', [D('dir', 'Search in', '.'), T('ext', 'Extension', 'ts', 'jpg')], (v) => `find ${p(v.dir)} -type f -name ${q('*.' + s(v.ext, 'txt').replace(/^\./, ''))} | sort`)
c('Search', 'Find files', 'Find by owner', 'Files owned by a user', ['find', 'owner', 'user'], 'safe', [D('dir', 'Search in', '/home'), T('user', 'User', 'root')], (v) => `find ${p(v.dir)} -user ${p(v.user)} 2>/dev/null | head -200`)
c('Search', 'Find files', 'Find world-writable', 'Files anyone can write to (security check)', ['find', 'perm', 'security'], 'safe', [D('dir', 'Search in', '/etc')], (v) => `find ${p(v.dir)} -xdev -type f -perm -o+w 2>/dev/null`)
c('Search', 'Find files', 'Find broken symlinks', 'Links that point nowhere', ['find', 'symlink'], 'safe', [D('dir', 'Search in', '/')], (v) => `find ${p(v.dir)} -xdev -xtype l 2>/dev/null`)
c('Search', 'Find files', 'Find duplicates by size+hash', 'Files with identical content under a folder', ['find', 'duplicates', 'md5'], 'safe', [D('dir', 'Search in', '/data/media')], (v) => `find ${p(v.dir)} -type f -size +1k -exec md5sum {} + 2>/dev/null | sort | uniq -w32 -dD`)
c('Search', 'Find files', 'Locate by name (fast)', 'Search the locate database', ['locate', 'search'], 'safe', [T('name', 'Name', 'nginx.conf')], (v) => `locate ${q(v.name)} 2>/dev/null || find / -name ${q(v.name)} 2>/dev/null | head -50`)
c('Search', 'Find files', 'Which program', 'Where an executable lives', ['which', 'whereis', 'path'], 'safe', [T('name', 'Program', 'node', 'docker')], (v) => `which ${p(v.name)}; whereis ${p(v.name)}; ${p(v.name)} --version 2>/dev/null | head -2`)

c('Search', 'In content', 'Grep text in files', 'Lines containing a word or pattern, recursively', ['grep', 'search', 'text'], 'safe', [T('pattern', 'Search for', '', 'TODO'), D('dir', 'In', '.'), B('icase', 'Ignore case', true), B('regex', 'Treat as regular expression'), T('include', 'Only files matching', '', '*.ts'), N('context', 'Lines of context', 0), B('names', 'File names only')], (v) => `grep -rn${on(v.icase) ? 'i' : ''}${on(v.regex) ? 'E' : 'F'}${on(v.names) ? 'l' : ''}${n(v.context, 0) ? ` -C${n(v.context, 0)}` : ''}${s(v.include) ? ` --include=${q(v.include)}` : ''} --exclude-dir=node_modules --exclude-dir=.git -- ${q(v.pattern)} ${p(v.dir)}`)
c('Search', 'In content', 'Count matches per file', 'How many lines match in each file', ['grep', 'count'], 'safe', [T('pattern', 'Search for', '', 'error'), D('dir', 'In', '/var/log')], (v) => `grep -rci -- ${q(v.pattern)} ${p(v.dir)} 2>/dev/null | grep -v ':0$' | sort -t: -k2 -rn | head -30`)
c('Search', 'In content', 'Files containing all words', 'Files that contain every word listed', ['grep', 'and'], 'safe', [T('words', 'Words (space separated)', '', 'docker compose'), D('dir', 'In', '.')], (v) => s(v.words).split(/\s+/).filter(Boolean).reduce((acc, w, i) => (i === 0 ? `grep -rlF -- ${q(w)} ${p(v.dir)}` : `${acc} | xargs -r grep -lF -- ${q(w)}`), ''))
c('Search', 'In content', 'Search inside archives', 'Grep through compressed logs', ['zgrep', 'gz', 'logs'], 'safe', [T('pattern', 'Search for', '', 'error'), T('files', 'Files', '/var/log/*.gz')], (v) => `zgrep -i -- ${q(v.pattern)} ${s(v.files, '/var/log/*.gz')}`)
c('Search', 'In content', 'Search JSON key', 'Find a key in JSON files with jq', ['jq', 'json'], 'safe', [P('path', 'JSON file', 'package.json'), T('expr', 'jq expression', '.', '.dependencies')], (v) => `jq ${q(s(v.expr, '.'))} ${p(v.path)}`)

/* ======================= Text ======================= */
c('Text', 'View', 'Show file', 'Print a whole file (small files)', ['cat', 'view'], 'safe', [P('path', 'File', '/etc/hostname'), B('numbers', 'Line numbers')], (v) => `cat ${on(v.numbers) ? '-n ' : ''}${p(v.path)}`)
c('Text', 'View', 'First lines', 'Beginning of a file', ['head'], 'safe', [P(), N('lines', 'Lines', 20)], (v) => `head -n ${n(v.lines, 20)} ${p(v.path)}`)
c('Text', 'View', 'Last lines', 'End of a file', ['tail'], 'safe', [P('path', 'File', '/var/log/syslog'), N('lines', 'Lines', 50)], (v) => `tail -n ${n(v.lines, 50)} ${p(v.path)}`)
c('Text', 'View', 'Follow a file live', 'Watch new lines as they are written (Ctrl-C stops)', ['tail', 'follow', 'logs'], 'safe', [P('path', 'File', '/var/log/syslog'), N('lines', 'Start with last', 50)], (v) => `tail -n ${n(v.lines, 50)} -F ${p(v.path)}`)
c('Text', 'View', 'Page through a file', 'Open in less (q quits, / searches)', ['less', 'view'], 'safe', [P()], (v) => `less -N ${p(v.path)}`)
c('Text', 'View', 'Line range', 'Print lines N to M', ['sed', 'range'], 'safe', [P(), N('from', 'From line', 1), N('to', 'To line', 40)], (v) => `sed -n '${n(v.from, 1)},${n(v.to, 40)}p' ${p(v.path)}`)
c('Text', 'View', 'Count lines, words, bytes', 'wc on a file', ['wc', 'count'], 'safe', [P()], (v) => `wc ${p(v.path)}`)
c('Text', 'View', 'Hex dump', 'Bytes of a binary file', ['hexdump', 'xxd', 'binary'], 'safe', [P(), N('bytes', 'Bytes', 256)], (v) => `xxd -l ${n(v.bytes, 256)} ${p(v.path)} 2>/dev/null || hexdump -C -n ${n(v.bytes, 256)} ${p(v.path)}`)
c('Text', 'View', 'Pretty-print JSON', 'Format and colour a JSON file', ['jq', 'json'], 'safe', [P('path', 'JSON file', 'package.json')], (v) => `jq . ${p(v.path)} 2>/dev/null || python3 -m json.tool ${p(v.path)}`)

c('Text', 'Edit', 'Open in nano', 'Simple editor (Ctrl-O saves, Ctrl-X exits)', ['nano', 'edit'], 'careful', [P('path', 'File', '/opt/xgallery/.env'), SUDO], (v) => sudo(v, `nano ${p(v.path)}`), { ftp: 'edit' })
c('Text', 'Edit', 'Open in vim', 'Vim (press i to type, Esc then :wq to save and quit)', ['vim', 'edit'], 'careful', [P(), SUDO], (v) => sudo(v, `vim ${p(v.path)}`))
c('Text', 'Edit', 'Replace text in file', 'Find and replace every occurrence (makes a .bak first)', ['sed', 'replace'], 'careful', [P('path', 'File', '/opt/xgallery/.env'), T('find', 'Find', '', 'old'), T('replace', 'Replace with', '', 'new'), B('backup', 'Keep a .bak copy', true)], (v) => `sed -i${on(v.backup) ? '.bak' : ''} ${q(`s|${s(v.find).replace(/\|/g, '\\|')}|${s(v.replace).replace(/\|/g, '\\|')}|g`)} ${p(v.path)}`)
c('Text', 'Edit', 'Delete lines matching', 'Remove every line containing a pattern', ['sed', 'delete'], 'danger', [P(), T('pattern', 'Pattern', '', '^#'), B('backup', 'Keep a .bak copy', true)], (v) => `sed -i${on(v.backup) ? '.bak' : ''} ${q(`/${s(v.pattern).replace(/\//g, '\\/')}/d`)} ${p(v.path)}`)
c('Text', 'Edit', 'Set KEY=value in .env', 'Add or update a variable in an env file', ['env', 'sed', 'config'], 'careful', [P('path', 'Env file', '/opt/xgallery/.env'), T('key', 'KEY', '', 'ADMIN_PASSWORD'), T('value', 'value', '', 'secret')], (v) => `grep -q '^${s(v.key)}=' ${p(v.path)} && sed -i ${q(`s|^${s(v.key)}=.*|${s(v.key)}=${s(v.value)}|`)} ${p(v.path)} || echo ${q(`${s(v.key)}=${s(v.value)}`)} >> ${p(v.path)}; grep '^${s(v.key)}=' ${p(v.path)}`)
c('Text', 'Edit', 'Strip Windows line endings', 'Convert CRLF to LF in place', ['dos2unix', 'crlf'], 'careful', [P()], (v) => `sed -i 's/\\r$//' ${p(v.path)}`)

c('Text', 'Transform', 'Sort lines', 'Sort a file (optionally unique / numeric)', ['sort', 'uniq'], 'safe', [P(), B('unique', 'Unique only', true), B('numeric', 'Numeric'), B('reverse', 'Reverse')], (v) => `sort ${on(v.unique) ? '-u ' : ''}${on(v.numeric) ? '-n ' : ''}${on(v.reverse) ? '-r ' : ''}${p(v.path)}`)
c('Text', 'Transform', 'Most frequent lines', 'Count identical lines, most common first', ['sort', 'uniq', 'count', 'top'], 'safe', [P('path', 'File', '/var/log/auth.log'), N('top', 'Top', 20)], (v) => `sort ${p(v.path)} | uniq -c | sort -rn | head -${n(v.top, 20)}`)
c('Text', 'Transform', 'Extract column', 'Print one column of a delimited file', ['cut', 'awk', 'column', 'csv'], 'safe', [P('path', 'File', 'data.csv'), N('col', 'Column number', 2), T('delim', 'Delimiter', ',', ',')], (v) => `cut -d${q(s(v.delim, ','))} -f${n(v.col, 2)} ${p(v.path)}`)
c('Text', 'Transform', 'Sum a column', 'Add up a numeric column', ['awk', 'sum'], 'safe', [P('path', 'File', 'data.csv'), N('col', 'Column', 2), T('delim', 'Delimiter', ',', ',')], (v) => `awk -F${q(s(v.delim, ','))} '{s+=$${n(v.col, 2)}} END {print s}' ${p(v.path)}`)
c('Text', 'Transform', 'Table view', 'Align columns for reading', ['column', 'table', 'csv'], 'safe', [P('path', 'File', 'data.csv'), T('delim', 'Delimiter', ',', ',')], (v) => `column -s${q(s(v.delim, ','))} -t ${p(v.path)} | less -S`)
c('Text', 'Transform', 'Upper / lower case', 'Change the case of a whole file to stdout', ['tr', 'case'], 'safe', [P(), S('to', 'To', [{ v: 'upper', l: 'UPPER' }, { v: 'lower', l: 'lower' }])], (v) => `tr ${s(v.to) === 'lower' ? "'[:upper:]' '[:lower:]'" : "'[:lower:]' '[:upper:]'"} < ${p(v.path)}`)
c('Text', 'Transform', 'Base64 encode / decode', 'Encode or decode a file', ['base64'], 'safe', [P(), S('mode', 'Mode', [{ v: '', l: 'encode' }, { v: '-d', l: 'decode' }], '')], (v) => `base64 ${s(v.mode)} ${p(v.path)}`)
c('Text', 'Transform', 'YAML to JSON', 'Convert a YAML file with python', ['yaml', 'json', 'convert'], 'safe', [P('path', 'YAML file', 'docker-compose.yml')], (v) => `python3 -c 'import sys,yaml,json; print(json.dumps(yaml.safe_load(open(sys.argv[1])), indent=2))' ${p(v.path)}`)

/* ======================= Permissions ======================= */
c('Permissions', 'Mode', 'Change permissions (chmod)', 'Set an octal mode on a file or folder', ['chmod', 'permissions'], 'careful', [P(), S('mode', 'Mode', [{ v: '644', l: '644 · owner rw, others r (files)' }, { v: '600', l: '600 · owner only (secrets, keys)' }, { v: '755', l: '755 · owner rwx, others rx (scripts, folders)' }, { v: '700', l: '700 · owner only folder' }, { v: '664', l: '664 · group writable file' }, { v: '775', l: '775 · group writable folder' }, { v: '777', l: '777 · everyone (avoid)' }]), B('recursive', 'Recursive'), SUDO], (v) => sudo(v, `chmod ${on(v.recursive) ? '-R ' : ''}${s(v.mode, '644')} ${p(v.path)}`), { ftp: 'chmod' })
c('Permissions', 'Mode', 'Make executable', 'Allow running a script', ['chmod', 'x', 'executable'], 'safe', [P('path', 'Script', 'deploy.sh')], (v) => `chmod +x ${p(v.path)} && ls -l ${p(v.path)}`)
c('Permissions', 'Mode', 'Fix folder tree (files 644, dirs 755)', 'Sane defaults for a web or project folder', ['chmod', 'find', 'fix'], 'careful', [D('dir', 'Folder', '/opt/sites/demo/public'), SUDO], (v) => sudo(v, `find ${p(v.dir)} -type d -exec chmod 755 {} + && ${on(v.sudo) ? 'sudo ' : ''}find ${p(v.dir)} -type f -exec chmod 644 {} +`))
c('Permissions', 'Mode', 'Lock down a key file', 'Private keys must be 600 or ssh refuses them', ['chmod', 'ssh', 'key'], 'safe', [P('path', 'Key file', '~/.ssh/id_ed25519')], (v) => `chmod 600 ${p(v.path)} && chmod 700 ~/.ssh && ls -la ~/.ssh`)
c('Permissions', 'Owner', 'Change owner (chown)', 'Set user and group of a path', ['chown', 'owner'], 'careful', [P(), T('user', 'User', 'root', 'www-data'), T('group', 'Group (optional)', '', 'www-data'), B('recursive', 'Recursive'), SUDO], (v) => sudo(v, `chown ${on(v.recursive) ? '-R ' : ''}${p(v.user)}${s(v.group) ? ':' + p(v.group) : ''} ${p(v.path)}`))
c('Permissions', 'Owner', 'Change group (chgrp)', 'Set the group of a path', ['chgrp', 'group'], 'careful', [P(), T('group', 'Group', 'docker'), B('recursive', 'Recursive'), SUDO], (v) => sudo(v, `chgrp ${on(v.recursive) ? '-R ' : ''}${p(v.group)} ${p(v.path)}`))
c('Permissions', 'Owner', 'Take ownership of a folder', 'Make the current user own a tree', ['chown', 'me'], 'careful', [D(), SUDO], (v) => sudo(v, `chown -R $(id -u):$(id -g) ${p(v.dir)}`))
c('Permissions', 'Inspect', 'Show permissions', 'Octal and symbolic permissions with owner', ['stat', 'ls', 'permissions'], 'safe', [P()], (v) => `stat -c '%A %a %U:%G %n' ${p(v.path)}`)
c('Permissions', 'Inspect', 'ACL of a path', 'Access control list entries', ['getfacl', 'acl'], 'safe', [P()], (v) => `getfacl ${p(v.path)} 2>/dev/null || echo 'acl tools not installed (apt install acl)'`)
c('Permissions', 'Inspect', 'Immutable flag', 'Make a file unchangeable (or undo)', ['chattr', 'immutable'], 'careful', [P('path', 'File', '/etc/resolv.conf'), S('mode', 'Action', [{ v: '+i', l: 'make immutable' }, { v: '-i', l: 'make writable again' }]), SUDO], (v) => sudo(v, `chattr ${s(v.mode, '+i')} ${p(v.path)} && lsattr ${p(v.path)}`))

/* ======================= Archives ======================= */
c('Archives', 'Create', 'Tar + compress folder', 'Pack a folder into a compressed archive', ['tar', 'gzip', 'archive', 'backup'], 'safe', [D('dir', 'Folder', '/opt/xgallery'), P('out', 'Archive file', '/root/xgallery.tar.gz'), S('comp', 'Compression', [{ v: 'z', l: 'gzip (.tar.gz)' }, { v: 'J', l: 'xz (.tar.xz, smaller, slower)' }, { v: 'j', l: 'bzip2 (.tar.bz2)' }, { v: '', l: 'none (.tar)' }]), T('exclude', 'Exclude', 'node_modules', '.git')], (v) => `tar -c${s(v.comp)}vf ${p(v.out)}${s(v.exclude) ? ` --exclude=${q(v.exclude)}` : ''} -C $(dirname ${p(v.dir)}) $(basename ${p(v.dir)})`)
c('Archives', 'Create', 'Zip folder', 'Create a .zip (Windows-friendly)', ['zip', 'archive'], 'safe', [D('dir', 'Folder', '/opt/sites/demo/public'), P('out', 'Zip file', '/root/public.zip'), T('exclude', 'Exclude', '*.git*', 'node_modules/*')], (v) => `zip -r ${p(v.out)} ${p(v.dir)}${s(v.exclude) ? ` -x ${q(v.exclude)}` : ''}`)
c('Archives', 'Create', 'Gzip a single file', 'Compress one file (keeps original on request)', ['gzip'], 'safe', [P('path', 'File', '/var/log/big.log'), B('keep', 'Keep the original', true)], (v) => `gzip ${on(v.keep) ? '-k ' : ''}${p(v.path)}`)
c('Archives', 'Extract', 'Extract tar archive', 'Unpack .tar / .tar.gz / .tar.xz / .tar.bz2', ['tar', 'extract', 'unpack'], 'careful', [P('path', 'Archive', '/root/xgallery.tar.gz'), D('dir', 'Into', '/opt'), B('list', 'List only (do not extract)')], (v) => `${on(v.list) ? 'tar -tvf' : `mkdir -p ${p(v.dir)} && tar -xvf`} ${p(v.path)}${on(v.list) ? '' : ` -C ${p(v.dir)}`}`)
c('Archives', 'Extract', 'Unzip', 'Unpack a .zip file', ['unzip', 'extract'], 'careful', [P('path', 'Zip file', '/root/public.zip'), D('dir', 'Into', '/opt/sites/demo/public'), B('overwrite', 'Overwrite existing', true)], (v) => `unzip ${on(v.overwrite) ? '-o ' : '-n '}${p(v.path)} -d ${p(v.dir)}`)
c('Archives', 'Extract', 'Gunzip', 'Decompress a .gz file', ['gunzip', 'gzip'], 'safe', [P('path', 'File', '/var/log/syslog.1.gz'), B('keep', 'Keep the .gz', true)], (v) => `gunzip ${on(v.keep) ? '-k ' : ''}${p(v.path)}`)
c('Archives', 'Extract', 'Peek into an archive', 'List what an archive contains', ['tar', 'zip', 'list'], 'safe', [P('path', 'Archive', '/root/backup.tar.gz')], (v) => `case ${p(v.path)} in *.zip) unzip -l ${p(v.path)};; *) tar -tvf ${p(v.path)} | head -100;; esac`)
c('Archives', 'Split', 'Split a big file', 'Cut a file into chunks for transfer', ['split', 'chunks'], 'safe', [P('path', 'File', '/root/backup.tar.gz'), T('size', 'Chunk size', '500M', '1G')], (v) => `split -b ${s(v.size, '500M')} -d ${p(v.path)} ${p(v.path)}.part- && ls -lh ${p(v.path)}.part-*`)
c('Archives', 'Split', 'Join chunks', 'Reassemble split parts', ['cat', 'join'], 'safe', [P('path', 'Original file name', '/root/backup.tar.gz')], (v) => `cat ${p(v.path)}.part-* > ${p(v.path)} && ls -lh ${p(v.path)}`)

/* ======================= Transfer ======================= */
c('Transfer', 'Download', 'Download a URL', 'Fetch a file from the web with curl', ['curl', 'wget', 'download'], 'safe', [T('url', 'URL', '', 'https://example.com/file.zip'), P('out', 'Save as', '/root/file.zip')], (v) => `curl -fL --progress-bar -o ${p(v.out)} ${q(v.url)} && ls -lh ${p(v.out)}`)
c('Transfer', 'Download', 'Download and extract', 'Fetch a tarball and unpack it in one go', ['curl', 'tar', 'download'], 'careful', [T('url', 'URL', '', 'https://example.com/app.tar.gz'), D('dir', 'Into', '/opt/app')], (v) => `mkdir -p ${p(v.dir)} && curl -fL ${q(v.url)} | tar -xz -C ${p(v.dir)} && ls ${p(v.dir)}`)
c('Transfer', 'Download', 'Mirror a website folder', 'wget a site recursively', ['wget', 'mirror'], 'careful', [T('url', 'URL', '', 'https://example.com/docs/'), D('dir', 'Into', '/root/mirror')], (v) => `wget -r -np -k -P ${p(v.dir)} ${q(v.url)}`)
c('Transfer', 'Between servers', 'Copy to another server (scp)', 'Push a file or folder to another host', ['scp', 'copy', 'remote'], 'careful', [P('src', 'Local path', '/root/backup.tar.gz'), T('host', 'user@host', 'root@203.0.113.5'), P('dst', 'Remote path', '/root/'), N('port', 'Port', 22)], (v) => `scp -r -P ${n(v.port, 22)} ${p(v.src)} ${s(v.host)}:${p(v.dst)}`)
c('Transfer', 'Between servers', 'Copy from another server (scp)', 'Pull a file or folder from another host', ['scp', 'copy', 'remote'], 'careful', [T('host', 'user@host', 'root@203.0.113.5'), P('src', 'Remote path', '/root/backup.tar.gz'), P('dst', 'Local path', '/root/'), N('port', 'Port', 22)], (v) => `scp -r -P ${n(v.port, 22)} ${s(v.host)}:${p(v.src)} ${p(v.dst)}`)
c('Transfer', 'Between servers', 'Sync to another server (rsync)', 'Incremental push over ssh', ['rsync', 'remote', 'sync'], 'careful', [D('src', 'Local folder', '/data/'), T('host', 'user@host', 'root@203.0.113.5'), D('dst', 'Remote folder', '/data/'), B('delete', 'Delete extras on the remote'), B('dry', 'Dry run', true)], (v) => `rsync -avzh --progress${on(v.delete) ? ' --delete' : ''}${on(v.dry) ? ' --dry-run' : ''} -e ssh ${p(v.src)} ${s(v.host)}:${p(v.dst)}`)
c('Transfer', 'Between servers', 'Pipe a folder over ssh', 'tar through ssh when rsync is not available', ['tar', 'ssh', 'pipe'], 'careful', [D('src', 'Local folder', '/opt/xgallery'), T('host', 'user@host', 'root@203.0.113.5'), D('dst', 'Remote parent folder', '/opt')], (v) => `tar -cz -C $(dirname ${p(v.src)}) $(basename ${p(v.src)}) | ssh ${s(v.host)} 'mkdir -p ${p(v.dst)} && tar -xz -C ${p(v.dst)}'`)
c('Transfer', 'Serve', 'Share a folder over HTTP', 'Quick web server for a folder (Ctrl-C stops)', ['python', 'http', 'serve'], 'careful', [D('dir', 'Folder', '/root/docker-exports'), N('port', 'Port', 8080)], (v) => `cd ${p(v.dir)} && python3 -m http.server ${n(v.port, 8080)}`)
c('Transfer', 'Serve', 'Upload a file to a paste service', 'Get a shareable URL for a small file', ['curl', 'share'], 'careful', [P('path', 'File', '/var/log/app.log')], (v) => `curl -F "file=@${s(v.path)}" https://0x0.st`)
c('Transfer', 'Docker', 'Copy file into a container', 'docker cp host → container', ['docker', 'cp'], 'careful', [P('src', 'Host path', '/root/file.txt'), T('container', 'Container', 'xgallery-app'), P('dst', 'Path in container', '/app/file.txt')], (v) => `docker cp ${p(v.src)} ${p(v.container)}:${p(v.dst)}`)
c('Transfer', 'Docker', 'Copy file out of a container', 'docker cp container → host', ['docker', 'cp'], 'safe', [T('container', 'Container', 'xgallery-app'), P('src', 'Path in container', '/data/xgallery.db'), P('dst', 'Host path', '/root/xgallery.db')], (v) => `docker cp ${p(v.container)}:${p(v.src)} ${p(v.dst)} && ls -lh ${p(v.dst)}`)

/* ======================= Disk ======================= */
c('Disk', 'Usage', 'Free space', 'Disk usage of every mounted filesystem', ['df', 'disk', 'space'], 'safe', [], () => 'df -hT -x tmpfs -x devtmpfs -x overlay')
c('Disk', 'Usage', 'Inode usage', 'Running out of inodes looks like a full disk', ['df', 'inodes'], 'safe', [], () => 'df -ih -x tmpfs -x devtmpfs -x overlay')
c('Disk', 'Usage', 'Biggest folders on /', 'Top-level folders by size', ['du', 'biggest'], 'safe', [N('top', 'Top', 20)], (v) => `du -xh --max-depth=1 / 2>/dev/null | sort -rh | head -${n(v.top, 20)}`)
c('Disk', 'Usage', 'Interactive disk explorer', 'ncdu (arrow keys, d deletes, q quits)', ['ncdu', 'disk'], 'safe', [D('dir', 'Start at', '/')], (v) => `ncdu -x ${p(v.dir)} 2>/dev/null || (echo 'ncdu not installed: apt install ncdu'; du -xh --max-depth=1 ${p(v.dir)} | sort -rh | head -20)`)
c('Disk', 'Usage', 'Docker disk usage', 'What docker images, containers, volumes and cache take', ['docker', 'df'], 'safe', [], () => 'docker system df -v | head -60')
c('Disk', 'Usage', 'Deleted-but-open files', 'Space held by deleted files still open by a process', ['lsof', 'deleted', 'space'], 'safe', [], () => "lsof -nP +L1 2>/dev/null | head -30 || echo 'lsof not installed'")
c('Disk', 'Devices', 'Block devices', 'Disks, partitions and mount points', ['lsblk', 'disk'], 'safe', [], () => 'lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT,TYPE')
c('Disk', 'Devices', 'Mounted filesystems', 'Everything mounted, with options', ['mount', 'findmnt'], 'safe', [], () => 'findmnt -t ext4,xfs,btrfs,vfat,nfs,cifs -o TARGET,SOURCE,FSTYPE,OPTIONS')
c('Disk', 'Devices', 'Mount a device', 'Attach a disk or partition to a folder', ['mount'], 'careful', [T('device', 'Device', '/dev/sdb1'), D('dir', 'Mount point', '/mnt/data'), SUDO], (v) => sudo(v, `mkdir -p ${p(v.dir)} && ${on(v.sudo) ? 'sudo ' : ''}mount ${p(v.device)} ${p(v.dir)} && df -h ${p(v.dir)}`))
c('Disk', 'Devices', 'Unmount', 'Detach a mounted folder', ['umount'], 'careful', [D('dir', 'Mount point', '/mnt/data'), SUDO], (v) => sudo(v, `umount ${p(v.dir)}`))
c('Disk', 'Devices', 'SMART health', 'Disk health report', ['smartctl', 'health'], 'safe', [T('device', 'Device', '/dev/sda'), SUDO], (v) => sudo(v, `smartctl -H ${p(v.device)} 2>/dev/null || echo 'smartmontools not installed or virtual disk'`))
c('Disk', 'Swap', 'Memory and swap', 'RAM and swap in use', ['free', 'memory', 'swap'], 'safe', [], () => 'free -h; swapon --show')
c('Disk', 'Swap', 'Create a swap file', 'Add swap space (helps small VPS plans)', ['swap', 'fallocate'], 'careful', [N('gb', 'Size (GB)', 2), SUDO], (v) => sudo(v, `fallocate -l ${n(v.gb, 2)}G /swapfile && ${on(v.sudo) ? 'sudo ' : ''}chmod 600 /swapfile && ${on(v.sudo) ? 'sudo ' : ''}mkswap /swapfile && ${on(v.sudo) ? 'sudo ' : ''}swapon /swapfile && echo '/swapfile none swap sw 0 0' | ${on(v.sudo) ? 'sudo ' : ''}tee -a /etc/fstab && free -h`))
c('Disk', 'Cleanup', 'Clean apt cache', 'Remove downloaded package files', ['apt', 'clean', 'cleanup'], 'safe', [SUDO], (v) => sudo(v, 'apt-get clean && ' + (on(v.sudo) ? 'sudo ' : '') + 'apt-get autoremove -y'))
c('Disk', 'Cleanup', 'Vacuum journal logs', 'Shrink systemd journal to a size', ['journalctl', 'vacuum', 'logs'], 'safe', [T('size', 'Keep at most', '200M', '500M'), SUDO], (v) => sudo(v, `journalctl --vacuum-size=${s(v.size, '200M')}`))
c('Disk', 'Cleanup', 'Prune docker', 'Remove unused images, containers, networks, build cache', ['docker', 'prune', 'cleanup'], 'careful', [B('volumes', 'Also unused volumes (data loss!)')], (v) => `docker system prune -af${on(v.volumes) ? ' --volumes' : ''}`)
c('Disk', 'Cleanup', 'Rotate logs now', 'Force logrotate to run', ['logrotate', 'logs'], 'safe', [SUDO], (v) => sudo(v, 'logrotate -f /etc/logrotate.conf'))
c('Disk', 'Cleanup', 'Truncate a huge log', 'Empty a log file without deleting it', ['truncate', 'log'], 'careful', [P('path', 'Log file', '/var/log/syslog'), SUDO], (v) => sudo(v, `truncate -s 0 ${p(v.path)}`))

/* ======================= Processes ======================= */
c('Processes', 'Inspect', 'Top processes by CPU', 'Who is using the CPU', ['ps', 'top', 'cpu'], 'safe', [N('top', 'Top', 15)], (v) => `ps -eo pid,user,%cpu,%mem,etime,comm --sort=-%cpu | head -${n(v.top, 15) + 1}`)
c('Processes', 'Inspect', 'Top processes by memory', 'Who is using the RAM', ['ps', 'top', 'memory'], 'safe', [N('top', 'Top', 15)], (v) => `ps -eo pid,user,%cpu,%mem,rss,comm --sort=-%mem | head -${n(v.top, 15) + 1}`)
c('Processes', 'Inspect', 'Live monitor', 'htop or top (q quits)', ['htop', 'top', 'monitor'], 'safe', [], () => 'htop 2>/dev/null || top')
c('Processes', 'Inspect', 'Find a process', 'Processes whose name matches', ['pgrep', 'ps', 'find'], 'safe', [T('name', 'Name', 'node', 'nginx')], (v) => `pgrep -af ${q(v.name)}`)
c('Processes', 'Inspect', 'Process tree', 'Parent/child view', ['pstree'], 'safe', [T('name', 'Root process (optional)', '', 'docker')], (v) => (s(v.name) ? `pstree -p $(pgrep -o ${q(v.name)})` : 'pstree -p | head -60'))
c('Processes', 'Inspect', 'Open files of a process', 'What a process has open', ['lsof', 'files'], 'safe', [N('pid', 'PID', 1)], (v) => `lsof -p ${n(v.pid, 1)} 2>/dev/null | head -60`)
c('Processes', 'Inspect', 'Who uses a port', 'Process listening on a port', ['lsof', 'ss', 'port'], 'safe', [N('port', 'Port', 3000)], (v) => `ss -tulpn | grep :${n(v.port, 3000)} || lsof -i :${n(v.port, 3000)}`)
c('Processes', 'Inspect', 'Trace system calls', 'strace a running process for a few seconds', ['strace', 'debug'], 'careful', [N('pid', 'PID', 1), N('seconds', 'Seconds', 5), SUDO], (v) => sudo(v, `timeout ${n(v.seconds, 5)} strace -f -p ${n(v.pid, 1)} 2>&1 | tail -50`))
c('Processes', 'Control', 'Stop a process gracefully', 'SIGTERM by PID', ['kill', 'term'], 'danger', [N('pid', 'PID', 0), SUDO], (v) => sudo(v, `kill ${n(v.pid, 0)}`))
c('Processes', 'Control', 'Force kill', 'SIGKILL by PID (cannot be caught)', ['kill', '9'], 'danger', [N('pid', 'PID', 0), SUDO], (v) => sudo(v, `kill -9 ${n(v.pid, 0)}`))
c('Processes', 'Control', 'Kill by name', 'Stop every process with a name', ['pkill', 'killall'], 'danger', [T('name', 'Name', '', 'node'), B('force', 'Force (-9)')], (v) => `pkill ${on(v.force) ? '-9 ' : ''}-f ${q(v.name)}`)
c('Processes', 'Control', 'Run in background (nohup)', 'Start a long job that survives logout', ['nohup', 'background'], 'careful', [T('cmd', 'Command', '', 'npm run build'), P('log', 'Log file', '/root/job.log')], (v) => `nohup ${s(v.cmd)} > ${p(v.log)} 2>&1 &\necho "started pid $!"; sleep 1; tail -5 ${p(v.log)}`)
c('Processes', 'Control', 'Run with low priority', 'nice + ionice for heavy jobs', ['nice', 'ionice'], 'safe', [T('cmd', 'Command', '', 'tar -czf /root/b.tgz /data')], (v) => `nice -n 19 ionice -c3 ${s(v.cmd)}`)
c('Processes', 'Control', 'Repeat a command (watch)', 'Re-run every N seconds (Ctrl-C stops)', ['watch', 'repeat'], 'safe', [T('cmd', 'Command', 'docker ps', 'df -h'), N('every', 'Every (s)', 2)], (v) => `watch -n ${n(v.every, 2)} ${q(v.cmd)}`)
c('Processes', 'Control', 'Time a command', 'How long something takes', ['time'], 'safe', [T('cmd', 'Command', '', 'npm run build')], (v) => `time ${s(v.cmd)}`)
c('Processes', 'Sessions', 'tmux: new or attach', 'Persistent session that survives disconnects', ['tmux', 'session'], 'safe', [T('name', 'Session name', 'main')], (v) => `tmux new -A -s ${p(v.name)}`)
c('Processes', 'Sessions', 'tmux: list sessions', 'What tmux sessions exist', ['tmux'], 'safe', [], () => 'tmux ls 2>/dev/null || echo "no tmux sessions"')
c('Processes', 'Sessions', 'screen: new or attach', 'Alternative to tmux', ['screen', 'session'], 'safe', [T('name', 'Session name', 'main')], (v) => `screen -DR ${p(v.name)}`)

/* ======================= Services ======================= */
const UNITS = ['docker', 'ssh', 'cron', 'fail2ban', 'ufw', 'nginx', 'caddy', 'coolify']
c('Services', 'systemd', 'Service status', 'Is it running, since when, last log lines', ['systemctl', 'status'], 'safe', [S('unit', 'Service', UNITS, 'docker'), T('other', 'Or type a unit', '', 'myapp.service')], (v) => `systemctl status ${p(s(v.other) || s(v.unit, 'docker'))} --no-pager -l | head -40`)
c('Services', 'systemd', 'Start / stop / restart', 'Control a service', ['systemctl', 'restart'], 'careful', [S('action', 'Action', ['restart', 'start', 'stop', 'reload']), S('unit', 'Service', UNITS, 'docker'), T('other', 'Or type a unit', ''), SUDO], (v) => sudo(v, `systemctl ${s(v.action, 'restart')} ${p(s(v.other) || s(v.unit, 'docker'))} && systemctl is-active ${p(s(v.other) || s(v.unit, 'docker'))}`))
c('Services', 'systemd', 'Enable / disable at boot', 'Whether it starts when the server boots', ['systemctl', 'enable'], 'careful', [S('action', 'Action', ['enable', 'disable']), S('unit', 'Service', UNITS, 'docker'), T('other', 'Or type a unit', ''), SUDO], (v) => sudo(v, `systemctl ${s(v.action, 'enable')} ${p(s(v.other) || s(v.unit, 'docker'))}`))
c('Services', 'systemd', 'List services', 'All services and their state', ['systemctl', 'list'], 'safe', [S('state', 'Show', [{ v: '', l: 'all' }, { v: '--state=running', l: 'running' }, { v: '--state=failed', l: 'failed' }], '')], (v) => `systemctl list-units --type=service ${s(v.state)} --no-pager --no-legend | head -80`)
c('Services', 'systemd', 'Failed units', 'Anything that failed to start', ['systemctl', 'failed'], 'safe', [], () => 'systemctl --failed --no-pager')
c('Services', 'systemd', 'Reload unit files', 'After editing a .service file', ['daemon-reload'], 'safe', [SUDO], (v) => sudo(v, 'systemctl daemon-reload'))
c('Services', 'systemd', 'Create a service', 'Write a unit file that runs a command at boot', ['systemd', 'unit', 'create'], 'careful', [T('name', 'Unit name', 'myapp', 'myapp'), T('cmd', 'Command', '/usr/bin/node /opt/app/server.js'), D('dir', 'Working directory', '/opt/app'), T('user', 'User', 'root'), SUDO], (v) => `${on(v.sudo) ? 'sudo ' : ''}tee /etc/systemd/system/${s(v.name, 'myapp')}.service >/dev/null <<'EOF'\n[Unit]\nDescription=${s(v.name, 'myapp')}\nAfter=network.target\n\n[Service]\nExecStart=${s(v.cmd)}\nWorkingDirectory=${s(v.dir, '/opt/app')}\nUser=${s(v.user, 'root')}\nRestart=always\nRestartSec=3\n\n[Install]\nWantedBy=multi-user.target\nEOF\n${on(v.sudo) ? 'sudo ' : ''}systemctl daemon-reload && ${on(v.sudo) ? 'sudo ' : ''}systemctl enable --now ${s(v.name, 'myapp')} && systemctl status ${s(v.name, 'myapp')} --no-pager | head -20`)
c('Services', 'Timers', 'List timers', 'systemd timers (scheduled jobs)', ['timers', 'schedule'], 'safe', [], () => 'systemctl list-timers --all --no-pager')
c('Services', 'Logs', 'Service log', 'Recent journal lines of a unit', ['journalctl', 'logs'], 'safe', [S('unit', 'Service', UNITS, 'docker'), T('other', 'Or type a unit', ''), N('lines', 'Lines', 100), B('follow', 'Follow live')], (v) => `journalctl -u ${p(s(v.other) || s(v.unit, 'docker'))} -n ${n(v.lines, 100)} --no-pager${on(v.follow) ? ' -f' : ''}`)
c('Services', 'Logs', 'Errors since', 'Journal errors in a time window', ['journalctl', 'errors'], 'safe', [S('since', 'Since', ['1 hour ago', 'today', 'yesterday', '24 hours ago', '7 days ago'])], (v) => `journalctl -p err --since ${q(s(v.since, '1 hour ago'))} --no-pager | tail -100`)
c('Services', 'Logs', 'Boot log', 'Messages from the current boot', ['journalctl', 'boot', 'dmesg'], 'safe', [], () => 'journalctl -b --no-pager | tail -80; dmesg -T 2>/dev/null | tail -30')

/* ======================= Network ======================= */
c('Network', 'Status', 'IP addresses', 'Interfaces and addresses', ['ip', 'addr'], 'safe', [], () => 'ip -br addr; echo; curl -s4 --max-time 5 ifconfig.me && echo "  (public IPv4)"')
c('Network', 'Status', 'Listening ports', 'Which ports are open and by which process', ['ss', 'ports', 'listen'], 'safe', [], () => 'ss -tulpn | sort -k5')
c('Network', 'Status', 'Active connections', 'Established TCP connections', ['ss', 'connections'], 'safe', [N('top', 'Show', 40)], (v) => `ss -tnp state established | head -${n(v.top, 40)}`)
c('Network', 'Status', 'Routes and gateway', 'Routing table', ['ip', 'route'], 'safe', [], () => 'ip route; echo; cat /etc/resolv.conf')
c('Network', 'Status', 'Bandwidth now', 'Live per-interface traffic (q quits)', ['iftop', 'nload', 'bandwidth'], 'safe', [], () => "iftop -n 2>/dev/null || nload 2>/dev/null || (cat /proc/net/dev; echo 'install iftop or nload for a live view')")
c('Network', 'Test', 'Ping a host', 'Reachability and latency', ['ping'], 'safe', [T('host', 'Host', 'google.com'), N('count', 'Packets', 4)], (v) => `ping -c ${n(v.count, 4)} ${p(v.host)}`)
c('Network', 'Test', 'Trace route', 'Hops to a host', ['traceroute', 'mtr'], 'safe', [T('host', 'Host', 'google.com')], (v) => `mtr -rw -c 5 ${p(v.host)} 2>/dev/null || traceroute ${p(v.host)}`)
c('Network', 'Test', 'Check a TCP port', 'Is a port open on a host', ['nc', 'port', 'open'], 'safe', [T('host', 'Host', '127.0.0.1'), N('port', 'Port', 443)], (v) => `timeout 5 bash -c '</dev/tcp/${s(v.host, '127.0.0.1')}/${n(v.port, 443)}' && echo open || echo closed`)
c('Network', 'Test', 'HTTP headers', 'What a URL answers (status, headers, timing)', ['curl', 'http', 'headers'], 'safe', [T('url', 'URL', 'https://xgallery.amberxai.com/healthz')], (v) => `curl -sS -o /dev/null -D - -w '\\nHTTP %{http_code} in %{time_total}s · %{size_download} bytes\\n' --max-time 15 ${q(v.url)}`)
c('Network', 'Test', 'HTTP body', 'GET a URL and show the response', ['curl', 'http', 'get'], 'safe', [T('url', 'URL', 'https://xgallery.amberxai.com/api/settings'), N('bytes', 'Show first bytes', 2000)], (v) => `curl -sS --max-time 15 ${q(v.url)} | head -c ${n(v.bytes, 2000)}; echo`)
c('Network', 'Test', 'POST JSON', 'Send a JSON body to a URL', ['curl', 'post', 'json'], 'careful', [T('url', 'URL', 'http://127.0.0.1:3000/api/auth/login'), T('json', 'JSON body', '{"username":"x","password":"y"}')], (v) => `curl -sS -X POST -H 'Content-Type: application/json' -H 'X-Requested-With: xgallery' --data ${q(v.json)} ${q(v.url)}; echo`)
c('Network', 'Test', 'DNS lookup', 'Resolve a name (A, AAAA, MX, TXT…)', ['dig', 'dns'], 'safe', [T('name', 'Name', 'xgallery.amberxai.com'), S('type', 'Record', ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'ANY'])], (v) => `dig +short ${p(v.name)} ${s(v.type, 'A')} 2>/dev/null || nslookup -type=${s(v.type, 'A')} ${p(v.name)}`)
c('Network', 'Test', 'TLS certificate', 'Expiry and issuer of a site certificate', ['openssl', 'tls', 'cert'], 'safe', [T('host', 'Host', 'xgallery.amberxai.com')], (v) => `echo | openssl s_client -servername ${p(v.host)} -connect ${p(v.host)}:443 2>/dev/null | openssl x509 -noout -subject -issuer -dates`)
c('Network', 'Test', 'Download speed', 'Rough throughput test', ['curl', 'speed'], 'safe', [], () => "curl -o /dev/null -w 'speed %{speed_download} bytes/s\\n' --max-time 20 https://speed.cloudflare.com/__down?bytes=50000000")
c('Network', 'Capture', 'Capture packets on a port', 'tcpdump for a few seconds', ['tcpdump', 'capture'], 'careful', [N('port', 'Port', 80), N('seconds', 'Seconds', 10), SUDO], (v) => sudo(v, `timeout ${n(v.seconds, 10)} tcpdump -ni any port ${n(v.port, 80)} -c 50`))
c('Network', 'Firewall', 'ufw status', 'Firewall rules, numbered', ['ufw', 'firewall'], 'safe', [SUDO], (v) => sudo(v, 'ufw status numbered'))
c('Network', 'Firewall', 'ufw allow / deny', 'Add a rule', ['ufw', 'allow', 'deny'], 'careful', [S('action', 'Action', ['allow', 'deny', 'limit']), T('rule', 'Port/proto or service', '443/tcp', '22/tcp · 60000:61000/udp · OpenSSH'), T('from', 'From IP (optional)', '', '203.0.113.5'), SUDO], (v) => sudo(v, s(v.from) ? `ufw ${s(v.action, 'allow')} from ${p(v.from)} to any port ${s(v.rule, '443').replace(/\/.*$/, '')}` : `ufw ${s(v.action, 'allow')} ${s(v.rule, '443/tcp')}`))
c('Services', 'Firewall', 'ufw delete rule', 'Remove rule by its number', ['ufw', 'delete'], 'careful', [N('number', 'Rule number', 1), SUDO], (v) => sudo(v, `ufw --force delete ${n(v.number, 1)}`))
c('Network', 'Firewall', 'ufw enable / disable', 'Turn the firewall on or off (allow SSH first!)', ['ufw', 'enable'], 'danger', [S('action', 'Action', [{ v: '--force enable', l: 'enable' }, { v: 'disable', l: 'disable' }, { v: 'reload', l: 'reload' }]), SUDO], (v) => sudo(v, `ufw ${s(v.action)}`))
c('Network', 'Firewall', 'iptables rules', 'Raw netfilter rules', ['iptables'], 'safe', [SUDO], (v) => sudo(v, 'iptables -L -n -v --line-numbers | head -80'))
c('Network', 'Firewall', 'fail2ban status', 'Banned IPs for sshd', ['fail2ban', 'ban'], 'safe', [SUDO], (v) => sudo(v, 'fail2ban-client status sshd'))
c('Network', 'Firewall', 'fail2ban unban IP', 'Lift a ban', ['fail2ban', 'unban'], 'careful', [T('ip', 'IP', '', '203.0.113.5'), SUDO], (v) => sudo(v, `fail2ban-client set sshd unbanip ${p(v.ip)}`))

/* ======================= Docker ======================= */
c('Docker', 'Containers', 'List containers', 'Running (or all) containers', ['docker', 'ps'], 'safe', [B('all', 'Include stopped', true)], (v) => `docker ps ${on(v.all) ? '-a ' : ''}--format 'table {{.Names}}\\t{{.Status}}\\t{{.Image}}\\t{{.Ports}}'`)
c('Docker', 'Containers', 'Container logs', 'Recent log lines, optionally following', ['docker', 'logs'], 'safe', [T('container', 'Container', 'xgallery-app'), N('tail', 'Lines', 100), B('follow', 'Follow live'), T('since', 'Since (optional)', '', '1h')], (v) => `docker logs --tail ${n(v.tail, 100)}${on(v.follow) ? ' -f' : ''}${s(v.since) ? ` --since ${s(v.since)}` : ''} ${p(v.container)}`)
c('Docker', 'Containers', 'Shell into a container', 'Interactive shell inside', ['docker', 'exec', 'shell'], 'careful', [T('container', 'Container', 'xgallery-app'), S('shell', 'Shell', ['sh', 'bash', 'ash'])], (v) => `docker exec -it ${p(v.container)} ${s(v.shell, 'sh')}`)
c('Docker', 'Containers', 'Run a command in a container', 'One-off command', ['docker', 'exec'], 'careful', [T('container', 'Container', 'xgallery-app'), T('cmd', 'Command', 'ls -la /data')], (v) => `docker exec ${p(v.container)} sh -c ${q(v.cmd)}`)
c('Docker', 'Containers', 'Restart / stop / start', 'Control a container', ['docker', 'restart'], 'careful', [S('action', 'Action', ['restart', 'stop', 'start', 'pause', 'unpause', 'kill']), T('container', 'Container', 'xgallery-app')], (v) => `docker ${s(v.action, 'restart')} ${p(v.container)}`)
c('Docker', 'Containers', 'Remove a container', 'Delete a stopped container', ['docker', 'rm'], 'danger', [T('container', 'Container', ''), B('force', 'Force (even if running)')], (v) => `docker rm ${on(v.force) ? '-f ' : ''}${p(v.container)}`)
c('Docker', 'Containers', 'Inspect', 'Full configuration as JSON', ['docker', 'inspect'], 'safe', [T('container', 'Container', 'xgallery-app'), T('path', 'Only this field (optional)', '', '.State.Health')], (v) => (s(v.path) ? `docker inspect --format '{{json ${s(v.path)}}}' ${p(v.container)} | jq .` : `docker inspect ${p(v.container)} | head -120`))
c('Docker', 'Containers', 'Live stats', 'CPU/memory of all containers (Ctrl-C stops)', ['docker', 'stats'], 'safe', [B('once', 'Just once', true)], (v) => `docker stats ${on(v.once) ? '--no-stream ' : ''}--format 'table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.NetIO}}'`)
c('Docker', 'Containers', 'Container top', 'Processes inside a container', ['docker', 'top'], 'safe', [T('container', 'Container', 'xgallery-app')], (v) => `docker top ${p(v.container)}`)
c('Docker', 'Containers', 'Environment of a container', 'Its environment variables', ['docker', 'env'], 'safe', [T('container', 'Container', 'xgallery-app')], (v) => `docker exec ${p(v.container)} env | sort`)
c('Docker', 'Containers', 'Run a new container', 'docker run with ports and restart policy', ['docker', 'run'], 'careful', [T('image', 'Image', 'nginx:alpine'), T('name', 'Name', 'web'), T('ports', 'Ports host:container', '8080:80'), T('env', 'Env KEY=VAL (space separated)', ''), B('detach', 'Run in background', true)], (v) => `docker run ${on(v.detach) ? '-d ' : '-it --rm '}--name ${p(v.name)} --restart unless-stopped${s(v.ports) ? ` -p ${s(v.ports)}` : ''}${s(v.env).split(/\s+/).filter(Boolean).map((e) => ` -e ${q(e)}`).join('')} ${p(v.image)}`)
c('Docker', 'Images', 'List images', 'Local images with sizes', ['docker', 'images'], 'safe', [], () => "docker images --format 'table {{.Repository}}\\t{{.Tag}}\\t{{.Size}}\\t{{.CreatedSince}}'")
c('Docker', 'Images', 'Pull an image', 'Download or update an image', ['docker', 'pull'], 'safe', [T('image', 'Image', 'ghcr.io/mossesx/xgallery:latest')], (v) => `docker pull ${p(v.image)}`)
c('Docker', 'Images', 'Remove an image', 'Delete a local image', ['docker', 'rmi'], 'careful', [T('image', 'Image', '')], (v) => `docker rmi ${p(v.image)}`)
c('Docker', 'Images', 'Build an image', 'docker build from a Dockerfile', ['docker', 'build'], 'careful', [D('dir', 'Context folder', '/opt/xgallery'), T('tag', 'Tag', 'xgallery-app:local')], (v) => `docker build -t ${p(v.tag)} ${p(v.dir)}`)
c('Docker', 'Images', 'Save image to file', 'Export an image as a tarball', ['docker', 'save', 'export'], 'safe', [T('image', 'Image', 'xgallery-app:local'), P('out', 'File', '/root/docker-exports/image.tar.gz')], (v) => `mkdir -p $(dirname ${p(v.out)}) && docker save ${p(v.image)} | gzip > ${p(v.out)} && ls -lh ${p(v.out)}`)
c('Docker', 'Images', 'Load image from file', 'Import a saved image', ['docker', 'load', 'import'], 'safe', [P('path', 'File', '/root/docker-exports/image.tar.gz')], (v) => `docker load -i ${p(v.path)}`)
c('Docker', 'Compose', 'Compose up', 'Start (or update) a compose project', ['compose', 'up', 'deploy'], 'careful', [D('dir', 'Project folder', '/opt/xgallery'), T('file', 'Compose file', 'docker-compose.traefik.yml'), B('build', 'Rebuild images'), B('pull', 'Pull first')], (v) => `cd ${p(v.dir)} && ${on(v.pull) ? `docker compose -f ${p(s(v.file, 'docker-compose.yml'))} pull && ` : ''}docker compose -f ${p(s(v.file, 'docker-compose.yml'))} up -d${on(v.build) ? ' --build' : ''} --remove-orphans`)
c('Docker', 'Compose', 'Compose down', 'Stop and remove the project containers', ['compose', 'down'], 'danger', [D('dir', 'Project folder', '/opt/xgallery'), T('file', 'Compose file', 'docker-compose.traefik.yml'), B('volumes', 'Also delete volumes (data loss!)')], (v) => `cd ${p(v.dir)} && docker compose -f ${p(s(v.file, 'docker-compose.yml'))} down${on(v.volumes) ? ' -v' : ''}`)
c('Docker', 'Compose', 'Compose logs', 'Logs of every service in the project', ['compose', 'logs'], 'safe', [D('dir', 'Project folder', '/opt/xgallery'), T('file', 'Compose file', 'docker-compose.traefik.yml'), N('tail', 'Lines', 100), B('follow', 'Follow')], (v) => `cd ${p(v.dir)} && docker compose -f ${p(s(v.file, 'docker-compose.yml'))} logs --tail ${n(v.tail, 100)}${on(v.follow) ? ' -f' : ''}`)
c('Docker', 'Compose', 'Compose ps / restart', 'Status or restart of a project', ['compose', 'ps', 'restart'], 'careful', [S('action', 'Action', ['ps', 'restart', 'pull', 'config']), D('dir', 'Project folder', '/opt/xgallery'), T('file', 'Compose file', 'docker-compose.traefik.yml')], (v) => `cd ${p(v.dir)} && docker compose -f ${p(s(v.file, 'docker-compose.yml'))} ${s(v.action, 'ps')}`)
c('Docker', 'Volumes', 'List volumes', 'Named volumes', ['docker', 'volume'], 'safe', [], () => 'docker volume ls')
c('Docker', 'Volumes', 'Inspect a volume', 'Where it lives on disk', ['docker', 'volume', 'inspect'], 'safe', [T('volume', 'Volume', 'xgallery_data')], (v) => `docker volume inspect ${p(v.volume)}; sudo du -sh $(docker volume inspect -f '{{.Mountpoint}}' ${p(v.volume)}) 2>/dev/null`)
c('Docker', 'Volumes', 'Back up a volume', 'tar a volume into a file', ['docker', 'volume', 'backup'], 'safe', [T('volume', 'Volume', 'xgallery_data'), P('out', 'Backup file', '/root/backups/xgallery_data.tar.gz')], (v) => `mkdir -p $(dirname ${p(v.out)}) && docker run --rm -v ${p(v.volume)}:/from:ro -v $(dirname ${p(v.out)}):/to alpine tar -czf /to/$(basename ${p(v.out)}) -C /from . && ls -lh ${p(v.out)}`)
c('Docker', 'Volumes', 'Restore a volume', 'Unpack a backup into a volume (overwrites)', ['docker', 'volume', 'restore'], 'danger', [T('volume', 'Volume', 'xgallery_data'), P('path', 'Backup file', '/root/backups/xgallery_data.tar.gz'), B('confirm', 'I understand this overwrites the volume')], (v) => (on(v.confirm) ? `docker run --rm -v ${p(v.volume)}:/to -v $(dirname ${p(v.path)}):/from:ro alpine sh -c 'cd /to && tar -xzf /from/$(basename ${p(v.path)})'` : "echo 'tick the confirmation first'"))
c('Docker', 'Volumes', 'Browse a volume', 'List files inside a volume', ['docker', 'volume', 'ls'], 'safe', [T('volume', 'Volume', 'xgallery_data'), D('dir', 'Path inside', '/')], (v) => `docker run --rm -v ${p(v.volume)}:/v:ro alpine ls -la /v${s(v.dir, '/').replace(/\/$/, '')}`)
c('Docker', 'Networks', 'List networks', 'Docker networks', ['docker', 'network'], 'safe', [], () => 'docker network ls')
c('Docker', 'Networks', 'Who is on a network', 'Containers attached to a network', ['docker', 'network', 'inspect'], 'safe', [T('network', 'Network', 'coolify')], (v) => `docker network inspect ${p(v.network)} --format '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{"\\n"}}{{end}}'`)

/* ======================= Git ======================= */
const REPO = D('dir', 'Repository', '/opt/xgallery')
c('Git', 'Inspect', 'Status', 'Changed files and branch', ['git', 'status'], 'safe', [REPO], (v) => `cd ${p(v.dir)} && git status --short --branch`)
c('Git', 'Inspect', 'Log', 'Recent commits', ['git', 'log'], 'safe', [REPO, N('count', 'Commits', 15), B('graph', 'Graph of branches')], (v) => `cd ${p(v.dir)} && git log --oneline${on(v.graph) ? ' --graph --all --decorate' : ''} -${n(v.count, 15)}`)
c('Git', 'Inspect', 'Diff', 'Uncommitted changes', ['git', 'diff'], 'safe', [REPO, B('staged', 'Staged only'), B('stat', 'Summary only')], (v) => `cd ${p(v.dir)} && git diff${on(v.staged) ? ' --cached' : ''}${on(v.stat) ? ' --stat' : ''}`)
c('Git', 'Inspect', 'Show a commit', 'Message and diff of one commit', ['git', 'show'], 'safe', [REPO, T('ref', 'Commit or ref', 'HEAD')], (v) => `cd ${p(v.dir)} && git show --stat ${p(s(v.ref, 'HEAD'))}`)
c('Git', 'Inspect', 'Blame a file', 'Who changed each line', ['git', 'blame'], 'safe', [REPO, P('path', 'File', 'server/src/app.ts')], (v) => `cd ${p(v.dir)} && git blame -L 1,60 ${p(v.path)}`)
c('Git', 'Inspect', 'Remotes', 'Where the repo pushes and pulls', ['git', 'remote'], 'safe', [REPO], (v) => `cd ${p(v.dir)} && git remote -v && git branch -vv`)
c('Git', 'Sync', 'Pull', 'Fetch and merge the remote branch', ['git', 'pull'], 'careful', [REPO, B('rebase', 'Rebase instead of merge', true)], (v) => `cd ${p(v.dir)} && git pull${on(v.rebase) ? ' --rebase' : ''}`)
c('Git', 'Sync', 'Fetch all', 'Update remote refs without merging', ['git', 'fetch'], 'safe', [REPO], (v) => `cd ${p(v.dir)} && git fetch --all --prune && git status -sb`)
c('Git', 'Sync', 'Push', 'Push the current branch', ['git', 'push'], 'careful', [REPO, B('setUpstream', 'Set upstream (first push)')], (v) => `cd ${p(v.dir)} && git push${on(v.setUpstream) ? ' -u origin HEAD' : ''}`)
c('Git', 'Sync', 'Clone', 'Clone a repository', ['git', 'clone'], 'safe', [T('url', 'Repository URL', 'https://github.com/MossesX/xGallery.git'), D('dir', 'Into', '/opt/xgallery'), N('depth', 'Depth (0 = full)', 0)], (v) => `git clone${n(v.depth, 0) ? ` --depth ${n(v.depth, 0)}` : ''} ${q(v.url)} ${p(v.dir)}`)
c('Git', 'Changes', 'Commit all', 'Stage everything and commit', ['git', 'commit'], 'careful', [REPO, T('message', 'Message', '', 'Fix typo')], (v) => `cd ${p(v.dir)} && git add -A && git commit -m ${q(v.message)}`)
c('Git', 'Changes', 'Stash / unstash', 'Put changes aside or bring them back', ['git', 'stash'], 'careful', [REPO, S('action', 'Action', ['push', 'pop', 'list', 'drop'])], (v) => `cd ${p(v.dir)} && git stash ${s(v.action, 'push')}`)
c('Git', 'Changes', 'Discard local changes', 'Reset the working tree to the last commit', ['git', 'reset', 'checkout'], 'danger', [REPO, B('confirm', 'I want to lose uncommitted changes')], (v) => (on(v.confirm) ? `cd ${p(v.dir)} && git reset --hard && git clean -fd` : "echo 'tick the confirmation first'"))
c('Git', 'Changes', 'Switch branch', 'Checkout an existing or new branch', ['git', 'checkout', 'branch'], 'careful', [REPO, T('branch', 'Branch', 'main'), B('create', 'Create it')], (v) => `cd ${p(v.dir)} && git checkout ${on(v.create) ? '-b ' : ''}${p(v.branch)}`)
c('Git', 'Changes', 'Tag', 'Create and push a tag', ['git', 'tag'], 'careful', [REPO, T('tag', 'Tag', 'v1.0.0'), T('message', 'Message', 'Release')], (v) => `cd ${p(v.dir)} && git tag -a ${p(v.tag)} -m ${q(v.message)} && git push origin ${p(v.tag)}`)
c('Git', 'Config', 'Identity', 'Set name and email for commits', ['git', 'config'], 'safe', [T('name', 'Name', ''), T('email', 'Email', '')], (v) => `git config --global user.name ${q(v.name)} && git config --global user.email ${q(v.email)} && git config --global --list`)
c('Git', 'Config', 'Safe directory', 'Allow git in a folder owned by another user', ['git', 'safe'], 'safe', [REPO], (v) => `git config --global --add safe.directory ${p(v.dir)}`)

/* ======================= Packages ======================= */
c('Packages', 'apt', 'Update package lists', 'Refresh what can be installed', ['apt', 'update'], 'safe', [SUDO], (v) => sudo(v, 'apt-get update'))
c('Packages', 'apt', 'Upgrade everything', 'Install all pending updates', ['apt', 'upgrade'], 'careful', [SUDO], (v) => sudo(v, 'DEBIAN_FRONTEND=noninteractive apt-get upgrade -y && test -f /var/run/reboot-required && echo REBOOT REQUIRED || echo no reboot needed'))
c('Packages', 'apt', 'Install a package', 'apt install', ['apt', 'install'], 'careful', [T('pkg', 'Package(s)', '', 'htop ncdu tree'), SUDO], (v) => sudo(v, `apt-get install -y ${s(v.pkg)}`))
c('Packages', 'apt', 'Remove a package', 'apt remove (purge configs on request)', ['apt', 'remove'], 'danger', [T('pkg', 'Package', ''), B('purge', 'Also remove config files'), SUDO], (v) => sudo(v, `apt-get ${on(v.purge) ? 'purge' : 'remove'} -y ${s(v.pkg)}`))
c('Packages', 'apt', 'Search packages', 'Find a package by name', ['apt', 'search'], 'safe', [T('term', 'Search', '', 'postgres')], (v) => `apt-cache search ${q(v.term)} | head -30`)
c('Packages', 'apt', 'Is it installed?', 'Version of an installed package', ['dpkg', 'installed'], 'safe', [T('pkg', 'Package', 'docker-ce')], (v) => `dpkg -l | grep -i ${q(v.pkg)} || echo 'not installed'`)
c('Packages', 'apt', 'Pending updates', 'What would be upgraded', ['apt', 'list'], 'safe', [], () => 'apt list --upgradable 2>/dev/null')
c('Packages', 'Node', 'Node and npm versions', 'What is installed', ['node', 'npm', 'version'], 'safe', [], () => 'node --version; npm --version; npx --version')
c('Packages', 'Node', 'npm install (project)', 'Install dependencies', ['npm', 'install'], 'careful', [D('dir', 'Project', '/opt/xgallery'), B('ci', 'Clean install from lockfile (npm ci)', true)], (v) => `cd ${p(v.dir)} && npm ${on(v.ci) ? 'ci' : 'install'}`)
c('Packages', 'Node', 'npm install global', 'Install a CLI tool globally', ['npm', 'global'], 'careful', [T('pkg', 'Package', '@anthropic-ai/claude-code'), SUDO], (v) => sudo(v, `npm install -g ${s(v.pkg)}`))
c('Packages', 'Node', 'npm run script', 'Run a package.json script', ['npm', 'run'], 'careful', [D('dir', 'Project', '/opt/xgallery'), T('script', 'Script', 'build')], (v) => `cd ${p(v.dir)} && npm run ${s(v.script, 'build')}`)
c('Packages', 'Node', 'Outdated packages', 'Dependencies with newer versions', ['npm', 'outdated'], 'safe', [D('dir', 'Project', '/opt/xgallery')], (v) => `cd ${p(v.dir)} && npm outdated || true`)
c('Packages', 'Node', 'Audit', 'Known vulnerabilities in dependencies', ['npm', 'audit'], 'safe', [D('dir', 'Project', '/opt/xgallery')], (v) => `cd ${p(v.dir)} && npm audit || true`)
c('Packages', 'Python', 'pip install', 'Install a Python package', ['pip', 'python'], 'careful', [T('pkg', 'Package', 'requests'), B('user', 'For this user only', true)], (v) => `pip3 install ${on(v.user) ? '--user ' : ''}${s(v.pkg)}`)
c('Packages', 'Python', 'Virtual environment', 'Create and activate a venv', ['venv', 'python'], 'safe', [D('dir', 'Folder', '/opt/app')], (v) => `cd ${p(v.dir)} && python3 -m venv .venv && . .venv/bin/activate && python --version`)

/* ======================= Users ======================= */
c('Users', 'Who', 'Who am I', 'User, groups and sudo rights', ['whoami', 'id', 'sudo'], 'safe', [], () => 'id; sudo -n true 2>/dev/null && echo "sudo: yes" || echo "sudo: needs password or not allowed"')
c('Users', 'Who', 'Logged-in users', 'Current sessions and recent logins', ['who', 'last'], 'safe', [], () => 'who; echo; last -n 10')
c('Users', 'Who', 'Failed logins', 'Recent authentication failures', ['auth', 'failed', 'security'], 'safe', [SUDO], (v) => sudo(v, "grep -i 'failed password' /var/log/auth.log 2>/dev/null | tail -20 || journalctl -u ssh --since '24h ago' | grep -i failed | tail -20"))
c('Users', 'Manage', 'Add a user', 'Create a login user with a home folder', ['useradd', 'adduser'], 'careful', [T('user', 'Username', '', 'deploy'), B('sudo', 'Give sudo', false), B('docker', 'Allow docker', false)], (v) => `sudo adduser --disabled-password --gecos '' ${p(v.user)}${on(v.sudo) ? ` && sudo usermod -aG sudo ${p(v.user)}` : ''}${on(v.docker) ? ` && sudo usermod -aG docker ${p(v.user)}` : ''} && id ${p(v.user)}`)
c('Users', 'Manage', 'Set a password', 'Change a user password interactively', ['passwd'], 'careful', [T('user', 'Username', 'root'), SUDO], (v) => sudo(v, `passwd ${p(v.user)}`))
c('Users', 'Manage', 'Add user to group', 'e.g. docker or sudo', ['usermod', 'group'], 'careful', [T('user', 'Username', ''), T('group', 'Group', 'docker'), SUDO], (v) => sudo(v, `usermod -aG ${p(v.group)} ${p(v.user)} && id ${p(v.user)}`))
c('Users', 'Manage', 'Delete a user', 'Remove a user and optionally the home folder', ['deluser', 'userdel'], 'danger', [T('user', 'Username', ''), B('home', 'Also delete home folder'), SUDO], (v) => sudo(v, `deluser ${on(v.home) ? '--remove-home ' : ''}${p(v.user)}`))
c('Users', 'Manage', 'Lock / unlock account', 'Prevent or allow sign-in', ['usermod', 'lock'], 'careful', [T('user', 'Username', ''), S('action', 'Action', [{ v: '-L', l: 'lock' }, { v: '-U', l: 'unlock' }]), SUDO], (v) => sudo(v, `usermod ${s(v.action, '-L')} ${p(v.user)}`))
c('Users', 'SSH keys', 'Generate an SSH key', 'New ed25519 key pair', ['ssh-keygen', 'key'], 'safe', [T('comment', 'Comment', 'server-key'), P('path', 'Key file', '~/.ssh/id_ed25519')], (v) => `ssh-keygen -t ed25519 -N '' -C ${q(v.comment)} -f ${p(v.path)} && cat ${p(v.path)}.pub`)
c('Users', 'SSH keys', 'Authorize a public key', 'Allow a key to log in as this user', ['authorized_keys', 'ssh'], 'careful', [T('key', 'Public key line', '', 'ssh-ed25519 AAAA… comment')], (v) => `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo ${q(v.key)} >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && wc -l ~/.ssh/authorized_keys`)
c('Users', 'SSH keys', 'List authorized keys', 'Keys that may log in', ['authorized_keys'], 'safe', [], () => "cut -d' ' -f1,3 ~/.ssh/authorized_keys 2>/dev/null || echo none")
c('Users', 'SSH keys', 'Test the sshd config', 'Validate before restarting ssh', ['sshd', 'config'], 'safe', [SUDO], (v) => sudo(v, 'sshd -t && echo config ok'))

/* ======================= System ======================= */
c('System', 'Info', 'System summary', 'OS, kernel, uptime, load, memory, disk in one go', ['uname', 'uptime', 'summary'], 'safe', [], () => 'hostnamectl 2>/dev/null | head -8; uptime; echo; free -h | head -2; echo; df -h / | tail -1; echo; nproc; grep -m1 "model name" /proc/cpuinfo')
c('System', 'Info', 'Environment variables', 'Of the current shell', ['env'], 'safe', [T('filter', 'Filter (optional)', '', 'PATH')], (v) => (s(v.filter) ? `env | grep -i ${q(v.filter)}` : 'env | sort'))
c('System', 'Info', 'Date and time zone', 'Clock, zone and NTP state', ['date', 'timezone'], 'safe', [], () => 'date; timedatectl 2>/dev/null')
c('System', 'Info', 'Reboot required?', 'Whether a pending kernel update needs a reboot', ['reboot', 'required'], 'safe', [], () => 'test -f /var/run/reboot-required && (echo YES; cat /var/run/reboot-required.pkgs 2>/dev/null) || echo no')
c('System', 'Info', 'Hardware', 'CPU, memory, disks, PCI', ['lscpu', 'hardware'], 'safe', [], () => 'lscpu | head -20; echo; lsblk; echo; lspci 2>/dev/null | head -20')
c('System', 'Control', 'Set time zone', 'timedatectl', ['timezone'], 'careful', [T('tz', 'Zone', 'America/Chicago', 'Europe/Berlin'), SUDO], (v) => sudo(v, `timedatectl set-timezone ${p(v.tz)} && date`))
c('System', 'Control', 'Set hostname', 'Rename the machine', ['hostname'], 'careful', [T('name', 'Hostname', 'srv1'), SUDO], (v) => sudo(v, `hostnamectl set-hostname ${p(v.name)} && hostname`))
c('System', 'Control', 'Reboot', 'Restart the server now', ['reboot'], 'danger', [N('minutes', 'In minutes (0 = now)', 0), SUDO], (v) => sudo(v, `shutdown -r +${n(v.minutes, 0)} "reboot from the commander"`))
c('System', 'Control', 'Shut down', 'Power off (needs the hosting panel to start again!)', ['shutdown', 'poweroff'], 'danger', [B('confirm', 'I can start it again from Hostinger'), SUDO], (v) => (on(v.confirm) ? sudo(v, 'shutdown -h now') : "echo 'tick the confirmation first'"))
c('System', 'Control', 'Kernel parameter', 'Read or set a sysctl value', ['sysctl'], 'careful', [T('key', 'Key', 'vm.swappiness'), T('value', 'New value (empty = read)', ''), SUDO], (v) => (s(v.value) ? sudo(v, `sysctl -w ${s(v.key)}=${s(v.value)}`) : `sysctl ${s(v.key, 'vm.swappiness')}`))
c('System', 'Cron', 'List cron jobs', 'The crontab of a user', ['cron', 'crontab'], 'safe', [T('user', 'User', 'root'), SUDO], (v) => sudo(v, `crontab -l -u ${p(v.user)} 2>/dev/null || echo 'no crontab'`))
c('System', 'Cron', 'Add a cron job', 'Append a scheduled line', ['cron', 'schedule'], 'careful', [S('when', 'When', [{ v: '0 3 * * *', l: 'daily at 03:00' }, { v: '0 * * * *', l: 'hourly' }, { v: '*/15 * * * *', l: 'every 15 minutes' }, { v: '0 4 * * 0', l: 'weekly Sunday 04:00' }, { v: '@reboot', l: 'at boot' }]), T('cmd', 'Command', '', '/opt/xgallery/deploy/backup.sh'), T('tag', 'Comment tag', 'xg-commander')], (v) => `(crontab -l 2>/dev/null; echo ${q(`${s(v.when, '0 3 * * *')} ${s(v.cmd)} # ${s(v.tag, 'xg-commander')}`)}) | crontab - && crontab -l`)
c('System', 'Cron', 'Remove cron jobs by tag', 'Delete lines carrying a comment tag', ['cron', 'remove'], 'careful', [T('tag', 'Comment tag', 'xg-commander')], (v) => `crontab -l 2>/dev/null | grep -v ${q('# ' + s(v.tag, 'xg-commander'))} | crontab - && crontab -l`)
c('System', 'Cron', 'Cron log', 'Recent cron executions', ['cron', 'log'], 'safe', [], () => "journalctl -u cron -n 50 --no-pager 2>/dev/null || grep CRON /var/log/syslog | tail -50")

/* ======================= xGallery ======================= */
c('xGallery', 'App', 'App logs', 'Recent container logs', ['xgallery', 'logs'], 'safe', [N('tail', 'Lines', 100), B('follow', 'Follow')], (v) => `docker logs --tail ${n(v.tail, 100)}${on(v.follow) ? ' -f' : ''} xgallery-app`)
c('xGallery', 'App', 'Health check', 'Is the site answering', ['xgallery', 'health'], 'safe', [T('domain', 'Domain', 'xgallery.amberxai.com')], (v) => `curl -s -o /dev/null -w 'https: %{http_code} in %{time_total}s\\n' https://${s(v.domain)}/healthz; docker ps --filter name=xgallery-app --format '{{.Status}}'`)
c('xGallery', 'App', 'Redeploy from source', 'Rebuild and restart the stack in /opt/xgallery', ['xgallery', 'deploy', 'compose'], 'careful', [D('dir', 'Deploy folder', '/opt/xgallery'), T('domain', 'Domain', 'xgallery.amberxai.com')], (v) => `cd ${p(v.dir)} && SITE_DOMAIN=${s(v.domain)} docker compose -p xgallery -f docker-compose.traefik.yml up -d --build --remove-orphans && docker compose -p xgallery ps`)
c('xGallery', 'App', 'Restart the app', 'Restart only the app container', ['xgallery', 'restart'], 'careful', [], () => 'docker restart xgallery-app && sleep 3 && docker logs --tail 20 xgallery-app')
c('xGallery', 'App', 'Shell in the app', 'Interactive shell inside the container', ['xgallery', 'shell'], 'careful', [], () => 'docker exec -it xgallery-app sh')
c('xGallery', 'App', 'Database size and tables', 'SQLite file size and row counts', ['xgallery', 'sqlite', 'db'], 'safe', [], () => `docker exec xgallery-app sh -c 'ls -lh /data/*.db 2>/dev/null; node -e "const {DatabaseSync}=require(\\"node:sqlite\\");const d=new DatabaseSync(\\"/data/xgallery.db\\",{readOnly:true});for(const r of d.prepare(\\"select name from sqlite_master where type=\\\\\\"table\\\\\\"\\").all())console.log(r.name.padEnd(24),d.prepare(\\"select count(*) c from \\"+r.name).get().c)"'`)
c('xGallery', 'Data', 'Back up the data volume', 'Database + media into a dated tarball', ['xgallery', 'backup'], 'safe', [D('dir', 'Backup folder', '/root/backups')], (v) => `mkdir -p ${p(v.dir)} && docker run --rm -v xgallery_data:/from:ro -v ${p(v.dir)}:/to alpine tar -czf /to/xgallery-$(date +%Y%m%d-%H%M).tar.gz -C /from . && ls -lh ${p(v.dir)} | tail -5`)
c('xGallery', 'Data', 'Restore the data volume', 'Replace the data with a backup (app stopped meanwhile)', ['xgallery', 'restore'], 'danger', [P('path', 'Backup file', '/root/backups/xgallery-YYYYMMDD-HHMM.tar.gz'), B('confirm', 'I understand this replaces all data')], (v) => (on(v.confirm) ? `docker stop xgallery-app && docker run --rm -v xgallery_data:/to -v $(dirname ${p(v.path)}):/from:ro alpine sh -c 'rm -rf /to/* && tar -xzf /from/$(basename ${p(v.path)}) -C /to' && docker start xgallery-app` : "echo 'tick the confirmation first'"))
c('xGallery', 'Data', 'Media folder size', 'How much the uploaded media takes', ['xgallery', 'media', 'size'], 'safe', [], () => 'docker exec xgallery-app du -sh /data /data/media 2>/dev/null')
c('xGallery', 'Claude', 'Claude Code in the deploy folder', 'Start Claude Code on the VPS', ['claude', 'ai'], 'careful', [D('dir', 'Folder', '/opt/xgallery')], (v) => `cd ${p(v.dir)} && claude`)
c('xGallery', 'Claude', 'Claude Code inside the app container', 'Claude Code with the panel workspace', ['claude', 'ai', 'docker'], 'careful', [], () => `docker exec -it xgallery-app sh -lc 'cd /data/ai-workspace 2>/dev/null || cd /app/source; claude'`)
c('xGallery', 'Claude', 'Claude one-shot question', 'Ask Claude Code without an interactive session', ['claude', 'ai', 'print'], 'careful', [D('dir', 'Folder', '/opt/xgallery'), T('prompt', 'Prompt', '', 'summarise the deploy workflow')], (v) => `cd ${p(v.dir)} && claude -p ${q(v.prompt)}`)
c('xGallery', 'Sites', 'List panel-made sites', 'Compose sites under /opt/sites', ['sites', 'subdomain'], 'safe', [], () => 'for d in /opt/sites/*/; do echo "$d: $(cat $d/.xg-site.json 2>/dev/null)"; done; docker ps --filter name=site- --format "table {{.Names}}\\t{{.Status}}"')
c('xGallery', 'Sites', 'Restart a site', 'compose restart for a subdomain', ['sites', 'restart'], 'careful', [T('sub', 'Subdomain', 'demo')], (v) => `cd /opt/sites/${p(v.sub)} && docker compose -p site-${p(v.sub)} restart`)

/* ======================= FTP-only operations (performed through the API in the FTP tab) ======================= */
c('FTP', 'Transfer', 'Upload files here', 'Pick files on this device and upload them into the current folder', ['upload', 'sftp'], 'careful', [], () => '# upload: handled by the FTP tab', { ftp: 'upload' })
c('FTP', 'Transfer', 'Download selected', 'Download the selected file to this device', ['download', 'sftp'], 'safe', [], () => '# download: handled by the FTP tab', { ftp: 'download' })
c('FTP', 'Browse', 'Refresh listing', 'Reload the current folder', ['list', 'refresh'], 'safe', [], () => '# list: handled by the FTP tab', { ftp: 'list' })
c('FTP', 'Edit', 'Edit selected file', 'Open the selected text file in the editor', ['edit', 'sftp'], 'careful', [], () => '# edit: handled by the FTP tab', { ftp: 'edit' })

export const CATALOG: Command[] = list
export const CATEGORIES = [...new Set(list.map((x) => x.cat))]
export const subsOf = (cat: string) => [...new Set(list.filter((x) => x.cat === cat).map((x) => x.sub))]
export const ALL_TAGS = [...new Set(list.flatMap((x) => x.tags))].sort()

/** Defaults for a command's options. */
export const defaultsOf = (cmd: Command): Vals => Object.fromEntries(cmd.opts.map((o) => [o.key, o.default]))

/** A user-defined snippet: `{key}` placeholders in the template become options. */
export interface CustomSnippet {
  id: string
  name: string
  cat: string
  sub: string
  summary: string
  tags: string[]
  risk: Risk
  template: string
  opts: CmdOption[]
}
export function fromCustom(cs: CustomSnippet): Command {
  const keys = [...new Set([...cs.template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))]
  const opts = keys.map((k) => cs.opts.find((o) => o.key === k) ?? T(k, k, ''))
  return { id: cs.id, name: cs.name, cat: cs.cat || 'Custom', sub: cs.sub || 'Mine', summary: cs.summary, tags: cs.tags, risk: cs.risk, opts, custom: true, build: (v) => cs.template.replace(/\{(\w+)\}/g, (_m, k: string) => String(v[k] ?? '')) }
}
