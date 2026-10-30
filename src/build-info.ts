export interface EmbeddedBuild {
  version: string;
  revision: string;
  target: string;
  assets: Record<string, string>;
}
// Only the packaging build defines this constant. No environment variables,
// configuration, database, QR or credentials are captured in this payload.
declare const WHISTLE_BUILD: EmbeddedBuild;
export const embeddedBuild: EmbeddedBuild | undefined = typeof WHISTLE_BUILD === 'undefined' ? undefined : WHISTLE_BUILD;
export const standalone = embeddedBuild !== undefined;
export function versionDescription() {
  return embeddedBuild
    ? `Whistle ${embeddedBuild.version} (${embeddedBuild.revision}, ${embeddedBuild.target}, standalone)`
    : 'Whistle development (source checkout)';
}
/** How to make a new pairing QR, as the person reading a message would type it. */
export const pairCommand = standalone ? 'whistle pair' : 'bun run pair';
