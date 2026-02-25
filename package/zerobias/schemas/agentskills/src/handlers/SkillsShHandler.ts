import { fetchText } from '@zerobias-org/util-collector';

const SITEMAP_URL = 'https://skills.sh/sitemap.xml';

/**
 * Extract unique "owner/repo" pairs from skills.sh sitemap XML.
 * The sitemap contains entries like:
 *   <loc>https://skills.sh/owner/repo/skill-slug</loc>
 */
export function extractReposFromSitemap(xml: string): string[] {
  const seen = new Set<string>();
  const regex = /https:\/\/skills\.sh\/([\dA-Za-z][\dA-Za-z-]*)\/([\dA-Za-z][\w.-]*)\//g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(xml)) !== null) {
    seen.add(`${match[1]}/${match[2]}`);
  }

  return [...seen];
}

/**
 * Fetch skills.sh sitemap and return all discovered repos.
 * Returns ~678 repos covering ~4,000 skills vs ~50 from the homepage.
 */
export async function discoverRepos(url: string = SITEMAP_URL): Promise<string[]> {
  const xml = await fetchText(url);
  return extractReposFromSitemap(xml);
}
