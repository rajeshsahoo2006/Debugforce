import * as vscode from "vscode";
import * as http from "http";
import * as url from "url";
import { OAuth2Client } from "google-auth-library";

const SCOPES = [
  "https://www.googleapis.com/auth/generative-language.retriever",
];

export class GoogleAuthManager {
  private static instance: GoogleAuthManager;
  private oAuth2Client: OAuth2Client | undefined;
  private server: http.Server | undefined;
  private readonly secretStorage: vscode.SecretStorage;
  private readonly outputChannel: vscode.OutputChannel;

  private constructor(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
  ) {
    this.secretStorage = context.secrets;
    this.outputChannel = outputChannel;
  }

  public static getInstance(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
  ): GoogleAuthManager {
    if (!GoogleAuthManager.instance) {
      GoogleAuthManager.instance = new GoogleAuthManager(
        context,
        outputChannel,
      );
    }
    return GoogleAuthManager.instance;
  }

  private async getOAuth2Client(): Promise<OAuth2Client> {
    if (this.oAuth2Client) {
      return this.oAuth2Client;
    }

    const config = vscode.workspace.getConfiguration("debugforce");
    const clientId = config.get<string>("googleClientId");
    const clientSecret = config.get<string>("googleClientSecret");

    if (!clientId || !clientSecret) {
      throw new Error(
        "Google Client ID and Secret are missing. Please configure them in settings.",
      );
    }

    this.oAuth2Client = new OAuth2Client(
      clientId,
      clientSecret,
      "http://localhost:3000/oauth2callback",
    );

    return this.oAuth2Client;
  }

  public async login(): Promise<void> {
    try {
      const client = await this.getOAuth2Client();

      // Generate authorization URL
      const authorizeUrl = client.generateAuthUrl({
        access_type: "offline",
        scope: SCOPES,
        include_granted_scopes: true,
      });

      // Start local server to handle callback
      await this.startLocalServer(client);

      // Open the authorization URL in the browser
      await vscode.env.openExternal(vscode.Uri.parse(authorizeUrl));

      this.outputChannel.appendLine("Waiting for Google authentication...");
    } catch (error) {
      this.outputChannel.appendLine(`Login failed: ${error}`);
      vscode.window.showErrorMessage(`Login failed: ${error}`);
      throw error;
    }
  }

  private async startLocalServer(client: OAuth2Client): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http
        .createServer(async (req, res) => {
          try {
            if (req.url!.indexOf("/oauth2callback") > -1) {
              const qs = new url.URL(req.url!, "http://localhost:3000")
                .searchParams;
              const code = qs.get("code");

              if (code) {
                res.end(
                  "Authentication successful! You can close this window now.",
                );

                // Exchange code for tokens
                const { tokens } = await client.getToken(code);
                client.setCredentials(tokens);

                // Store tokens securely
                if (tokens.access_token) {
                  await this.secretStorage.store(
                    "google_access_token",
                    tokens.access_token,
                  );
                }
                if (tokens.refresh_token) {
                  await this.secretStorage.store(
                    "google_refresh_token",
                    tokens.refresh_token,
                  );
                }

                this.outputChannel.appendLine(
                  "Successfully authenticated with Google!",
                );
                vscode.window.showInformationMessage(
                  "Successfully authenticated with Google!",
                );

                // Close server
                this.server?.close();
                this.server = undefined;
              } else {
                res.end("Authentication failed! No code received.");
                reject(new Error("No code received"));
              }
            }
          } catch (e) {
            this.outputChannel.appendLine(`Error in callback handler: ${e}`);
            reject(e);
          }
        })
        .listen(3000, () => {
          resolve();
        });
    });
  }

  public async getAccessToken(): Promise<string | undefined> {
    // Try to get stored token
    let accessToken = await this.secretStorage.get("google_access_token");

    // If we have a refresh token, we might need to refresh
    if (!accessToken) {
      // In a real implementation, we would use the refresh token to get a new access token here
      // For now, let's just return undefined if no access token
      return undefined;
    }

    return accessToken;
  }

  public async logout(): Promise<void> {
    await this.secretStorage.delete("google_access_token");
    await this.secretStorage.delete("google_refresh_token");
    this.oAuth2Client = undefined;
    this.outputChannel.appendLine("Logged out from Google.");
    vscode.window.showInformationMessage("Logged out from Google.");
  }
}
