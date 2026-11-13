# Duplicate review

Version **2026-11-13.6**

A Google Apps Script, bound to a private Google Sheet, that finds files you own in My Drive which Google Drive reports as byte-for-byte identical. It lists each pair with a full path. You review the pairs yourself. Choosing an Action records that choice. **Delete all selected actions** then checks each chosen row and moves the chosen file to Trash, with no dialog. If a check fails before Trash, that row stays and the reason is written in red at the end of the row. **Open confirmation for selected row** still asks before it trashes one file.

The script is [DuplicateReview.gs](DuplicateReview.gs). Paste that whole file into the spreadsheet's Apps Script project. This README is the operating manual.

## What it is for

People accumulate the same video, archive, or photo in more than one folder: laptop backups, old Drive dumps, copies made by sync tools. The file names are often different. This script does not look at names. It groups files that Drive says have the same checksum and the same size, then shows you both paths so you can decide which copy to keep.

It is a review tool. The scan only reads Drive. A delete is a separate action, and it moves the chosen file to Google Drive Trash. It does not permanently delete anything.

## What "identical" means

Two files are a pair only when both of these are true:

- Drive reports the same `md5Checksum`.
- Drive reports the same size in bytes.

The script does not download the files and hash them again. It trusts the checksum Drive already stored when the file was uploaded. The same file name is not enough. The same size with a different checksum is not enough.

Google Docs, Google Sheets, and Google Slides have no binary checksum. They are skipped. A shortcut is not a file body. A file whose checksum is not ready yet is skipped.

## What the script never does

- It never permanently deletes a file. There is no empty-Trash call and no Drive `delete` call.
- The only Drive change it can make to your documents is `setTrashed(true)` for a file you chose, or `setTrashed(false)` to put that file back.
- It does not rename, move, or edit your documents during a scan.
- It does not publish a web app. A link in an email cannot trash a file. There is no `doGet` or `doPost`.
- **Open confirmation for selected row** does not trash the last copy. That path allows Trash only when another file you own is still in Drive with the same size and the same MD5. A copy on a Shared drive, or a copy you do not own, does not count as that spare.
- **Delete all selected actions** applies that same spare-copy check, with no dialog and no confirmation. For each row whose Action is already filled in, it re-checks ownership, checksum, size, and that another file you own is still in Drive with the same size and the same MD5. If a check fails before Trash, it trashes neither file on that row and writes the reason in red in the **Issue** column at the end of the row. The Action stays. If the chosen file is already in Trash and a spare copy remains, it records that row and removes it, and it does not trash the other file. If no spare remains, it leaves the file in Trash and skips the row. It does not run while a scan is still going. It also skips a row whose hidden pair key does not match its two file ids, and it never trashes this spreadsheet.
- It does not scan Shared drives.
- It does not scan files you do not own.

Google's permission screen says the script can delete Drive files. That is Google's wording for the Drive permission required to move a file you already own into Trash. The script never calls a permanent-delete method.

## What it skips

| Skipped | Why |
|---|---|
| Files you do not own | Only your copies can be trashed safely |
| Shared drives | Not part of My Drive, and not a spare copy |
| Google Docs, Sheets, and Slides | No binary checksum |
| 0-byte files | Empty files are not useful pairs |
| Files smaller than the minimum you set | You choose the cutoff |
| Files with no checksum yet | Drive has not finished hashing them |
| Groups larger than 500 files | Listed as a summary, with no Delete action |

There is no maximum number of files. A Drive with millions of files is scanned in short runs. Only files that are part of a duplicate group are written into the spreadsheet.

## How a scan works

Apps Script stops a single run after about six minutes. The scan is a series of short runs. Each run saves its place and schedules the next one about a minute later. You can also choose **Resume scan now**.

One execution stops itself before the six-minute kill, so it is not cut off in the middle of a write. If Google still reports "Exceeded maximum execution time", the work done in earlier runs is kept. **Resume scan now** continues it. An empty **Duplicates** tab before **Phase** says **Done** means the report is not built yet. It does not mean there were no copies.

### Phases

**Status** shows the current phase. The usual order is:

1. **Listing files you own.** Drive is paged. Empty files and files under the minimum size are counted and skipped. Files that qualify are stored as pages in the index folder.
2. **Sorting checksums.** Those pages are grouped by checksum. **Listing pages sorted** climbs, then **Checksum files still to sort** drains the leftover groups. A jump in that second number is normal. It is not a new scan.
3. **Comparing checksums.** Each checksum pile is compared. **Checksum groups checked** is piles, not pairs. The second number can rise above 256 if a pile is split. **Duplicate files kept for review** counts files that have at least one identical copy.
4. **Building full paths.** **Path row** walks each duplicate file back to My Drive so the sheet can show a folder path.
5. **Grouping identical files.** Pairs are written to **Duplicates**.
6. **Linking paths.** Paths become links, then the Action dropdown is added. This step does not show a fraction. It can sit on **Linking paths** for a while.
7. **Done.** The report is ready. Delete actions are allowed.

**ERROR** means the scan stopped. Read **Last error**. Some stops are temporary (a Drive "Service error", or a false "Response Code: 200" while reading the index). **Resume scan now** continues those and keeps the files already indexed. Do not start a new scan for that kind of stop. A new scan throws away the index and lists Drive again.

### How pairs are formed

Inside a group, the file with the earliest created time is File 1. Every later copy is paired with that file, not with each other.

A group of two files is one row. A group of three files is two rows, both with the same File 1. That is why the number of duplicate groups is smaller than the number of report rows.

A group of more than 500 files is not given Delete actions. It is recorded as a summary so one enormous group cannot fill the sheet with hundreds of one-click rows.

### The index folder

The scan creates a folder in your Drive named **Duplicate review index (script data)**. That folder holds the script's own page and checksum files. It is not a copy of your documents.

- Do not delete it while **Phase** is anything other than **Done** or **ERROR**.
- After the scan finishes, old index folders are working files. You may delete them. That does not delete your documents.
- If the spreadsheet cannot hold every duplicate group, **Status** says the interactive report was shortened. The omitted groups are listed in that folder as `groups-not-shown.json`. Raise the minimum size and scan again to review a smaller set. Nothing was trashed.

### Sheets the scan creates

| Sheet | What it is |
|---|---|
| **Status** | Progress, phase, counts, and the last error |
| **Duplicates** | The review report. One row is one pair |
| **deleted duplicates** | Rows whose delete was confirmed. Created on the first successful Trash, not when you paste the script |
| **TrashLog** | Audit log of files this script moved to Trash, with Restore |
| **FileIndex** | Duplicate files only, used while building paths. Not your whole Drive |
| **FolderIndex** | Scratch data for folder names |
| **Carry** | Scratch data |

Do not edit or sort **FileIndex**, **FolderIndex**, or **Carry** while a scan is running. Do not delete **TrashLog**.

## Setup

Use the Google account that owns the files.

1. Create a new blank Google Sheet. Name it whatever you like.
2. Click **Share**. Set access to **Restricted**. Remove every other person. Turn link sharing off. The sheet must stay private. The confirmation trigger runs as you, so another person's edit on a shared sheet could reach the Trash action. The script refuses a shared sheet, but do not share it later either.
3. **Extensions → Apps Script**. Delete the sample `myFunction`. Paste the whole of `DuplicateReview.gs`, including the `module.exports` block at the bottom. Save.
4. Confirm the runtime is **V8**. On a new project that is the default (**Project Settings**).
5. In the Apps Script editor, click **Services** (+). Add **Drive API**. Set the identifier to exactly `Drive` and the version to **v3**. Do not add v2.
6. If a later run says the Drive API is disabled: **Project Settings → Google Cloud Platform project**, then in Google Cloud open **APIs & Services → Library**, find **Drive API**, and enable it.
7. Reload the spreadsheet so the **Duplicate review** menu appears.
8. Choose **Duplicate review → Authorize and check setup**. The first click opens Google's permission screen and may not finish the check. Approve it, then run **Authorize and check setup** again. The result must say sharing and identity are OK. If it says the sheet is shared, stop and unshare it.
9. Choose **Duplicate review → Install confirmation buttons**. This installs the trigger that opens the Restore dialog. Choosing an Action does not trash a file by itself. **Delete all selected actions** does not need this trigger. Restore on **TrashLog** does.
10. Optional: **Duplicate review → Set minimum file size**. Then **Duplicate review → Scan My Drive for identical files**.

Do not use the script editor's **Run** button for the scan or for dialogs. `getUi()` does not work there, so no dialog can appear. Use the spreadsheet menu. If you did run `authorize` from the editor, read the **Status** sheet, then reload the spreadsheet.

Do not deploy the project as a web app.

## Minimum file size

**Set minimum file size** asks for a size. Examples that work:

- `0` — every non-empty file
- `100KB`
- `1MB`
- `10MB`
- `1.5GB`
- `500000` — a plain byte count

Units are `B`, `KB`, `MB`, `GB`, and `TB` (1024-based). The value is stored for the next scan. It does not change Drive, and it does not change a scan that is already running. The size used by the current scan is fixed when that scan starts. **Status** shows it as **Minimum size**.

Files under that size are counted as **Below minimum skipped**. They are not treated as copies.

## Running the scan and telling whether it is still going

Choose **Scan My Drive for identical files** once. Leave the spreadsheet open or close it. The continuation trigger runs either way.

The scan is running when any of these is true:

- **Extensions → Apps Script → Executions** shows **Running**.
- **Status → Phase** is a step name, not **Done** and not **ERROR**, and the counters are moving when you reload.

It is stopped when **Phase** is **Done** or **ERROR**. **ERROR** does not resume by itself. Open **Resume scan now** only after you have pasted a fix, or when **Last error** is a temporary Drive failure and you are on version 2026-11-03.10 or later. Those temporary stops continue the saved index. They do not list Drive from the beginning.

Personal Gmail accounts get about 90 minutes per day of automatic trigger time. A large Drive can need more than that. When the daily quota runs out, the scan pauses. The next day, or any time the quota allows, choose **Resume scan now**. Do not choose **Scan My Drive** again unless you intend to discard the index and start over.

A Trash confirmation can delay the next automatic resume by about a minute. That delay does not trash anything.

### What to do with common messages

| What you see | What it means | What to do |
|---|---|---|
| Exceeded maximum execution time | Google cut off one chunk | If **Phase** is not **ERROR**, wait for the next chunk or choose **Resume scan now**. Do not start over |
| Service error: Drive | Temporary Drive failure | **Resume scan now**. The same blip retries by itself on 2026-11-03.10 and later |
| Response Code: 200, with a long dump of file data | A false error while reading the script's own index | Paste 2026-11-03.9 or later and **Resume scan now**. Clear the **Last error** cell. It is leftover index text, not a Drive message about your files |
| Duplicates tab empty, Phase not Done | The report has not been written yet | Wait. Empty does not mean zero duplicates |
| Groups not shown is greater than 0 | Some groups did not fit in the sheet | Read `groups-not-shown.json` in the index folder, or raise the minimum size and scan again |
| Sheet is shared / not private | The safety check refused to run | Unshare the spreadsheet completely |

## Reading the report

Open **Duplicates** only after **Phase** is **Done**.

| Column | Meaning |
|---|---|
| File 1 full path (earlier created time) | The older file. The cell is a link to that file id |
| File 2 full path | One later identical copy. Also a link |
| Action | Empty until you choose **Delete file 1** or **Delete file 2**. The choice stays until that file is trashed, or until you clear the cell. A skipped row keeps the choice |
| Size | A label such as `15 MB`. This column sorts alphabetically, not by real size |
| Result | What last happened on this row |
| MD5 | The checksum both files share |
| Issue | Blank until a bulk delete skips the row. The reason is then written here in red. Read it: a refused check trashed neither file, and a note that says to check Drive Trash means a file may already be there |
| File 1 ID, File 2 ID, Size bytes, Pair key | Hidden. The script needs them. Do not edit them |

Click a path before you delete anything. The link opens that file id, not whatever file happens to sit at a similar path today. Path text was recorded when the path was built. If you moved the file afterward, the text can be stale and the link still opens the same file.

The arrows in the header row are the sheet filter. They do not delete anything.

## Sorting by size

The **Size** column is text (`1.6 MB`, `15 MB`). Sorting it from the filter menu is alphabetical and will not put 15 MB after 2.4 MB.

After **Phase** is **Done**:

- **Duplicate review → Sort duplicates, largest first**
- **Duplicate review → Sort duplicates, smallest first**

The sort uses the hidden byte size, keeps each pair on its own row, and keeps the path links. It does not read or change Drive. With tens of thousands of rows it can take a minute. It refuses to run before the scan is **Done**, so it cannot scramble a half-built report.

## Moving copies to Trash

A cell cannot hold two real buttons. The Action cell is a dropdown.

1. Click the **Action** cell on that row, not the header. Choose **Delete file 1** or **Delete file 2**. The choice stays in the cell. Nothing is trashed yet. You can fill in as many rows as you want, including by copying the choice down the column.
2. Choose **Duplicate review → Delete all selected actions**.

That menu checks every chosen row, then moves the chosen file to Trash. It does not open a dialog and it does not ask you to confirm. For each selected row it reads Drive again and checks all of this:

- The chosen file is still yours and still has the same size and MD5 as the row. If it is not already in Trash, Drive must say it can be trashed.
- Another file you own, with the same size and MD5, is still in Drive. The listed partner is checked first. If that partner is already gone, other indexed copies are checked. A Shared drive copy, or a copy you do not own, does not count.

Immediately before Trash, the script reads the row again. If you changed the Action, the file ids, the size, or the MD5 while the check was running, it trashes nothing on that row and writes no Issue. A failed check does the same when the choice has changed, so the new choice is not blocked. It then reads the chosen file and the spare copy again. After Trash, the spare copy is read again. If it disappeared, the script puts the chosen file back.

If the chosen file is already in Trash, the script does not trash the other file. When another file you own still has the same size and MD5, it records the row on **deleted duplicates** and **TrashLog** and removes it from **Duplicates**. When no spare copy remains, it leaves the file in Trash, skips the row, and does not restore it.

If a check fails before Trash, neither file on that row is trashed. The row stays. The reason is written in red in **Issue**, at the end of the row, and the same text is written in **Result**. The Action stays, so you can see which file you had chosen. Nothing is permanently deleted. If the red text says to check Drive Trash, open Trash before you rely on the row. Clear an Action cell before you run the menu if that row should be left alone.

A quota limit or a timeout is not written as a skip. That row is tried again when the run continues.

It refuses to start while a scan is still running. It also skips a row, without calling Trash, when the hidden pair key does not match the two file ids, or when the chosen id is this spreadsheet. Those rows get the same red **Issue** text.

A long list is done in batches of 40. When a batch finishes and rows are still selected, the script schedules the next batch about a minute later. It does not ask again. A row that already has **Issue** text is not retried by that continuation. Run **Delete all selected actions** again to check those rows once more. To stop a batch that has not started, clear the remaining Action cells.

To trash one row with the checks below, select that row and choose **Duplicate review → Open confirmation for selected row**. A dialog names both files, both paths, the size, and the checksum. The Trash button stays disabled until you check the box. That path still refuses when it cannot prove another copy you own is in Drive with the same size and the same MD5.

Before that one-row dialog trashes, the script checks all of this again on the server:

- You are the owner of this private spreadsheet, and you are the person who clicked.
- **Phase** is still **Done**. A scan in progress turns actions off. Starting a new scan cancels open confirmations.
- The row still lists those two file ids.
- The confirmation is under ten minutes old and has not been used.
- The chosen file is still yours, still has the same size and MD5, is not already in Trash, and Drive says it can be trashed.
- Another file you own, with the same size and MD5, is still in Drive. The listed partner is checked first. If that partner is already gone, up to 500 other indexed copies are checked. A Shared drive copy does not count.

Immediately before the Trash call, both files are read again. After the call, the surviving copy is read again. If that copy disappeared, the script puts the just-trashed file back.

The Trash call targets a file id, never the path text.

### After a successful Trash

- The file is in Drive Trash. It is not permanently deleted. Google removes Trash on its own after about 30 days. This script does not.
- The row leaves **Duplicates** and is appended to **deleted duplicates**.
- The **Deleted** column names which side was moved. The one-row dialog also says the other file on that row was left in Drive.
- **deleted duplicates** does not exist until the first successful Trash. Pasting the script does not create it.
- **TrashLog** gets an audit row: when, file name, path, size, MD5, file id, and status **In Trash**.
- Other rows that mentioned the same file, which happens in a group of three or more, stay on **Duplicates**. Their Result says that file is already in Trash. Both **Open confirmation for selected row** and **Delete all selected actions** still require some identical copy to remain. If the chosen file is the last copy, that row is skipped, the other file is not trashed, and the reason is written in red in **Issue**. A chosen file that is already in Trash stays there when no spare remains.

If you trash the earliest file in a group of three or more, the sheet does not redraw the remaining pairs. A later check still searches the indexed copies and will not take the last one. To see the new pairing, run a new scan after you have finished reviewing.

## Undo

On **TrashLog**, open the **Restore** dropdown on that log row and choose **Restore this file**. A dialog asks you to confirm.

Restore works only for a file this script logged, only while the log says **In Trash**, and only if the file in Trash still has the same size and MD5 as the log. It calls `setTrashed(false)`. The file comes back to Drive. The log status becomes **Restored**.

The history row on **deleted duplicates** stays there. Restore does not move it back to **Duplicates**.

You can also restore from [Google Drive Trash](https://drive.google.com/drive/trash). Do not empty Trash if you may want a file back.

If the script trashed a file and then could not confirm the other copy, it tries to put the file back and tells you. If that rollback itself cannot be confirmed, **TrashLog** gets a **CHECK TRASH** row. Open Drive Trash and restore that file yourself.

## Menu

| Menu item | What it does |
|---|---|
| Set minimum file size | Stores the cutoff for the next scan. Does not change Drive |
| Scan My Drive for identical files | Starts a new scan and a new index. Do not use this to continue a paused scan |
| Resume scan now | Continues the saved scan, including some **ERROR** stops that were temporary |
| Install confirmation buttons | Installs the edit trigger for Restore on **TrashLog**. Action choices stay on the row either way |
| Open confirmation for selected row | Dialog for the row you selected on **Duplicates**. Re-checks Drive, then Trash |
| Delete all selected actions | Checks each chosen row with no dialog, then moves the chosen file to Trash. A check that fails before Trash writes the reason in red in **Issue** and trashes neither file. A file already in Trash is recorded and the row is removed only when a spare copy remains. Does not run during a scan. Continues until the remaining selected rows are done |
| Sort duplicates, largest first | Reorders **Duplicates** by real byte size. Requires **Done** |
| Sort duplicates, smallest first | Same, smallest first |
| Authorize and check setup | Checks Drive API v3, privacy, and identity. Run this after granting permission |
| How safety works | Short reminder of the rules above |
| About | Shows the developer, Fotios Basagiannis, and a link to [fotios.org](https://fotios.org) |

## Status fields

Not every field appears on the first run. They show up as the scan reaches them.

| Field | Meaning |
|---|---|
| Version | Script version that started the scan, or that last resumed it |
| Phase | Current step, **Done**, or **ERROR** |
| Last error | Blank when the last chunk succeeded |
| Safety | Reminder that the scan does not modify your files |
| Minimum size | Cutoff fixed at the start of this scan |
| Duplicate report | Whether the pair list exists yet |
| Binary files indexed | Files at or above the minimum that were stored |
| Empty files skipped | 0-byte files |
| Below minimum skipped | Files under the cutoff |
| Listing pages sorted | Listing pages already grouped |
| Checksum files still to sort | Leftover files not yet written into checksum groups |
| Checksum groups checked | Checksum piles compared, out of the piles that exist |
| Duplicate files kept for review | Files that have an identical copy and fit on the sheet |
| Groups not shown | Duplicate groups omitted because the sheet budget was reached |
| Path row | Duplicate files whose folder path has been resolved |
| Grouped through file | Files already turned into pair rows |
| Duplicate groups | Identical sets |
| Duplicate report rows | Pair rows. A set of three files produces two rows |
| Duplicate rows removed after resume | Pair rows dropped because a resume wrote them twice. Zero is the normal result |
| Result | Shown at **Done**. Nothing has been trashed by the scan |

## Limits

- About six minutes per run. The script budgets five so it can save and schedule the next chunk.
- About 90 minutes per day of automatic resumes on a personal Gmail account. Use **Resume scan now** after the quota resets.
- The spreadsheet cell limit still applies to the report. The scan itself is stored in Drive. If duplicate groups exceed what the sheet will hold (about 400,000 duplicate-file rows in **FileIndex**), the extra groups are counted and written to `groups-not-shown.json` instead of being given buttons.
- One checksum pile that still has more than 100,000 files after it can no longer be split stops the scan with an error. Raise the minimum size. Nothing is trashed.
- A confirmation dialog expires after ten minutes.
- Restore and Trash both re-check size and MD5 at the moment you confirm.

## Files

| File | Role |
|---|---|
| `DuplicateReview.gs` | The whole script. Paste this into Apps Script |
| `README.md` | This manual |

Developer: Fotios Basagiannis, [fotios.org](https://fotios.org).
