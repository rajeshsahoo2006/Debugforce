# Running Debugforce Extension in Development

## The "command not found" error happens when the extension loads from the wrong folder.

When your workspace is the **Sample** Salesforce project, the extension must be loaded from the **Debugforce** folder explicitly.

## Steps to run the extension with Sample:

1. **Build the extension first** (from Debugforce folder):
   ```bash
   cd /Users/rsahoo/Documents/Debugforce && npm run build
   ```

2. **Select the correct launch configuration:**
   - Open the Run and Debug panel (Cmd+Shift+D or Ctrl+Shift+D)
   - In the dropdown, choose **"Run Extension from Sample workspace"**
   - Do NOT use "Run Extension" when Sample is your open folder

3. **Press F5** to launch

4. **Use the NEW window** – A second window opens (Extension Development Host). The Debugforce extension runs **only in that new window**. Run "Debugforce: Show Control Panel" from the Command Palette (Cmd+Shift+P) in that new window, not the original one. The new window title often includes "[Extension Development Host]".

## Alternative: Open Debugforce as workspace

- **File → Open Folder** → select `/Users/rsahoo/Documents/Debugforce`
- Press F5 with **"Run Extension"** – the new window will open with Sample for testing
