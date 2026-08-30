# Term Planner PWA — compact upload version

This version bundles all 145 planner page images into **one `pages-data.js` file**, so GitHub only has a handful of files to upload.

## Upload to GitHub Pages
1. Create a repository.
2. Upload the **contents of this folder** to the repository root.
3. Commit the files.
4. Open **Settings → Pages**.
5. Choose **Deploy from a branch**, then `main` and `/ (root)`.
6. Open the GitHub Pages URL on the tablet and use **Add to Home Screen / Install app**.

The large `pages-data.js` file is normal: it contains all 145 page backgrounds.

Annotations are saved locally on the device. Use the planner's Export annotation backup option periodically.

## v3 changes
- Planner-style pen, eraser and undo icons.
- Text notes can use Caveat, Darker Grotesque, or Centaur (when Centaur is installed on the device; otherwise a serif fallback is used).
- Text size and bold controls added.
- Caveat and Darker Grotesque load from Google Fonts on first online use.

## v5 fix
Text formatting controls are now truly contextual: they only appear when the Text tool is active or an existing text box is selected. The service worker now prefers fresh GitHub files while online, using the cache only as an offline fallback, so development updates should require far less cache-clearing nonsense.


## v6
Existing text boxes can now be dragged to reposition them. Single click/tap selects; drag moves; double click edits.
