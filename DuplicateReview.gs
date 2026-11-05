/**
 * DuplicateReview.gs
 * Version 2026-11-03.13
 *
 * Finds files you OWN in My Drive that Drive reports as byte-for-byte identical
 * (same md5Checksum AND same size) and lists each pair with a full path.
 *
 * "Identical" means Google Drive's own md5Checksum plus file size. This script
 * does not download file bodies and hash them again. It cannot see inside
 * Google Docs, Sheets, or Slides, because those have no checksum.
 *
 * SAFETY CONTRACT
 * - There is no permanent-delete call. The only Drive writes are
 *   setTrashed(true) once, and setTrashed(false) for an automatic rollback or
 *   for a restore of a file this script itself logged.
 * - There is no doGet/doPost and no web app. A link cannot trash a file.
 * - The scan does not trash, rename, or move your documents. It reads My Drive
 *   and writes this spreadsheet. It also creates and updates files in a folder
 *   it owns named "Duplicate review index (script data)". That folder is working
 *   data, not a copy of your documents. Do not delete it until Status says
 *   Done or ERROR.
 * - Choosing an Action only opens a dialog, and only after a scan has finished.
 *   Starting another scan turns those actions off and cancels open confirmations.
 *   The dialog button stays disabled until a box is checked. That box stops
 *   misclicks. It is not what stops a different person. The server refuses
 *   unless this spreadsheet is private, you own it, the report is from a
 *   finished scan, and another file you own is still in Drive with the same
 *   size and the same MD5.
 * - Immediately before Trash, both files are read again from Drive. After the
 *   Trash call, the surviving copy is read again. If it is gone, the script
 *   puts the just-trashed file back.
 * - Trash targets a file id, never path text.
 *
 * SETUP (use the Google account that owns the files)
 * 1. Create a new blank Google Sheet. Do not share it. Share → Restricted,
 *    nobody added, link sharing off.
 * 2. Extensions → Apps Script. Delete the sample function. Paste this whole
 *    file, including the module.exports block at the bottom. Save.
 * 3. Project Settings: runtime must be V8 (the default on a new project).
 * 4. Services (+) → Drive API → identifier exactly "Drive" → version v3 → Add.
 *    Not v2. If a run says the Drive API is disabled: Project Settings →
 *    Google Cloud Platform project → APIs & Services → Library → Drive API →
 *    Enable.
 * 5. Reload the spreadsheet. Use Duplicate review → Authorize and check setup.
 *    The first click shows Google's permission screen and may not run the check.
 *    Approve it, then click Authorize and check setup again. The dialog must say
 *    sharing/identity is OK. If it says the sheet is shared, stop and unshare it
 *    (remove every editor, commenter, and viewer; link sharing off).
 *    Google's screen says the script can delete Drive files. That is the wording
 *    of the full Drive permission, which is required to move files you already
 *    own into Trash. This file never calls a permanent-delete method.
 *    Do not rely on the script editor's Run button. getUi() does not work there,
 *    so no dialog can appear. If you do run "authorize" from the editor, read
 *    the Status sheet instead, then reload the spreadsheet so the menu appears.
 * 6. If the menu is missing, reload once more. Use the menu after this. Do not
 *    use the editor Run button for the scan.
 * 7. Duplicate review → Install confirmation buttons.
 * 8. Optional: Duplicate review → Set minimum file size. Files smaller than
 *    that are skipped. Use 0, 100KB, 1MB, 10MB, or a plain byte count.
 *    The next scan uses it. The default is every non-empty file.
 *    The size is fixed when a scan starts. Changing it while a scan is running
 *    does not change that scan.
 * 9. Duplicate review → Scan My Drive for identical files.
 *    There is no file-count cap. A Drive with millions of files is scanned in
 *    short runs that resume themselves about one minute later. The full index
 *    is stored in a Drive folder named "Duplicate review index (script data)",
 *    not in this spreadsheet, so Google's 10-million-cell limit does not stop
 *    the scan. Only duplicate groups are written to the sheet. Do not delete
 *    the index folder until Status says Done or ERROR. You can delete old index
 *    folders after that; they are working files, not your documents.
 *    If Status says some groups were not shown, the sheet filled up. Those
 *    groups are listed in that folder as groups-not-shown.json. Raise the
 *    minimum size and scan again to review a smaller set. Nothing was trashed.
 *    One checksum prefix that still contains more than 100,000 files after it
 *    can no longer be split stops the scan with an error. Raise the minimum
 *    size. That stop does not trash anything.
 *    Personal Gmail gets about 90 minutes per day of automatic resumes;
 *    use "Resume scan now" if a paused scan (not an error) stalls. If Google
 *    says "Exceeded maximum execution time", the run was killed before it
 *    finished. The Duplicates sheet stays empty until Phase says Done. That is
 *    not a result of zero duplicates. Paste this version and start the scan
 *    again. This version saves each page of the listing and arms a resume
 *    before the slow work, so a later timeout can continue.
 *    A Trash confirmation can delay a resume by a minute; that delay does not trash
 *    anything. If Status says ERROR, Resume will not continue it, and the script
 *    will not keep scheduling retries. Read Last error, fix the cause, and
 *    start the scan again. A stopped scan has not trashed anything.
 *    FileIndex holds only files that are part of a duplicate group. FolderIndex
 *    and Carry are scratch sheets. Do not edit or sort them while a scan is
 *    running. Do not delete TrashLog.
 * 10. Click each path. The link opens that file id. Path text is from the scan.
 *    The MD5 column is the checksum. Same MD5 and same size are what "identical"
 *    means here. The same file name is not enough.
 * 11. A sheet cell cannot hold two real buttons. The Action cell is a dropdown.
 *     Choosing "Delete file 1" or "Delete file 2" only opens a dialog that
 *     contains both buttons. You can also select the row and use
 *     Duplicate review → Open confirmation for selected row.
 *     If the dropdown does nothing, the confirmation trigger is not installed
 *     or the scan has not finished. Nothing is trashed until you check the box
 *     and press the dialog button. Delete actions do not work while a scan is
 *     running, and an old dialog stops working once a new scan starts.
 *     After a file is actually in Trash, that row leaves Duplicates and is
 *     appended to the sheet "deleted duplicates", with a Deleted cell naming
 *     the file that was moved. The other file on the row stays in Drive.
 * 12. To undo: TrashLog → Restore this file. This only restores a file this
 *     script trashed, and only if size and MD5 still match the log. You can
 *     also restore from drive.google.com/drive/trash.
 * 13. Do not empty Trash, and do not publish this script as a web app.
 *     Google removes Trash after about 30 days. This script does not.
 *     Leave this spreadsheet Restricted. Do not add people later. An installable
 *     trigger runs as you, so a shared sheet would let someone else's edit reach
 *     the Trash button. The script refuses that case, but do not share it.
 *
 * Also skipped: Shared drives, files you do not own, 0-byte files, files below
 * the minimum size you set, files with no checksum yet, and duplicate groups
 * larger than 500 files (summary row, no Delete action). A copy on a Shared
 * drive, or a copy you do not own, is not a spare. Trash is allowed only when
 * another file you own is still in Drive with the same size and the same MD5.
 * The scan does not stop at a file count. If the duplicate groups themselves
 * cannot fit in this spreadsheet, the scan still finishes and Status says the
 * interactive report was shortened; raise the minimum size and scan again to
 * narrow it. Nothing is trashed by that shortening. If you trash the earliest
 * copy in a group of three or more, the sheet may not show the new pairing,
 * but a later Trash still searches the indexed copies and refuses to trash
 * the last copy.
 */
'use strict';

var SCRIPT_VERSION = '2026-11-03.13';

/** Stop a chunk before Apps Script's 6-minute hard kill. */
var RUN_BUDGET_MS = 5 * 60 * 1000;

/** Set by beginRun() so every phase of one execution shares one clock. */
var RUN_STARTED = 0;

function beginRun() {
  RUN_STARTED = Date.now();
}

function overBudget(reserveMs) {
  if (!RUN_STARTED) return false;
  return Date.now() - RUN_STARTED >= RUN_BUDGET_MS - (reserveMs || 0);
}

/**
 * A duplicate group larger than this gets a summary row and no delete buttons.
 * 500 members become 499 rows, which is the largest set this sheet will offer
 * one-click review for.
 */
var MAX_GROUP = 500;

/** How many other indexed copies to read when the listed partner is already gone. */
var SIBLING_PROBE_LIMIT = 500;

/**
 * Records kept in one Drive shard file. This is not a scan cap.
 * Unique files never occupy spreadsheet rows.
 */
var SHARD_ROWS = 200;

/** Load one checksum prefix into memory only up to this many records, then split it. */
var COLLECT_MAX = 20000;

/**
 * Duplicate-member rows written to FileIndex. 400,000 rows x 9 columns is 3.6 million
 * cells, under the spreadsheet limit. The scan itself does not stop at this number;
 * further duplicate groups are counted and omitted from the interactive sheet.
 */
var INDEX_ROW_BUDGET = 400000;

/** Give up walking a folder chain rather than loop forever. */
var MAX_PATH_DEPTH = 40;

var SHEET_DUPLICATES = 'Duplicates';
var SHEET_DELETED = 'deleted duplicates';
var SHEET_INDEX = 'FileIndex';
var SHEET_FOLDERS = 'FolderIndex';
var SHEET_CARRY = 'Carry';
var SHEET_STATUS = 'Status';
var SHEET_LOG = 'TrashLog';

var FILE_QUERY = "trashed = false and 'me' in owners and not mimeType contains 'application/vnd.google-apps.'";

var INDEX_COLS = 9; // id, name, size, md5, parentIds, createdTime, mime, groupKey, path
var INDEX_ID = 1;
var INDEX_SIZE = 3;
var INDEX_MD5 = 4;
var INDEX_KEY = 8;

var DUP_COLS = 10;
var DUP_ACTION = 3;
var DUP_RESULT = 5;
var DUP_ID1 = 6;
var DUP_ID2 = 7;
var DUP_SIZE = 8;
var DUP_MD5 = 9;
var DUP_PAIR = 10;

var PROTECT_TAG = 'DuplicateReview';

// ---------------------------------------------------------------------------
// Pure helpers (no Apps Script services). Unit-tested.
// ---------------------------------------------------------------------------

function isFileId(value) {
  return /^[a-zA-Z0-9_-]{10,80}$/.test(String(value || ''));
}

function isMd5(value) {
  return /^[a-f0-9]{32}$/.test(String(value || ''));
}

function normSize(value) {
  var text = String(value == null ? '' : value).trim();
  if (!/^\d+$/.test(text)) return '';
  var stripped = text.replace(/^0+/, '');
  return stripped || '0';
}

function groupKeyOf(md5, sizeRaw) {
  if (!isMd5(md5)) return '';
  var size = normSize(sizeRaw);
  if (!size || size === '0') return '';
  return md5 + '|' + size;
}

function formatBytes(sizeRaw) {
  var size = normSize(sizeRaw);
  var n = Number(size);
  if (!size || !isFinite(n)) return String(sizeRaw) + ' bytes';
  var units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  var value = n;
  var unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  var rounded = unit === 0 ? String(Math.round(value)) : (value >= 10 ? value.toFixed(0) : value.toFixed(1));
  return rounded + ' ' + units[unit];
}

/** @return {number|null} bytes, or null when the text is not a size. */
function parseMinSize(text) {
  var raw = String(text == null ? '' : text).trim().toLowerCase().replace(/\s+/g, '');
  if (!raw || raw === '0' || raw === '0b') return 0;
  var match = /^(\d+(?:\.\d+)?)(b|kb|mb|gb|tb)?$/.exec(raw);
  if (!match) return null;
  var n = Number(match[1]);
  if (!isFinite(n) || n < 0) return null;
  var unit = match[2] || 'b';
  var mult = { b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 };
  return Math.floor(n * mult[unit]);
}

function formatMinSize(bytes) {
  var n = Number(bytes || 0);
  if (!n) return '0 (every non-empty file)';
  return formatBytes(String(Math.floor(n))) + ' (' + Math.floor(n) + ' bytes)';
}

/** Decimal size strings are compared without turning a huge integer into a double. */
function sizeAtLeast(sizeRaw, minBytes) {
  var size = normSize(sizeRaw);
  if (!size || size === '0') return false;
  var minText = normSize(minBytes);
  if (!minText || minText === '0') return true;
  if (size.length !== minText.length) return size.length > minText.length;
  return size >= minText;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '\u0026amp;')
    .replace(/</g, '\u0026lt;')
    .replace(/>/g, '\u0026gt;')
    .replace(/"/g, '\u0026quot;')
    .replace(/'/g, '\u0026#39;');
}

/** Escaped text with scan-built newlines kept as line breaks. Not for attributes. */
function htmlBlock(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function sheetText(value) {
  var text = String(value == null ? '' : value);
  // Sheets evaluates a cell as a formula when the value starts with =, +, - or @.
  if (/^[=+\-@]/.test(text)) return '\u200B' + text;
  // A long all-digit name would be rounded if it were stored as a number.
  if (/^0[0-9]+$/.test(text) || /^[0-9]{16,}$/.test(text)) return "'" + text;
  return text;
}

/**
 * Sheets stores a 16-digit (or longer) numeric string as a number and then
 * rounds it. An all-digit MD5 is 32 digits, so it must be forced to text or
 * the checksum is corrupted and that pair disappears from the report.
 * A leading apostrophe is the text marker. Sheets does not display it, and
 * getValues does not return it.
 */
function sheetExact(value) {
  var text = String(value == null ? '' : value);
  if (/^0[0-9]+$/.test(text) || /^[0-9]{16,}$/.test(text)) return "'" + text;
  return text;
}

function unwrapSheetText(value) {
  var text = String(value == null ? '' : value);
  if (text.charAt(0) === '\u200B') return text.slice(1);
  return text;
}

function cleanDisplay(value, maxLen) {
  var text = String(value == null ? '' : value).replace(/[\u0000-\u001F]/g, ' ');
  if (text.length > maxLen) return text.slice(0, maxLen) + '\u2026';
  return text;
}

/** A slash inside a file or folder name must not look like another folder. */
function sanitizePathSegment(value) {
  var text = String(value == null ? '' : value)
    .replace(/[\u0000-\u001F]/g, ' ')
    .replace(/\//g, '\uFF0F')
    .replace(/\\/g, '\uFF3C');
  return text || '[unnamed]';
}

function driveOpenUrl(fileId) {
  if (!isFileId(fileId)) throw new Error('Refused to build a Drive link for an invalid file id.');
  return 'https://drive.google.com/open?id=' + fileId;
}

function splitIds(value) {
  if (!value) return [];
  var parts = String(value).split(',');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var id = parts[i].trim();
    if (isFileId(id)) out.push(id);
  }
  return out;
}

function uniqueIds(ids) {
  var seen = Object.create(null);
  var out = [];
  for (var i = 0; i < ids.length; i++) {
    if (!isFileId(ids[i]) || seen[ids[i]]) continue;
    seen[ids[i]] = true;
    out.push(ids[i]);
  }
  return out;
}

/**
 * Full folder path from a parent id. `folders` is {id: {name, parents: string[]}}.
 * Cycles and missing folders terminate. Names are not rewritten except for
 * slashes and control characters, which would make the path ambiguous.
 */
function buildFolderPath(folderId, folders, rootId, rootName) {
  var names = [];
  var seen = Object.create(null);
  var current = folderId;
  var guard = 0;
  while (current && guard < MAX_PATH_DEPTH) {
    guard++;
    if (current === rootId) {
      names.push(sanitizePathSegment(rootName || 'My Drive'));
      break;
    }
    if (seen[current]) {
      names.push('[cycle]');
      break;
    }
    seen[current] = true;
    var folder = folders[current];
    if (!folder) {
      names.push('[folder not in index]');
      break;
    }
    names.push(sanitizePathSegment(folder.name || '[unnamed folder]'));
    var parents = folder.parents || [];
    if (!parents.length) break;
    current = parents[0];
  }
  if (guard >= MAX_PATH_DEPTH) names.push('[path too deep]');
  names.reverse();
  return names.join('/');
}

function buildFilePaths(parentIds, fileName, folders, rootId, rootName) {
  var safeName = sanitizePathSegment(String(fileName || '(unnamed)').replace(/[\r\n]/g, ' '));
  if (!parentIds || !parentIds.length) {
    return sanitizePathSegment(rootName || 'My Drive') + '/' + safeName;
  }
  var paths = [];
  for (var i = 0; i < parentIds.length; i++) {
    paths.push(buildFolderPath(parentIds[i], folders, rootId, rootName) + '/' + safeName);
  }
  return paths.join('\n');
}

function compareMembers(a, b) {
  var at = a.createdTime || '9999-99-99';
  var bt = b.createdTime || '9999-99-99';
  if (at < bt) return -1;
  if (at > bt) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function dedupeMembers(members) {
  var seen = Object.create(null);
  var out = [];
  for (var i = 0; i < members.length; i++) {
    var member = members[i];
    if (!member || !isFileId(member.id) || seen[member.id]) continue;
    seen[member.id] = true;
    out.push(member);
  }
  return out;
}

function emptyPending() {
  return { key: '', truncated: false, count: 0, sample: null, members: [] };
}

function finishPending(pending) {
  if (!pending || !pending.key) return null;
  if (pending.truncated) {
    if (pending.count < 2) return null;
    return { type: 'summary', count: pending.count, sample: pending.sample, key: pending.key };
  }
  var members = dedupeMembers(pending.members || []);
  if (members.length < 2) return null;
  if (members.length > MAX_GROUP) {
    return { type: 'summary', count: members.length, sample: members[0], key: pending.key };
  }
  members.sort(compareMembers);
  return { type: 'pairs', members: members, key: pending.key };
}

/** Stream already-sorted members. Completed groups are pushed to `completed`. */
function pushMember(pending, member, completed) {
  if (!member || !member.groupKey || !isFileId(member.id)) return pending;
  if (pending.key && member.groupKey !== pending.key) {
    var done = finishPending(pending);
    if (done) completed.push(done);
    pending = emptyPending();
  }
  if (!pending.key) pending.key = member.groupKey;
  if (!pending.sample) pending.sample = member;
  if (pending.truncated) {
    pending.count++;
    return pending;
  }
  for (var i = 0; i < pending.members.length; i++) {
    if (pending.members[i].id === member.id) return pending;
  }
  if (pending.members.length >= MAX_GROUP) {
    pending.truncated = true;
    pending.sample = pending.sample || pending.members[0];
    pending.count = pending.members.length + 1;
    pending.members = [];
    return pending;
  }
  pending.members.push(member);
  pending.count = pending.members.length;
  return pending;
}

function consumeMembers(members) {
  var pending = emptyPending();
  var completed = [];
  for (var i = 0; i < members.length; i++) {
    pending = pushMember(pending, members[i], completed);
  }
  var last = finishPending(pending);
  if (last) completed.push(last);
  return completed;
}

function pairsFromMembers(members) {
  var ordered = dedupeMembers(members).sort(compareMembers);
  var pairs = [];
  if (ordered.length < 2) return pairs;
  var keeper = ordered[0];
  for (var i = 1; i < ordered.length; i++) {
    pairs.push({ file1: keeper, file2: ordered[i] });
  }
  return pairs;
}

function isTransientError(err) {
  var msg = String(err && (err.message || err));
  // Status codes must be whole words. "250000" contains "500" and is not a Drive 500.
  if (/\b(429|500|502|503|504)\b/.test(msg)) return true;
  return /rate limit|too many times|timed out|timeout|backend error|backenderror|internal error|service unavailable|service error|server error occurred/i.test(msg)
    || /\bquota\b/i.test(msg);
}

function buildDialogHtml(model) {
  var nonce1 = model.nonce1 || '';
  var nonce2 = model.nonce2 || '';
  if (nonce1 && !/^[0-9a-f-]{36}$/i.test(nonce1)) throw new Error('Bad token.');
  if (nonce2 && !/^[0-9a-f-]{36}$/i.test(nonce2)) throw new Error('Bad token.');
  var button = function (nonce, label, fileNo) {
    if (!nonce) {
      return '<p class="unavailable">Move file ' + fileNo + ' to Trash is unavailable. ' +
        escapeHtml(fileNo === 1 ? (model.reason1 || '') : (model.reason2 || '')) + '</p>';
    }
    return '<button type="button" class="danger" disabled data-nonce="' + nonce + '" data-file="' + fileNo + '">' +
      escapeHtml(label) + '</button>';
  };
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>',
    'body{font:14px/1.45 Arial,sans-serif;margin:0;padding:20px 22px 16px;color:#1c1917;background:#fafaf9;}',
    'h1{font-size:18px;margin:0 0 8px;}',
    '.warn{background:#fff7ed;border:1px solid #fdba74;padding:10px 12px;margin:0 0 12px;}',
    '.card{background:#fff;border:1px solid #e7e5e4;padding:10px 12px;margin:0 0 10px;}',
    '.label{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#57534e;}',
    '.mono{font-family:monospace;font-size:12px;word-break:break-all;}',
    'a{color:#1d4ed8;}',
    '.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}',
    'button{font:14px Arial,sans-serif;padding:10px 14px;border-radius:8px;cursor:pointer;}',
    '#cancel{background:#1c1917;color:#fff;border:1px solid #1c1917;}',
    '.danger{background:#fff;color:#9f1239;border:1px solid #9f1239;}',
    '.danger:disabled{opacity:.45;cursor:not-allowed;}',
    '#ack{margin-right:8px;}',
    '.unavailable{color:#57534e;}',
    '#msg{min-height:1.2em;margin-top:10px;font-weight:bold;}',
    '</style></head><body>',
    '<h1>Move one copy to Trash?</h1>',
    '<div class="warn">This does <b>not</b> permanently delete the file. It moves one copy to Google Drive Trash. ',
    'Trash is kept for about 30 days unless you empty Trash yourself. ',
    'The button stays off until you check the box. If the other copy is no longer identical and still in Drive, nothing is trashed. ',
    'Checksum <span class="mono">', escapeHtml(model.md5 || ''), '</span> · ',
    escapeHtml(model.sizeHuman || ''), ' (', escapeHtml(model.sizeRaw || ''), ' bytes).</div>',
    '<div class="card"><div class="label">File 1 · comparison copy (earlier created time)</div>',
    '<div><b>', htmlBlock(model.name1), '</b></div>',
    '<div>', htmlBlock(model.path1), '</div>',
    '<div>', escapeHtml(model.created1 || ''), '</div>',
    '<div class="mono">', escapeHtml(model.id1 || ''), '</div>',
    '<div><a href="', escapeHtml(model.url1), '" target="_blank" rel="noopener">Open file 1 in Drive</a></div></div>',
    '<div class="card"><div class="label">File 2</div>',
    '<div><b>', htmlBlock(model.name2), '</b></div>',
    '<div>', htmlBlock(model.path2), '</div>',
    '<div>', escapeHtml(model.created2 || ''), '</div>',
    '<div class="mono">', escapeHtml(model.id2 || ''), '</div>',
    '<div><a href="', escapeHtml(model.url2), '" target="_blank" rel="noopener">Open file 2 in Drive</a></div></div>',
    '<label><input type="checkbox" id="ack"> I opened the link and this is a spare copy. Keep at least one copy in Drive.</label>',
    '<div class="row">',
    '<button type="button" id="cancel" autofocus>Cancel — keep both files</button>',
    button(nonce1, 'Delete file 1 — move it to Trash', 1),
    button(nonce2, 'Delete file 2 — move it to Trash', 2),
    '</div>',
    '<div id="msg"></div>',
    '<div class="row"><button type="button" id="close" hidden>Close</button></div>',
    '<script>',
    'var NONCE_OK = /^[0-9a-f-]{36}$/i;',
    'var goButtons = document.querySelectorAll("button.danger");',
    'var ack = document.getElementById("ack");',
    'var ready = false;',
    'function sync(){',
    '  for (var i = 0; i < goButtons.length; i++) goButtons[i].disabled = !(ready && ack.checked);',
    '}',
    'sync();',
    'setTimeout(function(){ ready = true; sync(); }, 1200);',
    'ack.addEventListener("change", sync);',
    'document.getElementById("cancel").addEventListener("click", function(){ google.script.host.close(); });',
    'document.getElementById("close").addEventListener("click", function(){ google.script.host.close(); });',
    'function bind(button){',
    '  button.addEventListener("click", function(){',
    '    var nonce = button.getAttribute("data-nonce");',
    '    if (!ready || !ack.checked || !NONCE_OK.test(nonce)) return;',
    '    for (var i = 0; i < goButtons.length; i++) goButtons[i].disabled = true;',
    '    ack.disabled = true;',
    '    document.getElementById("cancel").disabled = true;',
    '    document.getElementById("msg").textContent = "Checking the other copy again, then moving this one to Trash…";',
    '    google.script.run.withSuccessHandler(function(message){',
    '      document.getElementById("msg").textContent = message;',
    '      document.getElementById("close").hidden = false;',
    '    }).withFailureHandler(function(err){',
    '      document.getElementById("msg").textContent = (err && err.message) ? err.message : String(err);',
    '      document.getElementById("close").hidden = false;',
    '    }).trashFromDialog(nonce);',
    '  });',
    '}',
    'for (var b = 0; b < goButtons.length; b++) bind(goButtons[b]);',
    '</script></body></html>'
  ].join('');
}

function buildRestoreHtml(model) {
  var nonce = model.nonce || '';
  if (!/^[0-9a-f-]{36}$/i.test(nonce)) throw new Error('Bad token.');
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>',
    'body{font:14px/1.45 Arial,sans-serif;margin:0;padding:20px;color:#1c1917;background:#fafaf9;}',
    'button{font:14px Arial,sans-serif;padding:10px 14px;border-radius:8px;cursor:pointer;margin-right:8px;}',
    '#cancel{background:#1c1917;color:#fff;border:1px solid #1c1917;}',
    '.go{background:#fff;color:#1d4ed8;border:1px solid #1d4ed8;}',
    '.go:disabled{opacity:.45;cursor:not-allowed;}',
    '</style></head><body>',
    '<h1 style="font-size:18px">Restore this file from Trash?</h1>',
    '<p><b>', htmlBlock(model.name), '</b><br>', htmlBlock(model.path), '</p>',
    '<p>This only works for a file this script previously moved to Trash, and only if its size and checksum still match the log. It will not restore anything else.</p>',
    '<p><label><input type="checkbox" id="ack"> Restore this file to My Drive.</label></p>',
    '<p><button type="button" id="cancel" autofocus>Cancel</button>',
    '<button type="button" class="go" id="go" disabled>Restore from Trash</button></p>',
    '<p id="msg" style="font-weight:bold"></p>',
    '<script>',
    'var nonce = "' + nonce + '";',
    'var ready = false; var ack = document.getElementById("ack"); var go = document.getElementById("go");',
    'function sync(){ go.disabled = !(ready && ack.checked); }',
    'setTimeout(function(){ ready = true; sync(); }, 800);',
    'ack.addEventListener("change", sync);',
    'document.getElementById("cancel").addEventListener("click", function(){ google.script.host.close(); });',
    'go.addEventListener("click", function(){',
    '  if (!ready || !ack.checked) return;',
    '  go.disabled = true;',
    '  document.getElementById("msg").textContent = "Restoring…";',
    '  google.script.run.withSuccessHandler(function(message){',
    '    document.getElementById("msg").textContent = message;',
    '  }).withFailureHandler(function(err){',
    '    document.getElementById("msg").textContent = (err && err.message) ? err.message : String(err);',
    '  }).restoreFromDialog(nonce);',
    '});',
    '</script></body></html>'
  ].join('');
}

// ---------------------------------------------------------------------------
// Spreadsheet / Drive IO
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Duplicate review')
    .addItem('Set minimum file size', 'setMinimumSize')
    .addItem('Scan My Drive for identical files', 'startScan')
    .addItem('Resume scan now', 'continueScan')
    .addSeparator()
    .addItem('Install confirmation buttons', 'installActionTrigger')
    .addItem('Open confirmation for selected row', 'openConfirmationForSelection')
    .addSeparator()
    .addItem('Sort duplicates, largest first', 'sortDuplicatesLargestFirst')
    .addItem('Sort duplicates, smallest first', 'sortDuplicatesSmallestFirst')
    .addItem('Authorize and check setup', 'authorize')
    .addSeparator()
    .addItem('How safety works', 'showSafety')
    .addSeparator()
    .addItem('About', 'showAbout')
    .addToUi();
}

function sortDuplicatesLargestFirst() {
  sortDuplicatesBySize(true);
}

function sortDuplicatesSmallestFirst() {
  sortDuplicatesBySize(false);
}

/** Reorders duplicate rows by the hidden byte size. Does not read or change Drive. */
function sortDuplicatesBySize(largestFirst) {
  var ui = SpreadsheetApp.getUi();
  if ((props().getProperty('PHASE') || '') !== 'DONE') {
    ui.alert('Wait until the Status phase says Done. Sorting a half-finished report could mix rows. Nothing was changed.');
    return;
  }
  var sheet = getOrCreateSheet(SHEET_DUPLICATES);
  var last = duplicateRowCount();
  if (last < 3) {
    ui.alert('There are not enough duplicate rows to sort. Nothing was changed.');
    return;
  }
  var count = last - 1;
  var values = sheet.getRange(2, 1, count, DUP_COLS).getValues();
  var rich1 = null;
  var rich2 = null;
  try {
    rich1 = sheet.getRange(2, 1, count, 1).getRichTextValues();
    rich2 = sheet.getRange(2, 2, count, 1).getRichTextValues();
  } catch (ignore) {}
  var order = [];
  for (var i = 0; i < values.length; i++) order.push(i);
  order.sort(function (a, b) {
    var left = Number(normSize(values[a][DUP_SIZE - 1]));
    var right = Number(normSize(values[b][DUP_SIZE - 1]));
    if (!isFinite(left)) left = -1;
    if (!isFinite(right)) right = -1;
    if (left !== right) return largestFirst ? right - left : left - right;
    return a - b;
  });
  var sorted = [];
  var out1 = [];
  var out2 = [];
  for (var j = 0; j < order.length; j++) {
    sorted.push(values[order[j]]);
    if (rich1) out1.push(rich1[order[j]]);
    if (rich2) out2.push(rich2[order[j]]);
  }
  clearOurProtections(sheet);
  try {
    var filter = sheet.getFilter();
    if (filter) filter.remove();
  } catch (ignore) {}
  var range = sheet.getRange(2, 1, count, DUP_COLS);
  range.setNumberFormat('@');
  range.setValues(sorted);
  if (out1.length) sheet.getRange(2, 1, count, 1).setRichTextValues(out1);
  if (out2.length) sheet.getRange(2, 2, count, 1).setRichTextValues(out2);
  protectRange(sheet.getRange(2, DUP_ID1, count, 3));
  protectRange(sheet.getRange(2, DUP_PAIR, count, 1));
  try {
    if (sheet.getMaxColumns() >= DUP_PAIR) {
      sheet.hideColumns(DUP_ID1, 3);
      sheet.hideColumns(DUP_PAIR, 1);
    }
  } catch (ignore) {}
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Delete file 1', 'Delete file 2'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, DUP_ACTION, count, 1).setDataValidation(rule);
  try { sheet.getRange(1, 1, count + 1, DUP_MD5).createFilter(); } catch (ignore) {}
  toast(largestFirst
    ? 'Sorted by size. The largest files are first. Nothing was deleted.'
    : 'Sorted by size. The smallest files are first. Nothing was deleted.');
}

function showAbout() {
  var html = HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
      'body{font:14px/1.45 Arial,sans-serif;margin:0;padding:22px 22px 18px;color:#1c1917;background:#fafaf9;text-align:center;}' +
      'img{width:240px;height:auto;border-radius:12px;display:block;margin:0 auto 14px;}' +
      'h1{font-size:18px;margin:0 0 4px;}' +
      'p{margin:0 0 8px;color:#57534e;}' +
      'a{color:#1d4ed8;}' +
      '</style></head><body>' +
      '<img alt="Fotios Basagiannis" src="data:image/jpeg;base64,' + ABOUT_PHOTO + '">' +
      '<h1>Fotios Basagiannis</h1>' +
      '<p>Developer</p>' +
      '<p><a href="https://fotios.org" target="_blank" rel="noopener">fotios.org</a></p>' +
      '</body></html>'
  ).setWidth(380).setHeight(480);
  SpreadsheetApp.getUi().showModalDialog(html, 'About');
}

var ABOUT_PHOTO = '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';

function showSafety() {
  SpreadsheetApp.getUi().alert(
    'How this stays safe',
    'The scan only reads Drive. It does not change files.\n\n' +
      'Delete file 1 / Delete file 2 open a confirmation dialog. The file is not touched until you check the box and press the button in that dialog.\n\n' +
      'The button moves YOUR copy to Trash. It does not permanently delete. Emptying Trash, or Google removing Trash after about 30 days, is permanent. This script never does that.\n\n' +
      'The script refuses if this spreadsheet is shared, or if it cannot prove another file you own is still in Drive with the same size and the same MD5 checksum. A Shared drive copy does not count.\n\n' +
      'Delete actions do not work while a scan is running.\n\n' +
      'Identical means Drive reports the same checksum and size. The script does not download the files.\n\n' +
      'Google Docs, Sheets, and Slides are skipped. They have no binary checksum.\n' +
      'Shared drives are not scanned. Empty (0-byte) files are skipped.\n' +
      'Files smaller than the minimum size you set are skipped. There is no maximum file count.\n\n' +
      'Version ' + SCRIPT_VERSION,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function authorize() {
  var lines = [];
  try {
    assertDriveV3();
    lines.push('Drive API v3: OK.');
  } catch (err) {
    lines.push('Drive API v3: FAILED. ' + explainDriveError(err));
  }
  var problem = '';
  try {
    problem = accessProblems();
  } catch (err) {
    problem = err.message || String(err);
  }
  if (problem) lines.push('Sharing / identity: FAILED. ' + problem + ' Nothing was changed.');
  else lines.push('Sharing / identity: OK. This sheet is private and Trash is allowed for your account. A blank "active user" email is normal for some Gmail accounts and is not by itself a failure.');
  lines.push('Version ' + SCRIPT_VERSION + '. No Drive file was trashed by this check.');
  try { writeStatusField('Setup check', lines.join(' | ')); } catch (ignore) {}
  // The script editor's Run button cannot open a dialog. The Status sheet still
  // receives the same text. The menu path can show it.
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (ignore) {}
  if (!ui) {
    try { Logger.log(lines.join('\n')); } catch (ignore2) {}
    return;
  }
  ui.alert('Setup check', lines.join('\n\n'), ui.ButtonSet.OK);
}

function setMinimumSize() {
  var ui = SpreadsheetApp.getUi();
  var current = props().getProperty('MIN_BYTES') || '0';
  var answer = ui.prompt(
    'Minimum file size',
    'Only files this size or larger are compared. Smaller files are skipped and are not treated as copies.\n\n' +
      'Examples: 0, 100KB, 1MB, 10MB, 500000\n' +
      'Current: ' + formatMinSize(current) + '\n\n' +
      'This applies the next time you start a scan. It does not change Drive.',
    ui.ButtonSet.OK_CANCEL
  );
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  var parsed = parseMinSize(answer.getResponseText());
  if (parsed === null) {
    ui.alert('Could not understand that size. Use 0, 100KB, 1MB, or a byte count. Nothing was changed.');
    return;
  }
  props().setProperty('MIN_BYTES', String(parsed));
  try { writeStatusField('Minimum size for the next scan', formatMinSize(parsed)); } catch (ignore) {}
  var phase = props().getProperty('PHASE') || '';
  var running = phase && phase !== 'IDLE' && phase !== 'DONE' && phase !== 'ERROR';
  ui.alert(
    'Minimum size set to ' + formatMinSize(parsed) + '. The next scan will use it. Nothing in Drive was changed.' +
      (running ? ' The scan that is already running keeps the size it started with.' : '')
  );
}

function currentMinBytes() {
  var parsed = parseMinSize(props().getProperty('MIN_BYTES') || '0');
  return parsed === null ? 0 : parsed;
}

/** The size captured when this scan started. Later menu changes do not affect it. */
function scanMinBytes() {
  var raw = props().getProperty('SCAN_MIN_BYTES');
  if (raw === null || raw === '') return currentMinBytes();
  var parsed = parseMinSize(raw);
  return parsed === null ? 0 : parsed;
}

function installActionTrigger() {
  var problem = accessProblems();
  if (problem) {
    SpreadsheetApp.getUi().alert('Not installed', problem + '\n\nNothing was changed.', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  var spreadsheet = SpreadsheetApp.getActive();
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'handleEdit') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('handleEdit').forSpreadsheet(spreadsheet).onEdit().create();
  SpreadsheetApp.getUi().alert(
    'Confirmation buttons installed',
    'Choosing Delete file 1 or Delete file 2 opens a dialog.\n\n' +
      'Nothing is moved to Trash until you check the box and press the button in that dialog.\n\n' +
      'If the dropdown does nothing, select the row and use Duplicate review → Open confirmation for selected row.\n\n' +
      'Run Authorize and check setup once. It must say sharing / identity is OK.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * Blank active-user email is common for consumer Gmail inside a trigger.
 * A shared spreadsheet is refused either way, because an installable trigger
 * runs as the person who installed it and would otherwise trash files when
 * someone else edited the sheet.
 * @return {string} empty when Trash is allowed
 */
function accessProblems() {
  var fileId = ss().getId();
  if (!isFileId(fileId)) return 'This script must be bound to the spreadsheet (Extensions → Apps Script from that sheet).';
  var meta;
  try {
    meta = withRetry(function () {
      return Drive.Files.get(fileId, { fields: 'id,ownedByMe,trashed,owners(emailAddress)' });
    });
  } catch (err) {
    if (isTransientError(err)) throw err;
    return 'Could not read this spreadsheet in Drive. ' + err.message;
  }
  if (!meta || meta.ownedByMe !== true || meta.trashed === true) {
    return 'You do not own this spreadsheet, or it is in Trash.';
  }
  var effective = '';
  try { effective = Session.getEffectiveUser().getEmail() || ''; } catch (ignore) {}
  try {
    var driveFile = DriveApp.getFileById(fileId);
    var access = driveFile.getSharingAccess();
    var accessText = String(access || '');
    var isPrivate = access === DriveApp.Access.PRIVATE || accessText === 'PRIVATE' || accessText === 'Access.PRIVATE';
    if (!isPrivate) return 'Link or domain sharing is on. Set the sheet to Restricted / Private.';
    if (foreignPeople(driveFile, effective) > 0) {
      return 'Other people can open this spreadsheet. Remove every editor, commenter, and viewer.';
    }
  } catch (err) {
    if (isTransientError(err)) throw err;
    return 'Could not read sharing settings. ' + err.message;
  }
  var token;
  var extras = [];
  try {
    do {
      var permOptions = {
        pageSize: 100,
        fields: 'nextPageToken,permissions(id,type,role,emailAddress,deleted)',
        supportsAllDrives: false
      };
      if (token) permOptions.pageToken = token;
      var page = withRetry(function () {
        return Drive.Permissions.list(fileId, permOptions);
      });
      var perms = (page && page.permissions) || [];
      for (var i = 0; i < perms.length; i++) {
        var perm = perms[i];
        if (perm.deleted === true) continue;
        if (String(perm.type) === 'user' && String(perm.role) === 'owner') continue;
        extras.push(String(perm.type || 'unknown') + '/' + String(perm.role || 'unknown'));
      }
      token = page && page.nextPageToken;
    } while (token);
  } catch (err) {
    if (isTransientError(err)) throw err;
    return 'Could not list permissions. ' + err.message;
  }
  if (extras.length) return 'Sharing permissions are still present: ' + extras.slice(0, 6).join(', ') + '.';
  var active = '';
  try { active = Session.getActiveUser().getEmail() || ''; } catch (ignore) {}
  if (!effective) return 'The account running the script is blank. Nothing was changed.';
  if (active && active.toLowerCase() !== effective.toLowerCase()) {
    return 'The person at the keyboard (' + active + ') is not the account running the script (' + effective + ').';
  }
  var ownerEmail = meta.owners && meta.owners[0] ? String(meta.owners[0].emailAddress || '') : '';
  if (ownerEmail && ownerEmail.toLowerCase() !== effective.toLowerCase()) {
    return 'The script is running as ' + effective + ' but the spreadsheet owner is ' + ownerEmail + '.';
  }
  return '';
}

/**
 * DriveApp sometimes lists the owner among editors. Only someone else counts.
 * A blank email is ignored here; Permissions.list is the backstop.
 */
function foreignPeople(driveFile, effectiveEmail) {
  var buckets = [driveFile.getEditors() || [], driveFile.getViewers() || []];
  if (typeof driveFile.getCommenters === 'function') buckets.push(driveFile.getCommenters() || []);
  var foreign = 0;
  var self = String(effectiveEmail || '').toLowerCase();
  for (var b = 0; b < buckets.length; b++) {
    for (var i = 0; i < buckets[b].length; i++) {
      var email = '';
      try { email = buckets[b][i].getEmail ? buckets[b][i].getEmail() : ''; } catch (ignore) {}
      if (!email) continue;
      if (self && email.toLowerCase() === self) continue;
      foreign++;
    }
  }
  return foreign;
}

function assertCallerIsCurrentUser() {
  var problem = accessProblems();
  if (problem) {
    throw new Error('Refused. ' + problem + ' Nothing was changed.');
  }
}

function props() {
  return PropertiesService.getDocumentProperties();
}

function ss() {
  var active = SpreadsheetApp.getActive();
  if (active) return active;
  var id = '';
  try { id = PropertiesService.getDocumentProperties().getProperty('SPREADSHEET_ID') || ''; } catch (ignore) {}
  if (id && isFileId(id)) return SpreadsheetApp.openById(id);
  throw new Error('Open the spreadsheet this script is bound to and run the menu from there.');
}

function getOrCreateSheet(name) {
  var spreadsheet = ss();
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  return sheet;
}

function ensureGrid(sheet, startRow, numRows, numCols) {
  var endRow = startRow + numRows - 1;
  var maxRows = sheet.getMaxRows();
  var deficit = endRow - maxRows;
  while (deficit > 0) {
    var batch = Math.min(5000, deficit);
    sheet.insertRowsAfter(sheet.getMaxRows(), batch);
    deficit -= batch;
  }
  if (numCols && sheet.getMaxColumns() < numCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), numCols - sheet.getMaxColumns());
  }
}

function resetSheet(name, headers) {
  var sheet = getOrCreateSheet(name);
  clearOurProtections(sheet);
  var existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();
  sheet.clear();
  ensureGrid(sheet, 1, 1, headers.length);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

function clearOurProtections(sheet) {
  var rangeProtections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  for (var i = 0; i < rangeProtections.length; i++) {
    var description = rangeProtections[i].getDescription() || '';
    if (description.indexOf(PROTECT_TAG) === 0) rangeProtections[i].remove();
  }
}

function protectRange(range) {
  try {
    var protection = range.protect().setDescription(PROTECT_TAG + ' hidden ids');
    protection.setWarningOnly(false);
    var editors = protection.getEditors() || [];
    var effective = '';
    try { effective = Session.getEffectiveUser().getEmail() || ''; } catch (ignore) {}
    var removable = [];
    for (var i = 0; i < editors.length; i++) {
      var email = '';
      try { email = editors[i].getEmail ? editors[i].getEmail() : ''; } catch (ignore) {}
      if (!effective || !email || email.toLowerCase() !== effective.toLowerCase()) removable.push(editors[i]);
    }
    if (removable.length) protection.removeEditors(removable);
    if (protection.canDomainEdit()) protection.setDomainEdit(false);
  } catch (err) {
    writeStatusField('Last error', 'Could not protect id columns: ' + err.message);
  }
}

function writeStatusField(label, value) {
  var sheet = getOrCreateSheet(SHEET_STATUS);
  var height = Math.max(sheet.getLastRow(), 1);
  var labels = sheet.getRange(1, 1, height, 1).getValues();
  var row = 0;
  for (var i = 0; i < labels.length; i++) {
    if (labels[i][0] === label) { row = i + 1; break; }
  }
  if (!row) row = Math.max(sheet.getLastRow(), 0) + 1;
  ensureGrid(sheet, row, 1, 2);
  sheet.getRange(row, 1, 1, 2).setValues([[sheetText(label), sheetText(value)]]);
}

function explainDriveError(err) {
  var msg = String(err && (err.message || err));
  if (msg.indexOf('Response Code: 200. Message:') !== -1) {
    return 'Drive returned an index file, but Apps Script reported that success as an error. Use Resume scan now. Do not start a new scan. Nothing was deleted.';
  }
  if (/accessNotConfigured|Drive API has not been used|disabled/i.test(msg)) {
    return 'The Drive API is not enabled on this script\'s Google Cloud project. Apps Script → Project Settings → Google Cloud Platform project → APIs & Services → Library → Drive API → Enable. Details: ' + clipStatus(msg);
  }
  if (/not defined|Advanced service|Drive API/i.test(msg)) {
    return 'Enable Drive API v3: Apps Script → Services (+) → Drive API → version v3 → identifier Drive → Add. Details: ' + clipStatus(msg);
  }
  if (/items/.test(msg) || /maxResults/.test(msg)) {
    return 'The Drive advanced service looks like v2. Remove it and add Drive API version v3. Details: ' + clipStatus(msg);
  }
  return clipStatus(msg);
}

function clipStatus(text) {
  var s = String(text || '');
  if (s.length > 500) return s.substring(0, 500) + '…';
  return s;
}

function assertDriveV3() {
  if (typeof Drive === 'undefined' || !Drive.Files || !Drive.Files.list) {
    throw new Error('Drive is not defined. Add the Drive advanced service as API v3.');
  }
  var probe = Drive.Files.list({ pageSize: 1, fields: 'files(id),nextPageToken', supportsAllDrives: true });
  if (probe && Object.prototype.hasOwnProperty.call(probe, 'items')) {
    throw new Error('Drive advanced service is v2. Remove the service and add Drive API version v3.');
  }
}

function withRetry(fn) {
  var wait = 2000;
  var last;
  for (var attempt = 0; attempt < 4; attempt++) {
    try {
      return fn();
    } catch (err) {
      last = err;
      if (!isTransientError(err) || attempt === 3) throw err;
      // Sleeping here can run past the 6-minute kill. Let the scan resume instead.
      if (overBudget(wait + 5000)) throw err;
      Utilities.sleep(wait);
      wait *= 2;
    }
  }
  throw last;
}

function listPage(query, token, fields) {
  // corpora defaults to the user's My Drive. Shared drives are not included
  // unless includeItemsFromAllDrives is true, and this request does not set it.
  var options = {
    q: query,
    pageSize: 1000,
    fields: fields,
    supportsAllDrives: true
  };
  if (token) options.pageToken = token;
  return withRetry(function () { return Drive.Files.list(options); });
}

function clearContinuationTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'continueScan') ScriptApp.deleteTrigger(triggers[i]);
  }
}

function scheduleContinuation() {
  clearContinuationTriggers();
  ScriptApp.newTrigger('continueScan').timeBased().after(60 * 1000).create();
}

function toast(message) {
  try { ss().toast(message, 'Duplicate review', 8); } catch (ignore) {}
}

function startScan() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert(
    'Scan My Drive for identical files?',
    'This READS files you own in My Drive and writes a report in this spreadsheet.\n\n' +
      'It does not delete, trash, rename, or move any of your files. It creates a working folder named "Duplicate review index (script data)" to hold the index, because a spreadsheet cannot store millions of file rows.\n\n' +
      'Minimum size: ' + formatMinSize(currentMinBytes()) + '. Change it from the menu before scanning if you want to ignore smaller files.\n\n' +
      'Skipped: Google Docs/Sheets/Slides and other Google-native files, Shared drives, files you do not own, 0-byte files, and files below the minimum size.\n\n' +
      'Identical means the same Drive MD5 checksum and the same size. Files are not downloaded.\n\n' +
      'There is no file-count cap. A large Drive pauses and resumes. The Duplicates sheet stays empty until Status says Done. That means the scan is not finished, not that there are no duplicates.\n\n' +
      'Personal Gmail accounts only get about 90 minutes per day of automatic resumes; use Resume scan now if it pauses. If Google says Exceeded maximum execution time, start this version of the scan again.\n\n' +
      'The Duplicates sheet will be replaced when the scan finishes. The Trash log is kept.\n\n' +
      'The spreadsheet must stay private. Continue?',
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return;

  try {
    assertDriveV3();
  } catch (err) {
    ui.alert(explainDriveError(err));
    return;
  }
  var sharing = accessProblems();
  if (sharing) {
    ui.alert('Scan not started', sharing + '\n\nNothing was changed.', ui.ButtonSet.OK);
    return;
  }

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    ui.alert('A scan or Trash action is already running. Nothing was changed.');
    return;
  }
  try {
    var root = DriveApp.getRootFolder();
    var store = props();
    clearContinuationTriggers();
    invalidatePlans();
    store.setProperty('PHASE', 'LIST_FILES');
    store.deleteProperty('PAGE_TOKEN');
    store.setProperty('FOLDERS', '0');
    store.setProperty('FILES', '0');
    store.setProperty('EMPTY_SKIPPED', '0');
    store.setProperty('SMALL_SKIPPED', '0');
    store.setProperty('SCAN_MIN_BYTES', String(currentMinBytes()));
    store.setProperty('FILE_NEXT_ROW', '2');
    store.setProperty('FOLDER_NEXT_ROW', '2');
    store.setProperty('ROOT_ID', root.getId());
    store.setProperty('ROOT_NAME', root.getName() || 'My Drive');
    store.setProperty('DATA_FOLDER_ID', createDataFolder(root.getId()));
    store.deleteProperty('SHARD_SEQ_FILE');
    store.deleteProperty('SUMMARIES_FILE');
    store.deleteProperty('COLLECT_QUEUE');
    store.deleteProperty('COLLECT_QUEUE_FILE');
    store.deleteProperty('COLLECT_DONE_FILE');
    store.deleteProperty('COLLECT_OPEN');
    store.deleteProperty('COLLECT_OPEN_DONE');
    store.deleteProperty('SUMMARIES_APPENDED');
    store.setProperty('PAGE_COUNT', '0');
    store.setProperty('SPLIT_CURSOR', '0');
    store.setProperty('COLLECT_POS', '0');
    store.deleteProperty('CARRY_FILE');
    store.setProperty('INDEX_ROWS', '0');
    store.deleteProperty('INDEX_TRUNCATED');
    store.deleteProperty('BUILD_SORTED');
    store.deleteProperty('BUILD_CURSOR');
    store.deleteProperty('REPORT_RESET');
    store.deleteProperty('FORMAT_CURSOR');
    store.deleteProperty('DUP_ROWS');
    store.deleteProperty('DUP_GROUPS');
    store.setProperty('LAST_ERROR', '');
    store.setProperty('SCRIPT_VERSION', SCRIPT_VERSION);
    store.setProperty('SPREADSHEET_ID', ss().getId());
    store.deleteProperty('CARRY_KEY');
    store.deleteProperty('CARRY_COUNT');
    store.deleteProperty('CARRY_TRUNCATED');
    store.deleteProperty('CARRY_SAMPLE');
    store.setProperty('PATH_CURSOR', '2');

    resetSheet(SHEET_FOLDERS, ['id', 'name', 'parentIds']);
    resetSheet(SHEET_INDEX, ['id', 'name', 'size', 'md5', 'parentIds', 'createdTime', 'mime', 'groupKey', 'path']);
    resetSheet(SHEET_CARRY, ['id', 'name', 'size', 'md5', 'parentIds', 'createdTime', 'path', 'groupKey']);
    resetSheet(SHEET_STATUS, ['Field', 'Value']);
    ensureLogHeader();
    writeStatusField('Version', SCRIPT_VERSION);
    writeStatusField('Phase', 'Listing files you own');
    writeStatusField('Last error', '');
    writeStatusField('Safety', 'Scan does not modify your files. It stores its own index in a Drive folder. Delete actions are off until this scan finishes.');
    writeStatusField('Minimum size', formatMinSize(currentMinBytes()));
    writeStatusField('Duplicate report', 'Not created yet. An empty Duplicates sheet means the scan is still listing, not that there are no duplicates.');
    disableStaleActions();
  } finally {
    lock.releaseLock();
  }
  continueScan();
}

function continueScan() {
  var store = props();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    var pendingPhase = store.getProperty('PHASE') || '';
    if (pendingPhase && pendingPhase !== 'IDLE' && pendingPhase !== 'DONE' && pendingPhase !== 'ERROR') {
      try { scheduleContinuation(); } catch (ignore) {}
    }
    toast('A scan or Trash action is already running. If a scan was in progress, it will retry shortly.');
    return;
  }
  beginRun();
  try {
    var phase = store.getProperty('PHASE') || 'IDLE';
    if (phase === 'IDLE') {
      toast('Nothing to resume. Start a scan from the menu.');
      return;
    }
    if (phase === 'DONE') {
      toast('Scan already finished. See the Duplicates sheet.');
      clearContinuationTriggers();
      return;
    }
    if (phase === 'LIST_FOLDERS') {
      store.setProperty('PHASE', 'ERROR');
      writeStatusField('Phase', 'ERROR');
      writeStatusField('Last error', 'This saved scan used an older script. Start the scan again. Nothing was deleted.');
      try { clearContinuationTriggers(); } catch (ignore) {}
      toast('Start the scan again. Nothing was deleted.');
      return;
    }
    if (phase === 'ERROR') {
      var again = recoverablePhase();
      if (!again) {
        try { clearContinuationTriggers(); } catch (ignore) {}
        toast('Scan stopped with an error. See the Status sheet. Nothing was deleted.');
        return;
      }
      store.setProperty('PHASE', again);
      store.setProperty('LAST_ERROR', '');
      writeStatusField('Phase', again === 'SPLIT' || again === 'FLUSH_TAIL' ? 'Sorting checksums' : 'Listing files you own');
      writeStatusField('Last error', '');
      writeStatusField('Duplicate report', 'Resuming the saved index. The previous stop was temporary. Nothing was deleted.');
      phase = again;
    }
    writeStatusField('Version', SCRIPT_VERSION);
    var sharing = accessProblems();
    if (sharing) {
      var stopped = 'Scan stopped because this spreadsheet is not private to you. ' + sharing + ' Nothing was deleted.';
      store.setProperty('PHASE', 'ERROR');
      store.setProperty('LAST_ERROR', stopped);
      writeStatusField('Phase', 'ERROR');
      writeStatusField('Last error', stopped);
      clearContinuationTriggers();
      toast('Scan stopped. Nothing was deleted.');
      return;
    }
    assertDriveV3();
    if (phase === 'LIST_FILES' || phase === 'SPLIT' || phase === 'FLUSH_TAIL' || phase === 'COLLECT' || phase === 'BUILD_PATHS' || phase === 'BUILD_REPORT' || phase === 'DEDUPE' || phase === 'FORMAT') {
      try { scheduleContinuation(); } catch (ignoreArm) {}
    }
    while (!overBudget(20000)) {
      if (phase === 'LIST_FILES') phase = listFilesStep();
      else if (phase === 'SPLIT') phase = splitStep();
      else if (phase === 'FLUSH_TAIL') phase = flushTailStep();
      else if (phase === 'COLLECT') phase = collectStep();
      else if (phase === 'BUILD_PATHS') phase = buildPathsStep();
      else if (phase === 'BUILD_REPORT') phase = buildReportStep();
      else if (phase === 'DEDUPE') phase = dedupeStep();
      else if (phase === 'FORMAT') phase = formatStep();
      else {
        store.setProperty('PHASE', 'ERROR');
        writeStatusField('Phase', 'ERROR');
        writeStatusField('Last error', 'Unknown scan phase "' + phase + '". Start the scan again. Nothing was deleted.');
        try { clearContinuationTriggers(); } catch (ignore) {}
        toast('Unknown scan phase. Start again. Nothing was deleted.');
        return;
      }
      store.setProperty('PHASE', phase);
      if (phase === 'DONE' || phase === 'ERROR') break;
    }
    if (phase === 'DONE') {
      clearContinuationTriggers();
      writeStatusField('Phase', 'Done');
      toast('Scan finished. Open the path links before using any Delete action. Nothing was trashed.');
      try { ss().setActiveSheet(getOrCreateSheet(SHEET_DUPLICATES)); } catch (ignore) {}
    } else if (phase !== 'ERROR') {
      store.setProperty('PHASE', phase);
      try {
        scheduleContinuation();
        toast('Paused so the time limit cannot kill the scan mid-write. It will resume automatically, or use Resume scan now.');
      } catch (err) {
        writeStatusField('Last error', 'Could not schedule automatic resume: ' + err.message + ' Use the menu Resume scan now.');
        toast('Paused. Automatic resume could not be scheduled. Use Resume scan now.');
      }
    }
  } catch (err) {
    var message = explainDriveError(err);
    store.setProperty('LAST_ERROR', message);
    writeStatusField('Last error', message);
    if (isTransientError(err)) {
      try { scheduleContinuation(); } catch (ignore) {}
      toast('Temporary Drive error. Will retry. Nothing was deleted.');
    } else {
      store.setProperty('PHASE', 'ERROR');
      writeStatusField('Phase', 'ERROR');
      try { clearContinuationTriggers(); } catch (ignore) {}
      toast('Scan stopped: ' + message);
    }
  } finally {
    lock.releaseLock();
  }
}

function appendBlock(sheet, rows, nextRowKey) {
  if (!rows.length) return;
  var store = props();
  var start = Number(store.getProperty(nextRowKey) || String(sheet.getLastRow() + 1));
  if (start < 2) start = 2;
  ensureGrid(sheet, start, rows.length, rows[0].length);
  var range = sheet.getRange(start, 1, rows.length, rows[0].length);
  range.setNumberFormat('@');
  range.setValues(rows);
  store.setProperty(nextRowKey, String(start + rows.length));
}

function padNum(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function fileQuery() {
  var q = FILE_QUERY;
  var folder = props().getProperty('DATA_FOLDER_ID') || '';
  if (isFileId(folder)) q += " and not '" + folder + "' in parents";
  return q;
}

function driveCreate(metadata, blob) {
  return withRetry(function () {
    if (blob) return Drive.Files.create(metadata, blob, { fields: 'id', supportsAllDrives: true });
    return Drive.Files.create(metadata);
  });
}

function createDataFolder(rootId) {
  var created = driveCreate({
    name: 'Duplicate review index (script data)',
    mimeType: 'application/vnd.google-apps.folder',
    parents: [rootId]
  }, null);
  if (!created || !isFileId(created.id)) throw new Error('Could not create the scan index folder in Drive. Nothing was deleted.');
  return created.id;
}

function writeJsonFile(name, value) {
  var folder = props().getProperty('DATA_FOLDER_ID') || '';
  if (!isFileId(folder)) throw new Error('Scan index folder is missing. Start the scan again. Nothing was deleted.');
  var blob = Utilities.newBlob(JSON.stringify(value), 'application/json', name);
  var created = driveCreate({
    name: name,
    parents: [folder],
    mimeType: 'application/json'
  }, blob);
  if (!created || !isFileId(created.id)) throw new Error('Could not store scan data in Drive. Nothing was deleted.');
  return created.id;
}

function readJsonFile(fileId) {
  var text = readFileText(fileId);
  if (!text) return null;
  return JSON.parse(text);
}

function readFileText(fileId) {
  if (!isFileId(fileId)) throw new Error('Scan data file id is not valid. Nothing was deleted.');
  // Drive.Files.get alt=media throws "Response Code: 200" when the body is a
  // JSON array. DriveApp reads the bytes of a normal file without that bug.
  var blob = DriveApp.getFileById(fileId).getBlob();
  if (blob && typeof blob.getDataAsString === 'function') return blob.getDataAsString();
  return String(blob || '');
}

function recoverablePhase() {
  var store = props();
  var last = String(store.getProperty('LAST_ERROR') || '');
  var falseStop = last.indexOf('Response Code: 200') !== -1
    || last.indexOf('false stop') !== -1
    || last.indexOf('reported that success as an error') !== -1
    || /service error|server error occurred|timed out|timeout|backend error|internal error|service unavailable|rate limit/i.test(last)
    || /\bquota\b/i.test(last);
  if (!falseStop) return '';
  if (!isFileId(store.getProperty('DATA_FOLDER_ID'))) return '';
  if (store.getProperty('PAGE_TOKEN')) return 'LIST_FILES';
  var pages = Number(store.getProperty('PAGE_COUNT') || '0');
  if (!pages) return '';
  var cursor = Number(store.getProperty('SPLIT_CURSOR') || '0');
  if (cursor < pages) return 'SPLIT';
  return 'FLUSH_TAIL';
}

function readShardSeq() {
  var id = props().getProperty('SHARD_SEQ_FILE') || '';
  if (!isFileId(id)) return {};
  try {
    var parsed = readJsonFile(id);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (ignore) {
    return {};
  }
}

function writeShardSeq(map) {
  var blob = Utilities.newBlob(JSON.stringify(map), 'application/json', 'shard-seq.json');
  var id = props().getProperty('SHARD_SEQ_FILE') || '';
  if (isFileId(id)) {
    withRetry(function () {
      return Drive.Files.update({ name: 'shard-seq.json' }, id, blob, { fields: 'id' });
    });
    return id;
  }
  id = writeJsonFile('shard-seq.json', map);
  props().setProperty('SHARD_SEQ_FILE', id);
  return id;
}

function writeShard(seq, prefix, records) {
  var n = Number(seq[prefix] || 0) + 1;
  seq[prefix] = n;
  var name = 's-' + prefix + '-' + padNum(n, 4) + '-n' + records.length + '.json';
  writeJsonFile(name, records);
}

function parseShardName(name) {
  var match = /^s-([0-9a-f]+)-(\d+)-n(\d+)\.json$/.exec(String(name || ''));
  if (!match) return null;
  return { prefix: match[1], seq: Number(match[2]), count: Number(match[3]) };
}

function listDataFiles(namePrefix) {
  var folder = props().getProperty('DATA_FOLDER_ID') || '';
  if (!isFileId(folder)) return [];
  var q = "'" + folder + "' in parents and trashed = false and name contains '" + namePrefix + "'";
  var out = [];
  var token = '';
  do {
    var page = listPage(q, token, 'nextPageToken, files(id,name,trashed)');
    var files = (page && page.files) || [];
    for (var i = 0; i < files.length; i++) {
      var fileName = String(files[i] && files[i].name || '');
      if (fileName.indexOf(namePrefix) === 0) out.push(files[i]);
    }
    token = page && page.nextPageToken || '';
  } while (token);
  return out;
}

function loadCollectQueue() {
  var fileId = props().getProperty('COLLECT_QUEUE_FILE') || '';
  if (isFileId(fileId)) {
    try {
      var parsed = readJsonFile(fileId);
      if (parsed && parsed.length) return parsed;
    } catch (ignore) {}
  }
  var raw = props().getProperty('COLLECT_QUEUE') || '';
  if (!raw) return [];
  return raw.split(',');
}

function saveCollectQueue(queue, pos) {
  var store = props();
  var joined = queue.join(',');
  if (joined.length > 8000) {
    var id = writeJsonFile('collect-queue.json', queue);
    store.setProperty('COLLECT_QUEUE_FILE', id);
    store.setProperty('COLLECT_QUEUE', '');
  } else {
    store.deleteProperty('COLLECT_QUEUE_FILE');
    store.setProperty('COLLECT_QUEUE', joined);
  }
  store.setProperty('COLLECT_POS', String(pos));
}

function indexRowFromMember(member) {
  var parents = member.parentIds || member.parents || [];
  return [
    sheetExact(member.id),
    sheetText(String(member.name || '(unnamed)')),
    sheetExact(normSize(member.size)),
    sheetExact(String(member.md5 || '').toLowerCase()),
    sheetExact(parents.join(',')),
    String(member.createdTime || member.created || ''),
    String(member.mime || ''),
    member.groupKey || groupKeyOf(member.md5, member.size),
    ''
  ];
}

function emptySummaryMap() {
  return { prefixes: {}, counts: {}, items: {} };
}

function loadSummaryMap() {
  var id = props().getProperty('SUMMARIES_FILE') || '';
  if (!isFileId(id)) return emptySummaryMap();
  var parsed = readJsonFile(id);
  if (!parsed) return emptySummaryMap();
  if (parsed.length) return { prefixes: { imported: parsed }, counts: {}, items: {} };
  parsed.prefixes = parsed.prefixes || {};
  parsed.counts = parsed.counts || {};
  parsed.items = parsed.items || {};
  return parsed;
}

function saveSummaryMap(map) {
  var blob = Utilities.newBlob(JSON.stringify(map), 'application/json', 'summaries.json');
  var id = props().getProperty('SUMMARIES_FILE') || '';
  if (isFileId(id)) {
    withRetry(function () {
      return Drive.Files.update({ name: 'summaries.json' }, id, blob, { fields: 'id' });
    });
    return;
  }
  id = writeJsonFile('summaries.json', map);
  props().setProperty('SUMMARIES_FILE', id);
}

function loadDoneMap() {
  var id = props().getProperty('COLLECT_DONE_FILE') || '';
  if (!isFileId(id)) return {};
  return readJsonFile(id) || {};
}

function saveDoneMap(map) {
  var blob = Utilities.newBlob(JSON.stringify(map), 'application/json', 'collect-done.json');
  var id = props().getProperty('COLLECT_DONE_FILE') || '';
  if (isFileId(id)) {
    withRetry(function () {
      return Drive.Files.update({ name: 'collect-done.json' }, id, blob, { fields: 'id' });
    });
    return;
  }
  id = writeJsonFile('collect-done.json', map);
  props().setProperty('COLLECT_DONE_FILE', id);
}

function rollbackIndexTo(row) {
  var sheet = getOrCreateSheet(SHEET_INDEX);
  var start = Number(row || 2);
  if (start < 2) start = 2;
  var last = sheet.getLastRow();
  if (last >= start) sheet.getRange(start, 1, last - start + 1, INDEX_COLS).clearContent();
  props().setProperty('FILE_NEXT_ROW', String(start));
}

function parsePageName(name) {
  var match = /^p-(\d+)\.json$/.exec(String(name || ''));
  if (!match) return 0;
  return Number(match[1]);
}

function loadCarry() {
  var id = props().getProperty('CARRY_FILE') || '';
  if (!isFileId(id)) return {};
  var parsed = readJsonFile(id);
  if (!parsed || typeof parsed !== 'object' || parsed.length) return {};
  return parsed;
}

function saveCarry(buckets) {
  var kept = {};
  var keys = Object.keys(buckets);
  for (var i = 0; i < keys.length; i++) {
    if (buckets[keys[i]] && buckets[keys[i]].length) kept[keys[i]] = buckets[keys[i]];
  }
  var blob = Utilities.newBlob(JSON.stringify(kept), 'application/json', 'carry.json');
  var id = props().getProperty('CARRY_FILE') || '';
  if (isFileId(id)) {
    withRetry(function () {
      return Drive.Files.update({ name: 'carry.json' }, id, blob, { fields: 'id' });
    });
    return;
  }
  if (!Object.keys(kept).length) return;
  id = writeJsonFile('carry.json', kept);
  props().setProperty('CARRY_FILE', id);
}

function listFilesStep() {
  var store = props();
  var token = store.getProperty('PAGE_TOKEN') || '';
  var minB = scanMinBytes();
  var count = Number(store.getProperty('FILES') || '0');
  var emptySkipped = Number(store.getProperty('EMPTY_SKIPPED') || '0');
  var smallSkipped = Number(store.getProperty('SMALL_SKIPPED') || '0');
  var finished = false;
  var pagesThisRun = 0;

  while (!overBudget(25000) && pagesThisRun < 10) {
    var result;
    try {
      result = listPage(
        fileQuery(),
        token,
        'nextPageToken, files(id,name,mimeType,size,md5Checksum,parents,ownedByMe,createdTime)'
      );
    } catch (err) {
      if (token && /pageToken|Invalid/i.test(String(err.message || err))) {
        store.setProperty('PHASE', 'ERROR');
        throw new Error('File listing page token expired. Start the scan again. Nothing was deleted. ' + err.message);
      }
      throw err;
    }
    var files = result.files || [];
    var records = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file || file.ownedByMe !== true) continue;
      if (!isFileId(file.id)) continue;
      var mime = String(file.mimeType || '');
      if (mime.indexOf('application/vnd.google-apps.') === 0) continue;
      var md5 = String(file.md5Checksum || '').toLowerCase();
      var size = normSize(file.size);
      var key = groupKeyOf(md5, size);
      if (!key) {
        if (size === '0') emptySkipped++;
        continue;
      }
      if (!sizeAtLeast(size, minB)) {
        smallSkipped++;
        continue;
      }
      records.push({
        id: file.id,
        name: String(file.name || '(unnamed)'),
        size: size,
        md5: md5,
        parents: uniqueIds(file.parents || []),
        created: String(file.createdTime || ''),
        mime: mime
      });
      count++;
    }
    var next = result.nextPageToken || '';
    if (records.length) {
      var pageNum = Number(store.getProperty('PAGE_COUNT') || '0') + 1;
      writeJsonFile('p-' + padNum(pageNum, 5) + '.json', records);
      store.setProperty('PAGE_COUNT', String(pageNum));
    }
    if (next) store.setProperty('PAGE_TOKEN', next);
    else {
      store.deleteProperty('PAGE_TOKEN');
      finished = true;
    }
    token = next;
    store.setProperty('FILES', String(count));
    store.setProperty('EMPTY_SKIPPED', String(emptySkipped));
    store.setProperty('SMALL_SKIPPED', String(smallSkipped));
    writeStatusField('Phase', finished ? 'Sorting checksums' : 'Listing files you own');
    writeStatusField('Binary files indexed', count);
    writeStatusField('Empty files skipped', emptySkipped);
    writeStatusField('Below minimum skipped', smallSkipped);
    writeStatusField('Minimum size', formatMinSize(minB));
    writeStatusField('Duplicate report', finished
      ? 'Listing finished. Duplicates are still being grouped.'
      : 'Not created yet. An empty Duplicates sheet means the scan is still listing, not that there are no duplicates.');
    pagesThisRun++;
    if (finished) break;
  }

  if (!finished) return 'LIST_FILES';
  store.setProperty('SPLIT_CURSOR', '0');
  return 'SPLIT';
}

function splitStep() {
  var store = props();
  var buckets = loadCarry();
  var seq = readShardSeq();
  var listed = listDataFiles('p-');
  var pages = [];
  for (var i = 0; i < listed.length; i++) {
    var num = parsePageName(listed[i].name);
    if (num) pages.push({ num: num, id: listed[i].id });
  }
  pages.sort(function (a, b) { return a.num - b.num; });
  var cursor = Number(store.getProperty('SPLIT_CURSOR') || '0');
  var writes = 0;
  var seen = 0;
  function flushFull(prefix) {
    var rows = buckets[prefix];
    if (!rows || rows.length < SHARD_ROWS) return;
    writeShard(seq, prefix, rows.splice(0, SHARD_ROWS));
    if (!buckets[prefix].length) delete buckets[prefix];
    writes++;
  }
  for (var p = 0; p < pages.length; p++) {
    if (pages[p].num <= cursor) continue;
    if (overBudget(25000) || seen >= 8 || writes >= 20) break;
    var batch = readJsonFile(pages[p].id) || [];
    for (var k = 0; k < batch.length; k++) {
      var rec = batch[k];
      if (!rec || !rec.md5) continue;
      var prefix = String(rec.md5).substring(0, 2);
      if (!buckets[prefix]) buckets[prefix] = [];
      buckets[prefix].push(rec);
      if (buckets[prefix].length >= SHARD_ROWS) flushFull(prefix);
    }
    cursor = pages[p].num;
    seen++;
  }
  saveCarry(buckets);
  writeShardSeq(seq);
  store.setProperty('SPLIT_CURSOR', String(cursor));
  var remaining = 0;
  for (var r = 0; r < pages.length; r++) if (pages[r].num > cursor) remaining++;
  writeStatusField('Phase', 'Sorting checksums');
  writeStatusField('Listing pages sorted', cursor + (remaining ? ' (' + remaining + ' pages left)' : ''));
  if (remaining) return 'SPLIT';
  return 'FLUSH_TAIL';
}

function flushTailStep() {
  var store = props();
  var buckets = loadCarry();
  var seq = readShardSeq();
  var keys = Object.keys(buckets);
  var writes = 0;
  var index = 0;
  while (index < keys.length && writes < 15 && !overBudget(20000)) {
    var prefix = keys[index];
    var rows = buckets[prefix] || [];
    if (!rows.length) {
      delete buckets[prefix];
      index++;
      continue;
    }
    var chunk = rows.splice(0, SHARD_ROWS);
    writeShard(seq, prefix, chunk);
    writes++;
    if (!rows.length) delete buckets[prefix];
  }
  saveCarry(buckets);
  writeShardSeq(seq);
  var left = 0;
  var leftKeys = Object.keys(buckets);
  for (var i = 0; i < leftKeys.length; i++) {
    if (buckets[leftKeys[i]] && buckets[leftKeys[i]].length) left += buckets[leftKeys[i]].length;
  }
  writeStatusField('Phase', left ? 'Sorting checksums' : 'Comparing checksums');
  writeStatusField('Checksum files still to sort', left);
  if (left) return 'FLUSH_TAIL';
  var queue = Object.keys(seq).sort();
  saveCollectQueue(queue, 0);
  store.setProperty('INDEX_ROWS', '0');
  store.setProperty('COLLECT_POS', '0');
  return 'COLLECT';
}

function splitPrefix(prefix, metas) {
  var seq = readShardSeq();
  var buckets = Object.create(null);
  var children = Object.create(null);
  function flushChar(ch) {
    var rows = buckets[ch];
    if (!rows || !rows.length) return;
    var child = prefix + ch;
    writeShard(seq, child, rows);
    children[child] = true;
    buckets[ch] = [];
  }
  for (var i = 0; i < metas.length; i++) {
    var batch = readJsonFile(metas[i].id) || [];
    for (var k = 0; k < batch.length; k++) {
      var rec = batch[k];
      if (!rec || !rec.md5) continue;
      var ch = String(rec.md5).charAt(prefix.length) || '0';
      if (!buckets[ch]) buckets[ch] = [];
      buckets[ch].push(rec);
      if (buckets[ch].length >= SHARD_ROWS) flushChar(ch);
    }
  }
  var chars = Object.keys(buckets);
  for (var c = 0; c < chars.length; c++) flushChar(chars[c]);
  writeShardSeq(seq);
  var queue = loadCollectQueue();
  var pos = Number(props().getProperty('COLLECT_POS') || '0');
  var childKeys = Object.keys(children).sort();
  var next = queue.slice(0, pos).concat(childKeys).concat(queue.slice(pos + 1));
  saveCollectQueue(next, pos);
}

function prefixCanSplit(metas, prefix) {
  var found = '';
  for (var i = 0; i < metas.length; i++) {
    var batch = readJsonFile(metas[i].id) || [];
    for (var k = 0; k < batch.length; k++) {
      var md5 = String(batch[k] && batch[k].md5 || '');
      if (!md5) continue;
      var ch = md5.charAt(prefix.length) || '0';
      if (!found) found = ch;
      else if (ch !== found) return true;
    }
  }
  return false;
}

function wrapRecord(rec) {
  var md5 = String(rec.md5 || '').toLowerCase();
  var size = normSize(rec.size);
  var key = groupKeyOf(md5, size);
  if (!key) return null;
  return {
    id: rec.id,
    name: rec.name,
    size: size,
    md5: md5,
    parentIds: rec.parents || [],
    createdTime: rec.created || '',
    mime: rec.mime || '',
    path: '',
    groupKey: key
  };
}

/**
 * Files that all share the same following checksum digit cannot be split into
 * smaller prefix files. Group them by the full checksum instead of failing the scan.
 */
function buildLargeGroups(metas) {
  var seen = Object.create(null);
  var groups = Object.create(null);
  var seenCount = 0;
  for (var j = 0; j < metas.length; j++) {
    var batch = readJsonFile(metas[j].id) || [];
    for (var k = 0; k < batch.length; k++) {
      var rec = batch[k];
      if (!rec || !isFileId(rec.id) || seen[rec.id]) continue;
      seenCount++;
      if (seenCount > 100000) {
        throw new Error('One checksum prefix has more than 100000 files and cannot be split. Set a higher minimum file size and start the scan again. Nothing was deleted.');
      }
      seen[rec.id] = true;
      var member = wrapRecord(rec);
      if (!member) continue;
      var bucket = groups[member.groupKey];
      if (!bucket) {
        bucket = { count: 0, members: [] };
        groups[member.groupKey] = bucket;
      }
      bucket.count++;
      if (bucket.members.length <= MAX_GROUP) bucket.members.push(member);
    }
  }
  var wrapped = [];
  var summaries = [];
  var keys = Object.keys(groups);
  for (var i = 0; i < keys.length; i++) {
    var bucket = groups[keys[i]];
    if (bucket.count > MAX_GROUP) {
      summaries.push({ type: 'summary', count: bucket.count, key: keys[i], sample: bucket.members[0] || null });
    } else if (bucket.count >= 2) {
      for (var m = 0; m < bucket.members.length; m++) wrapped.push(bucket.members[m]);
    }
  }
  wrapped.sort(function (a, b) {
    if (a.groupKey < b.groupKey) return -1;
    if (a.groupKey > b.groupKey) return 1;
    return 0;
  });
  return { wrapped: wrapped, summaries: summaries };
}

function collectPrefix(prefix) {
  var store = props();
  var done = loadDoneMap();
  if (done[prefix] || (store.getProperty('COLLECT_OPEN') === prefix && store.getProperty('COLLECT_OPEN_DONE') === '1')) {
    if (!done[prefix]) {
      done[prefix] = 1;
      saveDoneMap(done);
    }
    return 'ok';
  }
  var files = listDataFiles('s-' + prefix + '-');
  var metas = [];
  var total = 0;
  for (var i = 0; i < files.length; i++) {
    var parsed = parseShardName(files[i].name);
    if (!parsed || parsed.prefix !== prefix) continue;
    total += parsed.count;
    metas.push(files[i]);
  }
  if (!metas.length) {
    done[prefix] = 1;
    saveDoneMap(done);
    return 'empty';
  }
  if (total > COLLECT_MAX && prefix.length < 6 && prefixCanSplit(metas, prefix)) {
    splitPrefix(prefix, metas);
    return 'split';
  }
  var large = total > COLLECT_MAX;
  if (store.getProperty('COLLECT_OPEN') === prefix && store.getProperty('COLLECT_OPEN_DONE') !== '1') {
    rollbackIndexTo(store.getProperty('COLLECT_OPEN_ROW') || '2');
    store.setProperty('INDEX_ROWS', store.getProperty('COLLECT_OPEN_USED') || '0');
  }
  store.setProperty('COLLECT_OPEN', prefix);
  store.setProperty('COLLECT_OPEN_DONE', '0');
  store.setProperty('COLLECT_OPEN_ROW', store.getProperty('FILE_NEXT_ROW') || '2');
  store.setProperty('COLLECT_OPEN_USED', store.getProperty('INDEX_ROWS') || '0');
  var extraSummaries = [];
  var wrapped = [];
  if (large) {
    var built = buildLargeGroups(metas);
    wrapped = built.wrapped;
    extraSummaries = built.summaries;
  } else {
    var seen = Object.create(null);
    for (var j = 0; j < metas.length; j++) {
      var batch = readJsonFile(metas[j].id) || [];
      for (var k = 0; k < batch.length; k++) {
        var rec = batch[k];
        if (!rec || !isFileId(rec.id) || seen[rec.id]) continue;
        var member = wrapRecord(rec);
        if (!member) continue;
        seen[rec.id] = true;
        wrapped.push(member);
      }
    }
    wrapped.sort(function (a, b) {
      if (a.groupKey < b.groupKey) return -1;
      if (a.groupKey > b.groupKey) return 1;
      return 0;
    });
  }
  var finished = consumeMembers(wrapped).concat(extraSummaries);
  var indexRows = [];
  var map = loadSummaryMap();
  var mine = [];
  var omitted = [];
  var used = Number(store.getProperty('INDEX_ROWS') || '0');
  for (var d = 0; d < finished.length; d++) {
    var group = finished[d];
    if (group.type === 'summary') {
      mine.push({ count: group.count, key: group.key, sample: group.sample || null });
      if (group.sample && used < INDEX_ROW_BUDGET) {
        indexRows.push(indexRowFromMember(group.sample));
        used++;
      }
      continue;
    }
    var members = group.members || [];
    if (used + members.length > INDEX_ROW_BUDGET) {
      var first = members[0] || {};
      omitted.push({ prefix: prefix, key: group.key, count: members.length, sampleId: first.id || '' });
      continue;
    }
    for (var r = 0; r < members.length; r++) indexRows.push(indexRowFromMember(members[r]));
    used += members.length;
  }
  if (indexRows.length) appendBlock(getOrCreateSheet(SHEET_INDEX), indexRows, 'FILE_NEXT_ROW');
  store.setProperty('INDEX_ROWS', String(used));
  map.prefixes[prefix] = mine;
  map.counts[prefix] = omitted.length;
  map.items[prefix] = omitted.slice(0, 20);
  saveSummaryMap(map);
  var omittedTotal = 0;
  var countKeys = Object.keys(map.counts);
  for (var c = 0; c < countKeys.length; c++) omittedTotal += Number(map.counts[countKeys[c]] || 0);
  writeStatusField('Duplicate files kept for review', used);
  writeStatusField('Groups not shown', omittedTotal);
  if (omittedTotal > 0) {
    store.setProperty('INDEX_TRUNCATED', '1');
    writeStatusField('Interactive report', 'Shortened. ' + omittedTotal + ' duplicate groups did not fit in the spreadsheet. See groups-not-shown.json in the index folder. Nothing was deleted.');
  }
  store.setProperty('COLLECT_OPEN_DONE', '1');
  done[prefix] = 1;
  saveDoneMap(done);
  return 'ok';
}

function collectStep() {
  var store = props();
  var queue = loadCollectQueue();
  var pos = Number(store.getProperty('COLLECT_POS') || '0');
  if (!queue.length || pos >= queue.length) {
    store.setProperty('PATH_CURSOR', '2');
    store.deleteProperty('BUILD_SORTED');
    writeStatusField('Phase', 'Building full paths');
    return 'BUILD_PATHS';
  }
  var processed = 0;
  while (pos < queue.length && !overBudget(20000) && processed < 40) {
    var outcome = collectPrefix(queue[pos]);
    if (outcome === 'split') {
      queue = loadCollectQueue();
      pos = Number(store.getProperty('COLLECT_POS') || '0');
      processed++;
      continue;
    }
    pos++;
    store.setProperty('COLLECT_POS', String(pos));
    processed++;
    writeStatusField('Phase', 'Comparing checksums');
    writeStatusField('Checksum groups checked', pos + ' / ' + queue.length);
  }
  if (pos >= queue.length) {
    store.setProperty('PATH_CURSOR', '2');
    store.deleteProperty('BUILD_SORTED');
    writeStatusField('Phase', 'Building full paths');
    return 'BUILD_PATHS';
  }
  return 'COLLECT';
}

function appendStoredSummaries() {
  var store = props();
  if (store.getProperty('SUMMARIES_APPENDED') === '1') return;
  var id = store.getProperty('SUMMARIES_FILE') || '';
  if (!isFileId(id)) return;
  var map = emptySummaryMap();
  try { map = readJsonFile(id) || map; } catch (ignore) { return; }
  if (map.length) map = { prefixes: { imported: map }, counts: {}, items: {} };
  var prefixes = map.prefixes || {};
  var items = [];
  var prefixKeys = Object.keys(prefixes);
  for (var p = 0; p < prefixKeys.length; p++) {
    var batch = prefixes[prefixKeys[p]] || [];
    for (var n = 0; n < batch.length; n++) items.push(batch[n]);
  }
  var omittedTotal = 0;
  var counts = map.counts || {};
  var countKeys = Object.keys(counts);
  for (var c = 0; c < countKeys.length; c++) omittedTotal += Number(counts[countKeys[c]] || 0);
  if (!items.length && !omittedTotal) return;
  var pathById = Object.create(null);
  var sheet = getOrCreateSheet(SHEET_INDEX);
  var last = sheet.getLastRow();
  if (last >= 2) {
    for (var row = 2; row <= last; row += 2000) {
      var count = Math.min(2000, last - row + 1);
      var values = sheet.getRange(row, 1, count, INDEX_COLS).getValues();
      for (var i = 0; i < values.length; i++) pathById[String(values[i][0])] = unwrapSheetText(values[i][8]);
    }
  }
  var rows = [];
  for (var j = 0; j < items.length; j++) {
    var sample = items[j].sample || {};
    if (sample.id && pathById[sample.id]) sample.path = pathById[sample.id];
    rows.push(reportRowForSummary({ count: items[j].count, key: items[j].key, sample: sample }));
  }
  if (omittedTotal > 0) {
    var listed = [];
    var itemMap = map.items || {};
    var itemKeys = Object.keys(itemMap);
    for (var k = 0; k < itemKeys.length; k++) {
      var part = itemMap[itemKeys[k]] || [];
      for (var q = 0; q < part.length; q++) listed.push(part[q]);
    }
    try { writeJsonFile('groups-not-shown.json', { total: omittedTotal, listed: listed }); } catch (ignore) {}
    rows.push([
      sheetText(omittedTotal + ' duplicate groups did not fit in this spreadsheet. Nothing was deleted.'),
      'See groups-not-shown.json in the Duplicate review index folder.',
      '',
      '',
      'Raise the minimum file size and scan again to review a smaller set. These groups were not given Delete actions.',
      '',
      '',
      '',
      '',
      'summary|overflow'
    ]);
    writeStatusField('Groups not shown', omittedTotal);
  }
  appendReportRows(rows);
  store.setProperty('DUP_GROUPS', String(Number(store.getProperty('DUP_GROUPS') || '0') + items.length));
  store.setProperty('SUMMARIES_APPENDED', '1');
}

function loadFolderMap() {
  var sheet = getOrCreateSheet(SHEET_FOLDERS);
  var last = sheet.getLastRow();
  var map = Object.create(null);
  for (var row = 2; row <= last; row += 4000) {
    var count = Math.min(4000, last - row + 1);
    var values = sheet.getRange(row, 1, count, 3).getValues();
    for (var i = 0; i < values.length; i++) {
      var id = String(values[i][0] || '');
      if (!isFileId(id)) continue;
      map[id] = { name: unwrapSheetText(values[i][1]), parents: splitIds(values[i][2]) };
    }
  }
  return map;
}

function flushFolderBuffer(buffer) {
  if (!buffer.length) return;
  var rows = buffer.splice(0, buffer.length);
  appendBlock(getOrCreateSheet(SHEET_FOLDERS), rows, 'FOLDER_NEXT_ROW');
  var store = props();
  store.setProperty('FOLDERS', String(Number(store.getProperty('FOLDERS') || '0') + rows.length));
}

function absorbFolderChain(folderId, cache, rootId, buffer) {
  var current = folderId;
  var guard = 0;
  while (current && current !== rootId && guard < MAX_PATH_DEPTH) {
    guard++;
    if (cache[current]) {
      var known = cache[current].parents || [];
      current = known.length ? known[0] : '';
      continue;
    }
    var fetched = null;
    var failed = false;
    try {
      fetched = withRetry(function () {
        return Drive.Files.get(current, { supportsAllDrives: true, fields: 'id,name,parents,trashed' });
      });
    } catch (err) {
      if (isTransientError(err)) throw err;
      failed = true;
    }
    if (failed || !fetched || !isFileId(fetched.id)) {
      cache[current] = { name: '[folder not accessible]', parents: [] };
      if (buffer) buffer.push([sheetExact(current), sheetText('[folder not accessible]'), '']);
      break;
    }
    var parents = uniqueIds(fetched.parents || []);
    var name = fetched.trashed ? ('[in Trash] ' + (fetched.name || '[unnamed folder]')) : (fetched.name || '[unnamed folder]');
    cache[fetched.id] = { name: name, parents: parents };
    if (buffer) buffer.push([sheetExact(fetched.id), sheetText(name), sheetExact(parents.join(','))]);
    current = parents.length ? parents[0] : '';
    if (buffer && buffer.length >= 200) flushFolderBuffer(buffer);
  }
}

function buildPathsStep() {
  var store = props();
  var sheet = getOrCreateSheet(SHEET_INDEX);
  var last = sheet.getLastRow();
  var cursor = Number(store.getProperty('PATH_CURSOR') || '2');
  if (last < 2 || cursor > last) {
    store.setProperty('BUILD_CURSOR', '2');
    store.deleteProperty('BUILD_SORTED');
    return 'BUILD_REPORT';
  }
  var cache = loadFolderMap();
  var rootId = store.getProperty('ROOT_ID');
  var rootName = store.getProperty('ROOT_NAME') || 'My Drive';
  var buffer = [];
  while (cursor <= last && !overBudget(20000)) {
    var count = Math.min(50, last - cursor + 1);
    var values = sheet.getRange(cursor, 1, count, INDEX_COLS).getValues();
    var paths = [];
    var done = 0;
    for (var i = 0; i < values.length; i++) {
      if (overBudget(20000)) break;
      var parentIds = splitIds(values[i][4]);
      for (var p = 0; p < parentIds.length; p++) absorbFolderChain(parentIds[p], cache, rootId, buffer);
      paths.push([sheetText(buildFilePaths(parentIds, unwrapSheetText(values[i][1]), cache, rootId, rootName))]);
      done++;
    }
    if (!done) break;
    flushFolderBuffer(buffer);
    ensureGrid(sheet, cursor, done, INDEX_COLS);
    var range = sheet.getRange(cursor, 9, done, 1);
    range.setNumberFormat('@');
    range.setValues(paths);
    cursor += done;
    store.setProperty('PATH_CURSOR', String(cursor));
    writeStatusField('Phase', 'Building full paths');
    writeStatusField('Path row', (cursor - 2) + ' / ' + Math.max(last - 1, 0));
    if (done < count) break;
  }
  flushFolderBuffer(buffer);
  if (cursor > last) {
    store.setProperty('BUILD_CURSOR', '2');
    store.deleteProperty('BUILD_SORTED');
    return 'BUILD_REPORT';
  }
  return 'BUILD_PATHS';
}

function memberFromIndexRow(row) {
  var id = String(row[0] || '');
  var md5 = String(row[3] || '').toLowerCase();
  var size = normSize(row[2]);
  var key = String(row[7] || '');
  if (!isFileId(id) || !isMd5(md5) || !size || size === '0') return null;
  if (key !== md5 + '|' + size) key = md5 + '|' + size;
  return {
    id: id,
    name: unwrapSheetText(row[1]),
    size: size,
    md5: md5,
    parentIds: splitIds(row[4]),
    createdTime: String(row[5] || ''),
    path: unwrapSheetText(row[8]),
    groupKey: key
  };
}

function loadPending() {
  var store = props();
  var pending = emptyPending();
  pending.key = store.getProperty('CARRY_KEY') || '';
  pending.count = Number(store.getProperty('CARRY_COUNT') || '0');
  pending.truncated = store.getProperty('CARRY_TRUNCATED') === '1';
  var sampleRaw = store.getProperty('CARRY_SAMPLE') || '';
  if (sampleRaw) {
    try { pending.sample = JSON.parse(sampleRaw); } catch (ignore) { pending.sample = null; }
  }
  if (pending.truncated) return pending;
  var sheet = getOrCreateSheet(SHEET_CARRY);
  var last = sheet.getLastRow();
  pending.members = [];
  if (last >= 2) {
    var values = sheet.getRange(2, 1, last - 1, 8).getValues();
    for (var i = 0; i < values.length; i++) {
      var member = memberFromIndexRow([
        values[i][0], values[i][1], values[i][2], values[i][3], values[i][4], values[i][5], '', values[i][7], values[i][6]
      ]);
      if (member) pending.members.push(member);
    }
  }
  if (!pending.key && pending.members.length) pending.key = pending.members[0].groupKey;
  var matched = [];
  for (var j = 0; j < pending.members.length; j++) {
    if (!pending.key || pending.members[j].groupKey === pending.key) matched.push(pending.members[j]);
  }
  pending.members = matched;
  pending.count = pending.members.length;
  return pending;
}

function savePending(pending) {
  var store = props();
  var sample = pending.sample ? {
    id: pending.sample.id,
    name: cleanDisplay(pending.sample.name, 300),
    size: pending.sample.size,
    md5: pending.sample.md5,
    createdTime: pending.sample.createdTime,
    path: cleanDisplay(pending.sample.path, 1500),
    groupKey: pending.sample.groupKey
  } : null;
  var sheet = getOrCreateSheet(SHEET_CARRY);
  var members = pending.truncated ? [] : (pending.members || []);
  var width = 8;
  var block = [['id', 'name', 'size', 'md5', 'parentIds', 'createdTime', 'path', 'groupKey']];
  for (var i = 0; i < members.length; i++) {
    var member = members[i];
    block.push([
      sheetExact(member.id),
      sheetText(member.name),
      sheetExact(member.size),
      sheetExact(member.md5),
      sheetExact((member.parentIds || []).join(',')),
      member.createdTime,
      sheetText(member.path),
      member.groupKey
    ]);
  }
  ensureGrid(sheet, 1, block.length, width);
  sheet.getRange(1, 1, block.length, width).setNumberFormat('@');
  sheet.getRange(1, 1, block.length, width).setValues(block);
  var existing = Math.max(sheet.getLastRow(), 1);
  if (existing > block.length) {
    sheet.getRange(block.length + 1, 1, existing - block.length, width).clearContent();
  }
  // Properties after the sheet, so a resume cannot pair a new key with old rows.
  store.setProperty('CARRY_KEY', pending.key || '');
  store.setProperty('CARRY_COUNT', String(pending.truncated ? (pending.count || 0) : members.length));
  store.setProperty('CARRY_TRUNCATED', pending.truncated ? '1' : '0');
  store.setProperty('CARRY_SAMPLE', JSON.stringify(sample));
}

function ensureDuplicateHeader() {
  var store = props();
  if (store.getProperty('REPORT_RESET') === '1') return getOrCreateSheet(SHEET_DUPLICATES);
  var headers = [
    'File 1 full path (earlier created time)',
    'File 2 full path',
    'Action',
    'Size',
    'Result',
    'File 1 ID',
    'File 2 ID',
    'Size bytes',
    'MD5',
    'Pair key'
  ];
  var sheet = resetSheet(SHEET_DUPLICATES, headers);
  sheet.setColumnWidth(1, 460);
  sheet.setColumnWidth(2, 460);
  sheet.setColumnWidth(3, 220);
  sheet.setColumnWidth(4, 110);
  sheet.setColumnWidth(5, 420);
  sheet.setColumnWidth(DUP_MD5, 280);
  sheet.getRange(1, DUP_ACTION).setNote(
    'Choosing Delete file 1 or Delete file 2 only opens a confirmation dialog. ' +
      'Nothing is permanently deleted. A file is moved to Trash only if another identical copy still exists.'
  );
  sheet.getRange(1, 1, 1, DUP_MD5).setBackground('#f5f5f4').setFontWeight('bold');
  store.setProperty('REPORT_RESET', '1');
  store.setProperty('DUP_ROWS', '1');
  store.setProperty('DUP_GROUPS', '0');
  return sheet;
}

function reportRowForPair(pair) {
  var file1 = pair.file1;
  var file2 = pair.file2;
  return [
    sheetText(file1.path || file1.name),
    sheetText(file2.path || file2.name),
    '',
    formatBytes(file1.size),
    'Not touched. Path text is from the scan. Open both links. The confirmation dialog reads Drive again before Trash.',
    sheetExact(file1.id),
    sheetExact(file2.id),
    sheetExact(file1.size),
    sheetExact(file1.md5),
    file1.id + '|' + file2.id
  ];
}

function reportRowForSummary(done) {
  var sample = done.sample || {};
  var sampleId = isFileId(sample.id) ? sample.id : '';
  return [
    'Group too large for one-click review (' + done.count + ' files). No delete buttons were created.',
    sheetText(cleanDisplay(sample.path || sample.name || '', 1500)),
    '',
    formatBytes(sample.size || ''),
    'Safety cap: groups over ' + MAX_GROUP + ' files have no Delete action. Checksum ' + (sample.md5 || '') + '.',
    '',
    sheetExact(sampleId),
    sheetExact(sample.size || ''),
    sheetExact(sample.md5 || ''),
    'summary|' + (done.key || '')
  ];
}

function appendReportRows(rows) {
  if (!rows.length) return;
  var store = props();
  var sheet = ensureDuplicateHeader();
  var start = Number(store.getProperty('DUP_ROWS') || '1') + 1;
  if (start < 2) start = 2;
  ensureGrid(sheet, start, rows.length, DUP_COLS);
  var range = sheet.getRange(start, 1, rows.length, DUP_COLS);
  range.setNumberFormat('@');
  range.setValues(rows);
  store.setProperty('DUP_ROWS', String(start + rows.length - 1));
}

function buildReportStep() {
  var store = props();
  var sheet = getOrCreateSheet(SHEET_INDEX);
  var last = sheet.getLastRow();
  if (store.getProperty('BUILD_SORTED') !== '1') {
    if (last >= 3) {
      sheet.getRange(2, 1, last - 1, INDEX_COLS).sort({ column: INDEX_KEY, ascending: true });
    }
    store.setProperty('BUILD_SORTED', '1');
    store.setProperty('BUILD_CURSOR', '2');
    ensureDuplicateHeader();
    writeStatusField('Phase', 'Grouping identical files');
    return 'BUILD_REPORT';
  }
  var cursor = Number(store.getProperty('BUILD_CURSOR') || '2');
  if (last < 2 || cursor > last) {
    var pendingTail = loadPending();
    var finishedTail = finishPending(pendingTail);
    var tailRows = [];
    if (finishedTail) tailRows = rowsFromCompleted([finishedTail]);
    appendReportRows(tailRows);
    savePending(emptyPending());
    appendStoredSummaries();
    if (finishedTail) store.setProperty('DUP_GROUPS', String(Number(store.getProperty('DUP_GROUPS') || '0') + 1));
    writeStatusField('Duplicate groups', store.getProperty('DUP_GROUPS') || '0');
    return 'DEDUPE';
  }
  var count = Math.min(1500, last - cursor + 1);
  var values = sheet.getRange(cursor, 1, count, INDEX_COLS).getValues();
  var pending = loadPending();
  var completed = [];
  for (var i = 0; i < values.length; i++) {
    var member = memberFromIndexRow(values[i]);
    if (!member) continue;
    pending = pushMember(pending, member, completed);
  }
  var reportRows = rowsFromCompleted(completed);
  appendReportRows(reportRows);
  if (completed.length) {
    store.setProperty('DUP_GROUPS', String(Number(store.getProperty('DUP_GROUPS') || '0') + completed.length));
  }
  savePending(pending);
  store.setProperty('BUILD_CURSOR', String(cursor + count));
  writeStatusField('Phase', 'Grouping identical files');
  writeStatusField('Grouped through file', Math.min(cursor + count - 2, last - 1) + ' / ' + (last - 1));
  writeStatusField('Duplicate groups', store.getProperty('DUP_GROUPS') || '0');
  return 'BUILD_REPORT';
}

function rowsFromCompleted(completed) {
  var rows = [];
  for (var i = 0; i < completed.length; i++) {
    var done = completed[i];
    if (done.type === 'summary') {
      rows.push(reportRowForSummary(done));
      continue;
    }
    var pairs = pairsFromMembers(done.members || []);
    for (var p = 0; p < pairs.length; p++) rows.push(reportRowForPair(pairs[p]));
  }
  return rows;
}

function dedupeStep() {
  var sheet = getOrCreateSheet(SHEET_DUPLICATES);
  var last = sheet.getLastRow();
  if (last < 3) {
    props().setProperty('DUP_ROWS', String(Math.max(last, 1)));
    props().setProperty('FORMAT_CURSOR', '2');
    return 'FORMAT';
  }
  var seen = Object.create(null);
  var dupRows = [];
  var row = 2;
  while (row <= last) {
    var count = Math.min(1000, last - row + 1);
    var values = sheet.getRange(row, DUP_PAIR, count, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      var key = String(values[i][0] || '');
      if (!key) continue;
      if (seen[key]) dupRows.push(row + i);
      else seen[key] = true;
    }
    row += count;
  }
  for (var d = dupRows.length - 1; d >= 0; d--) {
    if (overBudget(15000)) return 'DEDUPE';
    sheet.deleteRow(dupRows[d]);
  }
  var kept = Math.max(sheet.getLastRow(), 1);
  props().setProperty('DUP_ROWS', String(kept));
  writeStatusField('Duplicate report rows', Math.max(kept - 1, 0));
  writeStatusField('Duplicate rows removed after resume', dupRows.length);
  props().setProperty('FORMAT_CURSOR', '2');
  return 'FORMAT';
}

function duplicateRowCount() {
  var stored = Number(props().getProperty('DUP_ROWS') || '1');
  var last = getOrCreateSheet(SHEET_DUPLICATES).getLastRow();
  if (stored >= 1 && stored <= last) return stored;
  return last;
}

function formatStep() {
  var store = props();
  var sheet = getOrCreateSheet(SHEET_DUPLICATES);
  var last = duplicateRowCount();
  var cursor = Number(store.getProperty('FORMAT_CURSOR') || '2');
  if (last < 2) {
    finalizeDuplicates(sheet, 0);
    return 'DONE';
  }
  while (cursor <= last && !overBudget(20000)) {
    var count = Math.min(200, last - cursor + 1);
    var values = sheet.getRange(cursor, 1, count, DUP_COLS).getValues();
    var rich1 = [];
    var rich2 = [];
    for (var i = 0; i < values.length; i++) {
      rich1.push([richPath(values[i][0], values[i][DUP_ID1 - 1])]);
      rich2.push([richPath(values[i][1], values[i][DUP_ID2 - 1])]);
    }
    sheet.getRange(cursor, 1, count, 1).setRichTextValues(rich1);
    sheet.getRange(cursor, 2, count, 1).setRichTextValues(rich2);
    cursor += count;
    store.setProperty('FORMAT_CURSOR', String(cursor));
  }
  writeStatusField('Phase', 'Linking paths');
  if (cursor <= last) return 'FORMAT';
  finalizeDuplicates(sheet, last - 1);
  return 'DONE';
}

function richPath(text, fileId) {
  var shown = String(text || '');
  var builder = SpreadsheetApp.newRichTextValue().setText(shown || '(missing path)');
  if (isFileId(fileId) && shown) builder.setLinkUrl(0, shown.length, driveOpenUrl(fileId));
  return builder.build();
}

function finalizeDuplicates(sheet, rowCount) {
  if (rowCount > 0) {
    clearOurProtections(sheet);
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Delete file 1', 'Delete file 2'], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, DUP_ACTION, rowCount, 1).setDataValidation(rule);
    var row = 2;
    while (row < 2 + rowCount) {
      var count = Math.min(500, 2 + rowCount - row);
      var ids = sheet.getRange(row, DUP_ID1, count, 2).getValues();
      for (var i = 0; i < ids.length; i++) {
        var id1 = String(ids[i][0] || '');
        var id2 = String(ids[i][1] || '');
        if (!isFileId(id1) || !isFileId(id2) || id1 === id2) {
          sheet.getRange(row + i, DUP_ACTION).clearDataValidations().clearContent();
        }
      }
      row += count;
    }
    if (sheet.getMaxColumns() >= DUP_PAIR) {
      sheet.hideColumns(DUP_ID1, 3);
      sheet.hideColumns(DUP_PAIR, 1);
    }
    protectRange(sheet.getRange(2, DUP_ID1, rowCount, 3));
    protectRange(sheet.getRange(2, DUP_PAIR, rowCount, 1));
  }
  sheet.setFrozenRows(1);
  writeStatusField('Phase', 'Done');
  writeStatusField('Result', 'Review the Duplicates sheet. Open both file links before using Action. Nothing has been trashed by the scan.');
  try {
    var filter = sheet.getFilter();
    if (filter) filter.remove();
    if (rowCount > 0) sheet.getRange(1, 1, rowCount + 1, DUP_MD5).createFilter();
  } catch (ignore) {}
  try { ss().setActiveSheet(sheet); ss().moveActiveSheet(1); } catch (ignore) {}
}

function ensureLogHeader() {
  var sheet = getOrCreateSheet(SHEET_LOG);
  if (sheet.getLastRow() === 0 || String(sheet.getRange(1, 1).getValue()) !== 'When') {
    if (sheet.getLastRow() === 0) {
      ensureGrid(sheet, 1, 1, 9);
      sheet.getRange(1, 1, 1, 9).setValues([[
        'When', 'What happened', 'File name', 'Full path', 'Size', 'MD5', 'File ID', 'Status', 'Restore'
      ]]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

// ---------------------------------------------------------------------------
// Confirmation + Trash / Restore
// ---------------------------------------------------------------------------

function rangeIntersectsColumn(range, column) {
  var start = range.getColumn();
  var end = start + range.getNumColumns() - 1;
  return column >= start && column <= end;
}

function clearColumnCells(range, column) {
  var startRow = range.getRow();
  var numRows = range.getNumRows();
  if (startRow === 1) {
    startRow = 2;
    numRows -= 1;
  }
  if (numRows < 1) return;
  range.getSheet().getRange(startRow, column, numRows, 1).clearContent();
}

function noteRowFailure(sheetName, row, err) {
  var message = 'Nothing was changed. ' + (err && err.message ? err.message : err);
  try {
    if (row >= 2) {
      var sheet = getOrCreateSheet(sheetName);
      if (sheetName === SHEET_DUPLICATES) {
        sheet.getRange(row, DUP_RESULT).setValue(sheetText(message));
      } else if (sheetName === SHEET_LOG) {
        // Do not overwrite the audit text in column B. A note is enough.
        sheet.getRange(row, 9).setNote(message);
      }
    }
  } catch (ignore) {}
  try { SpreadsheetApp.getUi().alert(message); } catch (ignore) {}
}

function handleEdit(event) {
  try {
    if (!event || !event.range) return;
    var range = event.range;
    var sheet = range.getSheet();
    if (range.getRow() === 1 && range.getNumRows() === 1) return;
    if (sheet.getName() === SHEET_DUPLICATES && rangeIntersectsColumn(range, DUP_ACTION)) {
      if (range.getNumRows() !== 1 || range.getNumColumns() !== 1 || range.getColumn() !== DUP_ACTION) {
        clearColumnCells(range, DUP_ACTION);
        SpreadsheetApp.getUi().alert('For safety, change one Action cell at a time. Nothing was deleted.');
        return;
      }
      var value = String(event.value || range.getValue() || '');
      if (value !== 'Delete file 1' && value !== 'Delete file 2') return;
      range.clearContent();
      if (!reportIsCurrent()) {
        noteRowFailure(SHEET_DUPLICATES, range.getRow(), new Error('Refused. The duplicate report is not from a finished scan. Nothing was deleted.'));
        return;
      }
      openConfirmationForRow(range.getRow());
      return;
    }
    if (sheet.getName() === SHEET_LOG && rangeIntersectsColumn(range, 9)) {
      if (range.getNumRows() !== 1 || range.getNumColumns() !== 1 || range.getColumn() !== 9) {
        clearColumnCells(range, 9);
        return;
      }
      if (String(event.value || range.getValue() || '') !== 'Restore this file') return;
      range.clearContent();
      openRestoreForRow(range.getRow());
    }
  } catch (err) {
    var row = 0;
    var name = '';
    try {
      row = event.range.getRow();
      name = event.range.getSheet().getName();
    } catch (ignore) {}
    noteRowFailure(name || SHEET_DUPLICATES, row, err);
  }
}

function openConfirmationForSelection() {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== SHEET_DUPLICATES) {
    SpreadsheetApp.getUi().alert('Select a row on the Duplicates sheet first. Nothing was deleted.');
    return;
  }
  var row = sheet.getActiveCell().getRow();
  if (row < 2) {
    SpreadsheetApp.getUi().alert('Select a duplicate row, not the header. Nothing was deleted.');
    return;
  }
  try {
    openConfirmationForRow(row);
  } catch (err) {
    noteRowFailure(SHEET_DUPLICATES, row, err);
  }
}

function readDupRow(row) {
  var sheet = getOrCreateSheet(SHEET_DUPLICATES);
  if (row < 2 || row > sheet.getLastRow()) throw new Error('That row is not on the duplicate report. Nothing was deleted.');
  var values = sheet.getRange(row, 1, 1, DUP_COLS).getValues()[0];
  var id1 = String(values[DUP_ID1 - 1] || '');
  var id2 = String(values[DUP_ID2 - 1] || '');
  var md5 = String(values[DUP_MD5 - 1] || '').trim().toLowerCase();
  var sizeRaw = normSize(values[DUP_SIZE - 1]);
  if (!isFileId(id1) || !isFileId(id2) || id1 === id2 || !isMd5(md5) || !sizeRaw || sizeRaw === '0') {
    throw new Error('This row has no delete buttons (it is a summary, or the ids are missing). Nothing was deleted.');
  }
  return {
    row: row,
    path1: String(values[0] || ''),
    path2: String(values[1] || ''),
    id1: id1,
    id2: id2,
    md5: md5,
    sizeRaw: sizeRaw
  };
}

function readLiveFile(fileId) {
  if (!isFileId(fileId)) throw new Error('Invalid file id. Nothing was deleted.');
  return withRetry(function () {
    return Drive.Files.get(fileId, {
      supportsAllDrives: true,
      fields: 'id,name,mimeType,size,md5Checksum,trashed,ownedByMe,parents,createdTime,capabilities(canTrash)'
    });
  });
}

function livePath(meta, cache) {
  var store = props();
  var rootId = store.getProperty('ROOT_ID');
  var rootName = store.getProperty('ROOT_NAME') || 'My Drive';
  var folders = cache || Object.create(null);
  var parents = uniqueIds(meta.parents || []);
  for (var i = 0; i < parents.length; i++) absorbFolderChain(parents[i], folders, rootId, null);
  return buildFilePaths(parents, meta.name, folders, rootId, rootName);
}

function sameOwnedBytes(meta, md5, sizeRaw) {
  if (!meta || meta.trashed === true || meta.ownedByMe !== true) return false;
  if (String(meta.mimeType || '').indexOf('application/vnd.google-apps.') === 0) return false;
  var liveMd5 = String(meta.md5Checksum || '').toLowerCase();
  if (!isMd5(liveMd5) || liveMd5 !== String(md5 || '').toLowerCase()) return false;
  if (normSize(meta.size) !== normSize(sizeRaw)) return false;
  return true;
}

function sheetStillListsPair(id1, id2) {
  var sheet = getOrCreateSheet(SHEET_DUPLICATES);
  var last = duplicateRowCount();
  if (last < 2) return false;
  var values = sheet.getRange(2, DUP_ID1, last - 1, 2).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === id1 && String(values[i][1]) === id2) return true;
  }
  return false;
}

/**
 * @return {{ok:boolean, message:string, plan:Object|null}}
 * No Drive writes.
 */
function evaluateTarget(record, which, liveCache) {
  var targetId = which === 1 ? record.id1 : record.id2;
  var partnerId = which === 1 ? record.id2 : record.id1;
  if (!sheetStillListsPair(record.id1, record.id2)) {
    return { ok: false, message: 'This pair is no longer on the report. Nothing was deleted.', plan: null };
  }
  var target;
  try {
    target = liveCache[targetId] || readLiveFile(targetId);
    liveCache[targetId] = target;
  } catch (err) {
    return { ok: false, message: 'Could not read the file from Drive. Nothing was deleted. ' + err.message, plan: null };
  }
  if (target.trashed === true) {
    return { ok: false, message: 'That copy is already in Trash. Nothing further was changed.', plan: null };
  }
  if (!sameOwnedBytes(target, record.md5, record.sizeRaw)) {
    return { ok: false, message: 'Refused. The file no longer matches the checksum and size from the scan, or you do not own it. Nothing was deleted.', plan: null };
  }
  if (target.capabilities && target.capabilities.canTrash === false) {
    return { ok: false, message: 'Refused. Drive says you cannot trash this file. Nothing was deleted.', plan: null };
  }
  var sibling = findLiveSibling(record, targetId, partnerId, liveCache);
  if (!sibling) {
    return { ok: false, message: 'Refused. No other copy you own is still in Drive with the same size and MD5. Nothing was deleted.', plan: null };
  }
  return {
    ok: true,
    message: '',
    plan: {
      id1: record.id1,
      id2: record.id2,
      targetId: targetId,
      partnerId: sibling.id,
      md5: record.md5,
      sizeRaw: record.sizeRaw,
      which: which,
      pairKey: record.id1 + '|' + record.id2,
      created: Date.now()
    }
  };
}

function findLiveSibling(record, targetId, partnerId, liveCache) {
  var partner = considerLive(partnerId, record, targetId, liveCache);
  if (partner) return partner;
  var ids = indexedIdsForChecksum(record.md5, record.sizeRaw);
  var probes = 0;
  for (var i = 0; i < ids.length; i++) {
    if (ids[i] === targetId || ids[i] === partnerId) continue;
    if (probes >= SIBLING_PROBE_LIMIT) return null;
    probes++;
    var found = considerLive(ids[i], record, targetId, liveCache);
    if (found) return found;
  }
  return null;
}

function considerLive(fileId, record, targetId, liveCache) {
  if (!isFileId(fileId) || fileId === targetId) return null;
  try {
    var meta = liveCache[fileId] || readLiveFile(fileId);
    liveCache[fileId] = meta;
    if (sameOwnedBytes(meta, record.md5, record.sizeRaw)) return meta;
  } catch (ignore) {}
  return null;
}

function indexedIdsForChecksum(md5, sizeRaw) {
  var sheet = getOrCreateSheet(SHEET_INDEX);
  var last = sheet.getLastRow();
  var needle = String(md5 || '').toLowerCase();
  if (last < 2 || !isMd5(needle)) return [];
  var finder = sheet.getRange(2, INDEX_MD5, last - 1, 1).createTextFinder(needle).matchEntireCell(true).matchCase(true);
  var hits = finder.findAll();
  var ids = [];
  for (var i = 0; i < hits.length; i++) {
    var rowValues = sheet.getRange(hits[i].getRow(), 1, 1, 4).getValues()[0];
    if (normSize(rowValues[INDEX_SIZE - 1]) !== normSize(sizeRaw)) continue;
    ids.push(String(rowValues[0]));
  }
  return uniqueIds(ids);
}

function cleanupPlans() {
  var store = props();
  var all = store.getProperties();
  var now = Date.now();
  var keys = Object.keys(all);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (key.indexOf('PLAN_') !== 0 && key.indexOf('RPLAN_') !== 0) continue;
    try {
      var plan = JSON.parse(all[key]);
      if (!plan || !plan.created || now - Number(plan.created) > 15 * 60 * 1000) store.deleteProperty(key);
    } catch (err) {
      store.deleteProperty(key);
    }
  }
}

function invalidatePlans() {
  var store = props();
  var all = store.getProperties();
  var keys = Object.keys(all);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf('PLAN_') === 0) store.deleteProperty(keys[i]);
  }
}

function reportIsCurrent() {
  return (props().getProperty('PHASE') || '') === 'DONE';
}

function assertReportIsCurrent() {
  if (!reportIsCurrent()) {
    throw new Error('Refused. The duplicate report is not from a finished scan (a scan may still be running). Nothing was deleted.');
  }
}

/** Turns off Delete dropdowns on the previous report. The Trash log is kept. */
function disableStaleActions() {
  var sheet = ss().getSheetByName(SHEET_DUPLICATES);
  if (!sheet) return;
  var last = sheet.getLastRow();
  if (last < 2) return;
  var actions = sheet.getRange(2, DUP_ACTION, last - 1, 1);
  actions.clearDataValidations();
  actions.clearContent();
  try {
    sheet.getRange(1, DUP_ACTION).setNote('Delete actions are off until the scan finishes. The scan itself does not trash files.');
  } catch (ignore) {}
}

function deletePlansForPair(pairKey) {
  var store = props();
  var all = store.getProperties();
  var keys = Object.keys(all);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf('PLAN_') !== 0) continue;
    try {
      var plan = JSON.parse(all[keys[i]]);
      if (plan && plan.pairKey === pairKey) store.deleteProperty(keys[i]);
    } catch (ignore) {}
  }
}

function openConfirmationForRow(row) {
  assertCallerIsCurrentUser();
  assertReportIsCurrent();
  cleanupPlans();
  var record = readDupRow(row);
  var cache = {};
  var left = evaluateTarget(record, 1, cache);
  var right = evaluateTarget(record, 2, cache);
  if (!left.ok && !right.ok) throw new Error(left.message || right.message || 'Nothing was deleted.');
  var store = props();
  var nonce1 = '';
  var nonce2 = '';
  if (left.ok) {
    nonce1 = Utilities.getUuid();
    left.plan.nonce = nonce1;
    store.setProperty('PLAN_' + nonce1, JSON.stringify(left.plan));
  }
  if (right.ok) {
    nonce2 = Utilities.getUuid();
    right.plan.nonce = nonce2;
    store.setProperty('PLAN_' + nonce2, JSON.stringify(right.plan));
  }
  var folderCache = Object.create(null);
  var live1 = cache[record.id1];
  var live2 = cache[record.id2];
  var model = {
    nonce1: nonce1,
    nonce2: nonce2,
    reason1: left.ok ? '' : left.message,
    reason2: right.ok ? '' : right.message,
    name1: live1 ? String(live1.name || '') : unwrapSheetText(record.path1),
    name2: live2 ? String(live2.name || '') : unwrapSheetText(record.path2),
    path1: live1 ? livePath(live1, folderCache) : unwrapSheetText(record.path1),
    path2: live2 ? livePath(live2, folderCache) : unwrapSheetText(record.path2),
    created1: live1 ? String(live1.createdTime || '') : '',
    created2: live2 ? String(live2.createdTime || '') : '',
    url1: driveOpenUrl(record.id1),
    url2: driveOpenUrl(record.id2),
    id1: record.id1,
    id2: record.id2,
    md5: record.md5,
    sizeHuman: formatBytes(record.sizeRaw),
    sizeRaw: record.sizeRaw
  };
  var html = HtmlService.createHtmlOutput(buildDialogHtml(model)).setWidth(720).setHeight(680);
  SpreadsheetApp.getUi().showModalDialog(html, 'Confirm — this moves one file to Trash and does not permanently delete');
}

function rollbackTrash(fileId, plan) {
  try {
    DriveApp.getFileById(fileId).setTrashed(false);
  } catch (err) {
    logEmergency(fileId, plan, 'ROLLBACK FAILED after Trash. Restore this file from Drive Trash yourself. ' + err.message);
    throw new Error('The other copy disappeared and putting the file back failed. Restore it from Drive Trash now. File id: ' + fileId);
  }
  var restored = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    restored = readLiveFile(fileId);
    if (restored && restored.trashed !== true) return;
    Utilities.sleep(500);
  }
  logEmergency(fileId, plan, 'ROLLBACK UNCONFIRMED. The file may still be in Trash. File id: ' + fileId);
  throw new Error('The other copy disappeared. Drive did not confirm the file left Trash. Check Drive Trash now. File id: ' + fileId);
}

/**
 * The only function that moves a file to Trash.
 * Single-use server-side token. Re-checks ownership, checksum, size, and a surviving copy.
 */
function trashFromDialog(nonce) {
  if (!/^[0-9a-f-]{36}$/i.test(String(nonce || ''))) throw new Error('Bad confirmation. Nothing was deleted.');
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Another action is running. Nothing was deleted.');
  try {
    assertCallerIsCurrentUser();
    assertReportIsCurrent();
    var store = props();
    var raw = store.getProperty('PLAN_' + nonce);
    if (!raw) throw new Error('This confirmation expired or was already used. Nothing was deleted.');
    var plan;
    try {
      plan = JSON.parse(raw);
    } catch (err) {
      store.deleteProperty('PLAN_' + nonce);
      throw new Error('Stored confirmation was unreadable. Nothing was deleted.');
    }
    if (!plan || !plan.pairKey || Date.now() - Number(plan.created || 0) > 10 * 60 * 1000) {
      deletePlansForPair(plan && plan.pairKey ? plan.pairKey : '');
      store.deleteProperty('PLAN_' + nonce);
      throw new Error('This confirmation expired. Nothing was deleted.');
    }
    if (!isFileId(plan.targetId) || !isFileId(plan.id1) || !isFileId(plan.id2)) {
      throw new Error('Stored confirmation was invalid. Nothing was deleted.');
    }
    if (!isMd5(plan.md5) || normSize(plan.sizeRaw) === '' || normSize(plan.sizeRaw) === '0') {
      throw new Error('Stored confirmation had no checksum. Nothing was deleted.');
    }
    if (!sheetStillListsPair(plan.id1, plan.id2)) {
      throw new Error('The report row changed. Nothing was deleted. Open the buttons again.');
    }
    var cache = {};
    var target = readLiveFile(plan.targetId);
    cache[plan.targetId] = target;
    if (!sameOwnedBytes(target, plan.md5, plan.sizeRaw)) {
      throw new Error('Refused. The file changed, is already trashed, or is not owned by you. Nothing was deleted.');
    }
    if (target.capabilities && target.capabilities.canTrash === false) {
      throw new Error('Refused. Drive says this file cannot be trashed. Nothing was deleted.');
    }
    var sibling = findLiveSibling(
      { id1: plan.id1, id2: plan.id2, md5: plan.md5, sizeRaw: plan.sizeRaw },
      plan.targetId,
      plan.partnerId,
      cache
    );
    if (!sibling || sibling.id === plan.targetId) {
      throw new Error('Refused. The other copy is gone or no longer identical. Nothing was deleted.');
    }
    var siblingNow = readLiveFile(sibling.id);
    if (!siblingNow || siblingNow.id === plan.targetId || !sameOwnedBytes(siblingNow, plan.md5, plan.sizeRaw)) {
      throw new Error('Refused. The other copy changed at the last moment. Nothing was deleted.');
    }
    var targetNow = readLiveFile(plan.targetId);
    if (!sameOwnedBytes(targetNow, plan.md5, plan.sizeRaw)) {
      throw new Error('Refused. The chosen file changed at the last moment. Nothing was deleted.');
    }
    if (targetNow.capabilities && targetNow.capabilities.canTrash === false) {
      throw new Error('Refused. Drive says this file cannot be trashed. Nothing was deleted.');
    }
    // Consume every button for this pair only once the checks have passed.
    // A refusal before this line leaves the other button usable. The document
    // lock is held, so the other button cannot pass the same checks in parallel.
    deletePlansForPair(plan.pairKey);
    // Sole trash mutation in this project.
    try {
      DriveApp.getFileById(plan.targetId).setTrashed(true);
    } catch (err) {
      var maybe = null;
      try { maybe = readLiveFile(plan.targetId); } catch (ignore) {}
      if (!maybe || maybe.trashed !== true) {
        throw new Error('Drive refused to trash the file. Nothing was deleted. ' + err.message);
      }
    }
    var after = null;
    var afterError = null;
    try {
      after = readLiveFile(plan.targetId);
    } catch (err) {
      afterError = err;
    }
    // The spare copy is checked even when the trashed file cannot be re-read.
    // If that spare is gone, put this file back.
    var siblingAfter = null;
    try { siblingAfter = readLiveFile(siblingNow.id); } catch (ignore) {}
    if (!sameOwnedBytes(siblingAfter, plan.md5, plan.sizeRaw)) {
      rollbackTrash(plan.targetId, plan);
      throw new Error('The other copy disappeared during Trash. This file was put back. Nothing was left in Trash by this script.');
    }
    if (!after) {
      logEmergency(plan.targetId, plan, 'Trash was requested but the file could not be re-read. Check Drive Trash. ' + (afterError && afterError.message ? afterError.message : afterError));
      return 'Trash was requested for ' + (targetNow.name || plan.targetId) + ', but Drive could not be re-read afterward. The other copy was still in Drive. Check Drive Trash before trying again. File id: ' + plan.targetId;
    }
    if (!after.trashed) {
      throw new Error('Drive did not confirm the file is in Trash. It was not left in an unknown state by this script. File id: ' + plan.targetId);
    }
    var warning = '';
    try { logTrash(targetNow, livePath(targetNow), plan); } catch (err) { warning += ' Log write failed: ' + err.message; }
    try { noteTrashed(plan.id1, plan.id2, plan.targetId, targetNow.name); } catch (err) { warning += ' Sheet note failed: ' + err.message; }
    return 'Moved to Trash, not permanently deleted: ' + targetNow.name + '. The row was moved to the "deleted duplicates" sheet. Restore it from the TrashLog sheet or from Drive Trash. The other copy was left in place.' + warning;
  } finally {
    lock.releaseLock();
  }
}

function logEmergency(fileId, plan, message) {
  try {
    var sheet = ensureLogHeader();
    var start = Math.max(sheet.getLastRow(), 1) + 1;
    ensureGrid(sheet, start, 1, 9);
    var meta = null;
    try { meta = readLiveFile(fileId); } catch (ignore) {}
    sheet.getRange(start, 1, 1, 9).setNumberFormat('@');
    sheet.getRange(start, 1, 1, 9).setValues([[
      new Date().toISOString(),
      sheetText(message),
      sheetText(meta ? String(meta.name || '') : ''),
      '',
      meta ? sheetExact(normSize(meta.size)) : (plan ? sheetExact(normSize(plan.sizeRaw)) : ''),
      meta ? sheetExact(String(meta.md5Checksum || '').toLowerCase()) : (plan ? sheetExact(plan.md5) : ''),
      sheetExact(fileId),
      'CHECK TRASH',
      ''
    ]]);
  } catch (ignore) {}
}

function logTrash(meta, path, plan) {
  var sheet = ensureLogHeader();
  var start = Math.max(sheet.getLastRow(), 1) + 1;
  ensureGrid(sheet, start, 1, 9);
  var values = [[
    new Date().toISOString(),
    'Moved to Trash by Duplicate review ' + SCRIPT_VERSION + '. Not permanently deleted.',
    sheetText(String(meta.name || '')),
    sheetText(path),
    normSize(meta.size),
    sheetExact(String(meta.md5Checksum || plan.md5).toLowerCase()),
    sheetExact(meta.id),
    'In Trash',
    ''
  ]];
  var range = sheet.getRange(start, 1, 1, 9);
  range.setNumberFormat('@');
  range.setValues(values);
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(['Restore this file'], true).setAllowInvalid(false).build();
  sheet.getRange(start, 9).setDataValidation(rule);
  if (isFileId(meta.id)) {
    var rich = SpreadsheetApp.newRichTextValue().setText(String(meta.name || meta.id)).setLinkUrl(driveOpenUrl(meta.id)).build();
    sheet.getRange(start, 3).setRichTextValue(rich);
  }
}

function noteTrashed(id1, id2, targetId, name) {
  var sheet = getOrCreateSheet(SHEET_DUPLICATES);
  var last = duplicateRowCount();
  if (last < 2) return;
  var ids = sheet.getRange(2, DUP_ID1, last - 1, 2).getValues();
  var match = -1;
  for (var i = 0; i < ids.length; i++) {
    var a = String(ids[i][0] || '');
    var b = String(ids[i][1] || '');
    if (a === id1 && b === id2) {
      match = i;
      continue;
    }
    if (a === targetId || b === targetId) {
      var which = a === targetId ? 'File 1' : 'File 2';
      sheet.getRange(i + 2, DUP_RESULT).setValue(sheetText(which + ' is already in Trash from another row. It was not permanently deleted. A later Trash on this row still requires a surviving identical copy.'));
    }
  }
  if (match < 0) return;
  archiveDeletedRow(sheet, match + 2, String(ids[match][0] || ''), targetId, name);
}

function ensureDeletedSheet() {
  var sheet = getOrCreateSheet(SHEET_DELETED);
  var headers = [
    'File 1 full path (earlier created time)',
    'File 2 full path',
    'Action',
    'Size',
    'Result',
    'File 1 ID',
    'File 2 ID',
    'Size bytes',
    'MD5',
    'Pair key',
    'Deleted'
  ];
  if (sheet.getLastRow() === 0 || String(sheet.getRange(1, 1).getValue() || '') !== headers[0]) {
    ensureGrid(sheet, 1, 1, headers.length);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#fde8e8');
    sheet.setFrozenRows(1);
    if (sheet.getMaxColumns() >= DUP_PAIR) {
      sheet.hideColumns(DUP_ID1, 3);
      sheet.hideColumns(DUP_PAIR, 1);
    }
  }
  return sheet;
}

function archiveDeletedRow(sheet, row, id1, targetId, name) {
  var which = id1 === targetId ? 'File 1' : 'File 2';
  var deletedNote = which + ' was moved to Trash, not permanently deleted: ' + (name || targetId) + '. The other file on this row was left in Drive.';
  var values = sheet.getRange(row, 1, 1, DUP_COLS).getValues()[0];
  var rich1 = null;
  var rich2 = null;
  try {
    var rich = sheet.getRange(row, 1, 1, 2).getRichTextValues();
    rich1 = rich[0][0];
    rich2 = rich[0][1];
  } catch (ignore) {}
  var dest = ensureDeletedSheet();
  var destRow = Math.max(dest.getLastRow(), 1) + 1;
  ensureGrid(dest, destRow, 1, DUP_COLS + 1);
  var out = values.slice();
  out[DUP_ACTION - 1] = '';
  out.push(sheetText(deletedNote));
  var range = dest.getRange(destRow, 1, 1, out.length);
  range.setNumberFormat('@');
  range.setValues([out]);
  try {
    if (rich1) dest.getRange(destRow, 1).setRichTextValue(rich1);
    if (rich2) dest.getRange(destRow, 2).setRichTextValue(rich2);
  } catch (ignore) {}
  clearOurProtections(sheet);
  sheet.deleteRow(row);
  var remaining = sheet.getLastRow();
  if (remaining >= 2) {
    protectRange(sheet.getRange(2, DUP_ID1, remaining - 1, 3));
    protectRange(sheet.getRange(2, DUP_PAIR, remaining - 1, 1));
  }
  props().setProperty('DUP_ROWS', String(Math.max(remaining, 1)));
}

function openRestoreForRow(row) {
  assertCallerIsCurrentUser();
  var sheet = ensureLogHeader();
  if (row < 2 || row > sheet.getLastRow()) throw new Error('Not a log row. Nothing was changed.');
  var values = sheet.getRange(row, 1, 1, 9).getValues()[0];
  var fileId = String(values[6] || '');
  var status = String(values[7] || '');
  if (!isFileId(fileId)) throw new Error('Log row has no file id. Nothing was changed.');
  if (status === 'Restored') throw new Error('Log says this file was already restored. Nothing was changed.');
  if (status !== 'In Trash') throw new Error('This log row is not a Trash entry made by this script. Nothing was changed.');
  cleanupPlans();
  var nonce = Utilities.getUuid();
  props().setProperty('RPLAN_' + nonce, JSON.stringify({
    nonce: nonce,
    row: row,
    fileId: fileId,
    md5: String(values[5] || '').toLowerCase(),
    sizeRaw: normSize(values[4]),
    created: Date.now()
  }));
  var html = HtmlService.createHtmlOutput(buildRestoreHtml({
    nonce: nonce,
    name: unwrapSheetText(values[2]),
    path: unwrapSheetText(values[3])
  })).setWidth(560).setHeight(360);
  SpreadsheetApp.getUi().showModalDialog(html, 'Restore from Trash');
}

/** Takes a file back out of Trash, only for an id this script logged. */
function restoreFromDialog(nonce) {
  if (!/^[0-9a-f-]{36}$/i.test(String(nonce || ''))) throw new Error('Bad confirmation. Nothing was changed.');
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Busy. Nothing was changed.');
  try {
    assertCallerIsCurrentUser();
    var store = props();
    var key = 'RPLAN_' + nonce;
    var raw = store.getProperty(key);
    store.deleteProperty(key);
    if (!raw) throw new Error('Restore confirmation expired or was already used. Nothing was changed.');
    var plan = JSON.parse(raw);
    if (!plan || Date.now() - Number(plan.created || 0) > 10 * 60 * 1000) {
      throw new Error('Restore confirmation expired. Nothing was changed.');
    }
    var sheet = ensureLogHeader();
    if (plan.row < 2 || plan.row > sheet.getLastRow()) throw new Error('Log row missing. Nothing was changed.');
    var values = sheet.getRange(plan.row, 1, 1, 9).getValues()[0];
    if (String(values[6]) !== plan.fileId || String(values[7]) !== 'In Trash') {
      throw new Error('Log row does not match this confirmation. Nothing was changed.');
    }
    var meta = readLiveFile(plan.fileId);
    if (meta.ownedByMe !== true) throw new Error('Refused. You do not own this file. Nothing was changed.');
    if (!meta.trashed) throw new Error('The file is not in Trash. Nothing was changed.');
    var liveMd5 = String(meta.md5Checksum || '').toLowerCase();
    if (!isMd5(liveMd5) || liveMd5 !== String(plan.md5 || '').toLowerCase() || normSize(meta.size) !== normSize(plan.sizeRaw)) {
      throw new Error('Refused. The file in Trash does not match the checksum this script logged. Nothing was changed.');
    }
    DriveApp.getFileById(plan.fileId).setTrashed(false);
    var after = readLiveFile(plan.fileId);
    if (after.trashed) throw new Error('Drive did not confirm the restore. Check Drive Trash manually. File id: ' + plan.fileId);
    try {
      sheet.getRange(plan.row, 8).setValue('Restored');
      sheet.getRange(plan.row, 2).setValue(sheetText('Restored from Trash by Duplicate review ' + SCRIPT_VERSION + '.'));
    } catch (err) {
      return 'Restored in Drive: ' + (meta.name || plan.fileId) + '. The log sheet could not be updated (' + err.message + '). It is back in Drive and was not modified.';
    }
    return 'Restored: ' + (meta.name || plan.fileId) + '. It is back in Drive and was not modified.';
  } finally {
    lock.releaseLock();
  }
}

// Apps Script never enters this block (`module` is undefined). Node tests do.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildFolderPath: buildFolderPath,
    buildFilePaths: buildFilePaths,
    consumeMembers: consumeMembers,
    pairsFromMembers: pairsFromMembers,
    escapeHtml: escapeHtml,
    buildDialogHtml: buildDialogHtml,
    groupKeyOf: groupKeyOf,
    normSize: normSize,
    formatBytes: formatBytes,
    isFileId: isFileId,
    pushMember: pushMember,
    emptyPending: emptyPending,
    finishPending: finishPending,
    sanitizePathSegment: sanitizePathSegment,
    sheetText: sheetText,
    htmlBlock: htmlBlock
  };
}
