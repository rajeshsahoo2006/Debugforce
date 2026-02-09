# Gemini Analysis Setup Guide

## Quick Setup

To enable automatic Gemini analysis of your Salesforce debug logs:

### Step 1: Get a Gemini API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy your API key

### Step 2: Configure Debugforce Settings

Open VS Code Settings (`Cmd+,` on Mac, `Ctrl+,` on Windows/Linux) and add:

```json
{
  "debugforce.useGemini": true,
  "debugforce.geminiApiKey": "YOUR_API_KEY_HERE",
  "debugforce.enableAutoFetch": true
}
```

Or edit your `settings.json` file directly:

1. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
2. Type "Preferences: Open User Settings (JSON)"
3. Add the settings above

### Step 3: Setup Debug Logging

1. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Run: **Debugforce: Setup Debug Logging (30 min)**
3. The extension will automatically:
   - Fetch logs every 2 minutes
   - Download new logs automatically
   - Analyze logs with Gemini automatically
   - Save summaries to `.debugforce/analysis/gemini_auto_[timestamp].md`

## Settings Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `debugforce.useGemini` | boolean | `false` | Enable Gemini API for log analysis |
| `debugforce.geminiApiKey` | string | `""` | Your Google Gemini API key |
| `debugforce.enableAutoFetch` | boolean | `true` | Automatically fetch and analyze logs in background |

## Manual Analysis

You can also manually trigger Gemini analysis:

1. **Via Command Palette**: Run "Debugforce: Analyze All Logs with Gemini"
2. **Via Control Panel**: Click "🤖 Analyze All Logs with Gemini" button

## Troubleshooting

### "Gemini analysis is disabled"
- Make sure `debugforce.useGemini` is set to `true` in settings
- Check that `debugforce.geminiApiKey` is not empty

### "Gemini API key is required"
- Add your API key to `debugforce.geminiApiKey` setting
- Get a new API key from [Google AI Studio](https://makersuite.google.com/app/apikey)

### Background task not analyzing
- Check the Output Channel ("Debugforce") for detailed logs
- Ensure `debugforce.enableAutoFetch` is `true`
- Verify Gemini settings are configured correctly

## Output Files

- **Auto-generated summaries**: `.debugforce/analysis/gemini_auto_[timestamp].md`
- **Manual summaries**: `.debugforce/analysis/gemini_summary_[timestamp].md`
- **Raw logs**: `.debugforce/logs/[logId].log`

## Notes

- Gemini analysis requires an internet connection
- API usage may incur costs (check Google's pricing)
- Logs are truncated to 50KB each to stay within API limits
- Background analysis runs every 2 minutes after setup
