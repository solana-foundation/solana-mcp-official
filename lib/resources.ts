import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

export const resources = [
  {
    name: "solanaDocsClusters",
    template: new ResourceTemplate("solana://clusters", {
      list: undefined,
    }),
    func: async (uri: any) => {
      try {
        const response = await fetch(
          "https://raw.githubusercontent.com/solana-foundation/solana-com/main/content/docs/references/clusters.mdx"
        );
        const fileContent = await response.text();
        return {
          contents: [
            {
              uri: uri.href,
              text: fileContent,
            },
          ],
        };
      } catch (error) {
        return {
          contents: [
            {
              uri: uri.href,
              text: `Error: ${(error as Error).message}`,
            },
          ],
        };
      }
    },
  },
  {
    name: "solanaDocsInstallation",
    template: new ResourceTemplate("solana://installation", {
      list: undefined,
    }),
    func: async (uri: any) => {
      try {
        const response = await fetch(
          "https://raw.githubusercontent.com/solana-foundation/solana-com/main/content/docs/intro/installation.mdx"
        );
        const fileContent = await response.text();
        return {
          contents: [
            {
              uri: uri.href,
              text: fileContent,
            },
          ],
        };
      } catch (error) {
        return {
          contents: [
            {
              uri: uri.href,
              text: `Error: ${(error as Error).message}`,
            },
          ],
        };
      }
    },
  },
];
