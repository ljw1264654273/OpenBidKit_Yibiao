# Branding Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the client-facing brand with the provided Logo and the name “园测 投标工具箱” while preserving app identity and update compatibility.

**Architecture:** Use `client/assets/brand-logo.png` as the single renderer-facing brand source. Keep Electron runtime icon paths stable (`assets/icon.ico`, `assets/icon.icns`) and regenerate/update those icon artifacts from the new source so packaging config remains simple. Generate a temporary 256px PNG only while building the ICO, then delete it so `icon_256.png` stays removed. Keep `appId`, update-service matching, and `Yibiao-` artifact naming unchanged.

**Tech Stack:** Electron, Vite/React/TypeScript renderer, electron-builder, GitHub Actions, Windows PowerShell/.NET image resizing, macOS `sips`/`iconutil` in CI.

---

## File Structure

- Create: `client/assets/brand-logo.png`
  - Canonical UI Logo copied from the user-provided PNG.
- Modify: `client/assets/icon.ico`
  - Windows/Electron icon regenerated from the new Logo.
- Modify: `client/assets/icon_16.png`, `client/assets/icon_24.png`, `client/assets/icon_32.png`, `client/assets/icon_48.png`, `client/assets/icon_64.png`, `client/assets/icon_128.png`
  - Existing auxiliary icon sizes refreshed from the new Logo so no checked-in retained icon still shows the old brand.
- Delete: `client/assets/icon_256.png`
  - Old renderer Logo source removed per user request.
- Modify: `client/src/components/Sidebar.tsx`
  - Import `brand-logo.png`; render “园测” and “投标工具箱”.
- Modify: `client/index.html`
  - Browser document title.
- Modify: `client/electron/main.cjs`
  - Main window title.
- Modify: `client/electron/preload.cjs`
  - Exposed `appName`.
- Modify: `client/package.json`
  - `description` and `build.productName`; keep `appId` and `artifactName`.
- Modify: `client/assets/macos-dmg/macOS使用说明.txt`
  - User-visible app name and `/Applications/...app` paths.
- Modify: `client/scripts/generate-build-attestation.cjs`
  - Product-name fallback used when generating build metadata.
- Modify: `client/electron/services/licenseService.cjs`
  - Product-name fallback used in license metadata.
- Modify: `.github/workflows/release.yml`
  - Windows MSI product-name override; macOS icon generation source path.
- Modify: `client/electron/resources/build-attestation.json`
  - Checked-in generated metadata product name, matching the new `build.productName`.

## Task 1: Brand Assets

**Files:**
- Create: `client/assets/brand-logo.png`
- Modify: `client/assets/icon.ico`
- Modify: `client/assets/icon_16.png`
- Modify: `client/assets/icon_24.png`
- Modify: `client/assets/icon_32.png`
- Modify: `client/assets/icon_48.png`
- Modify: `client/assets/icon_64.png`
- Modify: `client/assets/icon_128.png`
- Delete: `client/assets/icon_256.png`

- [ ] **Step 1: Copy the provided Logo into the client asset tree**

Run from repository root:

```powershell
Copy-Item -LiteralPath 'C:\Users\admin\AppData\Local\Temp\codex-clipboard-544d69b7-3b8d-4411-a7cf-f882d97b022d.png' -Destination 'client\assets\brand-logo.png' -Force
```

Expected: `client/assets/brand-logo.png` exists and is a PNG image.

- [ ] **Step 2: Generate refreshed PNG icon sizes from the new Logo**

Run from repository root:

```powershell
Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile((Resolve-Path 'client\assets\brand-logo.png'))
foreach ($size in 16, 24, 32, 48, 64, 128, 256) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.DrawImage($source, 0, 0, $size, $size)
  $fileName = if ($size -eq 256) { 'icon-256.tmp.png' } else { "icon_$size.png" }
  $out = Join-Path (Resolve-Path 'client\assets') $fileName
  $bitmap.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}
$source.Dispose()
```

Expected: six checked-in `icon_<size>.png` files are updated, and temporary `client/assets/icon-256.tmp.png` exists for the next step.

- [ ] **Step 3: Regenerate `icon.ico` from PNG payloads**

Run from repository root with Node 22:

```powershell
node -e 'const fs=require("fs");const path=require("path");const base=path.join("client","assets");const sizes=[16,24,32,48,64,128];const images=sizes.map(size=>({size,data:fs.readFileSync(path.join(base,"icon_"+size+".png"))}));images.push({size:256,data:fs.readFileSync(path.join(base,"icon-256.tmp.png"))});let offset=6+images.length*16;const header=Buffer.alloc(offset);header.writeUInt16LE(0,0);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);images.forEach((img,index)=>{const entry=6+index*16;header[entry]=img.size===256?0:img.size;header[entry+1]=img.size===256?0:img.size;header[entry+2]=0;header[entry+3]=0;header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(img.data.length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=img.data.length;});fs.writeFileSync(path.join(base,"icon.ico"),Buffer.concat([header,...images.map(i=>i.data)]));'
```

Expected: `client/assets/icon.ico` is updated and remains the configured Windows icon path.

- [ ] **Step 4: Delete the temporary 256px payload and old 256px source**

Run:

```powershell
Remove-Item -LiteralPath 'client\assets\icon-256.tmp.png' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'client\assets\icon_256.png'
```

Expected: neither `client/assets/icon-256.tmp.png` nor `client/assets/icon_256.png` exists.

- [ ] **Step 5: Inspect asset status**

Run:

```powershell
Get-ChildItem client\assets -File | Where-Object { $_.Name -match 'brand-logo|icon' } | Select-Object Name,Length
```

Expected: `brand-logo.png`, `icon.ico`, `icon_16.png`, `icon_24.png`, `icon_32.png`, `icon_48.png`, `icon_64.png`, `icon_128.png` exist; `icon_256.png` does not.

- [ ] **Step 6: Commit**

```powershell
git add -- client/assets/brand-logo.png client/assets/icon.ico client/assets/icon_16.png client/assets/icon_24.png client/assets/icon_32.png client/assets/icon_48.png client/assets/icon_64.png client/assets/icon_128.png client/assets/icon_256.png
git commit -m "chore: replace client logo assets"
```

## Task 2: Renderer And Electron Brand Text

**Files:**
- Modify: `client/src/components/Sidebar.tsx`
- Modify: `client/index.html`
- Modify: `client/electron/main.cjs`
- Modify: `client/electron/preload.cjs`
- Modify: `client/package.json`
- Modify: `client/assets/macos-dmg/macOS使用说明.txt`
- Modify: `client/scripts/generate-build-attestation.cjs`
- Modify: `client/electron/services/licenseService.cjs`
- Modify: `client/electron/resources/build-attestation.json`

- [ ] **Step 1: Update `Sidebar.tsx` Logo import and visible text**

Change:

```tsx
import logoUrl from '../../assets/icon_256.png';
```

to:

```tsx
import logoUrl from '../../assets/brand-logo.png';
```

Change the brand copy from:

```tsx
<span>易标</span>
<strong>投标工具箱</strong>
```

to:

```tsx
<span>园测</span>
<strong>投标工具箱</strong>
```

- [ ] **Step 2: Update document and Electron app names**

Replace the exact user-facing product name `易标投标工具箱` with `园测 投标工具箱` in:

- `client/index.html`
- `client/electron/main.cjs`
- `client/electron/preload.cjs`
- `client/package.json` `description` and `build.productName`
- `client/assets/macos-dmg/macOS使用说明.txt`
- `client/scripts/generate-build-attestation.cjs` fallback `productName`
- `client/electron/services/licenseService.cjs` fallback `PRODUCT_NAME`
- `client/electron/resources/build-attestation.json`

Do not change `client/package.json` `build.appId` or `build.artifactName`.

- [ ] **Step 3: Search client code for remaining old primary brand references**

Run:

```powershell
client\vendor\agent-tools\win32-x64\bin\rg.exe -n -S "易标投标工具箱|icon_256|productName=OpenBidKit_Yibiao" client/index.html client/package.json client/src client/electron client/scripts
```

Expected: no matches for `icon_256` or `productName=OpenBidKit_Yibiao`; any remaining `易标投标工具箱` match must be intentionally out of scope and noted before proceeding. The `.github` workflow is checked after Task 3, because Task 3 owns release workflow changes.

- [ ] **Step 4: Syntax-check Electron entry files**

Run:

```powershell
Push-Location client
node --check electron\main.cjs
node --check electron\preload.cjs
Pop-Location
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git add -- client/src/components/Sidebar.tsx client/index.html client/electron/main.cjs client/electron/preload.cjs client/package.json client/assets/macos-dmg/macOS使用说明.txt client/scripts/generate-build-attestation.cjs client/electron/services/licenseService.cjs client/electron/resources/build-attestation.json
git commit -m "feat: rename client brand"
```

## Task 3: Release Workflow Compatibility

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Update the Windows MSI product name override**

Change the Windows MSI build command from:

```bash
npx electron-builder --win msi --publish never -c.npmRebuild=false -c.productName=OpenBidKit_Yibiao -c.extraMetadata.author=mark -c.copyright="Copyright (c) 2026 mark"
```

to:

```bash
npx electron-builder --win msi --publish never -c.npmRebuild=false -c.productName="园测 投标工具箱" -c.extraMetadata.author=mark -c.copyright="Copyright (c) 2026 mark"
```

- [ ] **Step 2: Update macOS CI icon generation source**

In the `Generate macOS icon` step, replace every `assets/icon_256.png` input with `assets/brand-logo.png`. Keep the generated output file names and `assets/icon.icns` destination unchanged.

- [ ] **Step 3: Verify release workflow references**

Run:

```powershell
client\vendor\agent-tools\win32-x64\bin\rg.exe -n -S "assets/icon_256\\.png|productName=OpenBidKit_Yibiao|Yibiao-" .github\workflows\release.yml .github\scripts client\electron\services\updateService.cjs client\package.json
```

Expected:

- No `assets/icon_256.png` source-image match. macOS `.iconset` output names such as `icon_256x256.png` are expected and should remain.
- No `-c.productName=OpenBidKit_Yibiao` match.
- Existing repository identifiers and `Yibiao-` artifact/update naming matches remain unchanged.

- [ ] **Step 4: Commit**

```powershell
git add -- .github/workflows/release.yml
git commit -m "ci: use new brand assets in release"
```

## Task 4: Build Verification And Manual UI Check

**Files:**
- Verify only, no expected source edits.

- [ ] **Step 1: Run focused static checks**

```powershell
Push-Location client
node --check electron\main.cjs
node --check electron\preload.cjs
Pop-Location
```

Expected: both commands exit 0.

- [ ] **Step 2: Run the client build**

```powershell
Push-Location client
npm run build
Pop-Location
```

Expected: command exits 0. Existing Vite chunk-size warnings are acceptable.

- [ ] **Step 3: Start the development client for visual/manual verification**

```powershell
Push-Location client
npm run dev
```

Expected: Vite starts at `127.0.0.1:5173` and Electron opens. This command stays running; complete Step 4 while it is active, then press `Ctrl+C` in the terminal and run `Pop-Location`.

- [ ] **Step 4: Manually verify app branding**

Check:

- Main window title is “园测 投标工具箱”.
- Sidebar expanded state shows the new Logo, “园测”, and “投标工具箱”.
- Sidebar collapsed state shows only the new Logo.
- Logo is clear at sidebar size and not distorted.

- [ ] **Step 5: Verify working tree and summarize**

Run:

```powershell
git status --short
```

Expected: only intentional changes remain, or working tree is clean after task commits.
